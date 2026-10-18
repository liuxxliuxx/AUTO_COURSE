import type { Locator, Page } from 'playwright-core'
import type { Logger } from '../services/logger'
import { CourseOverlays, type CourseLayer } from './classic/course-overlays'

// ============================================================================
// 答题策略
// ============================================================================

export interface AnswerStrategy {
  readonly name: string
  /** 从选项数量中选一个下标。 */
  selectIndex(optionCount: number): number
}

export class RandomAnswerStrategy implements AnswerStrategy {
  readonly name = 'random'
  selectIndex(optionCount: number): number {
    return Math.floor(Math.random() * optionCount)
  }
}

export class FirstAnswerStrategy implements AnswerStrategy {
  readonly name = 'first'
  selectIndex(): number {
    return 0
  }
}

/** 供测试注入固定选择 */
export class FixedAnswerStrategy implements AnswerStrategy {
  readonly name = 'fixed'
  constructor(private readonly index: number) {}
  selectIndex(optionCount: number): number {
    return Math.max(0, Math.min(this.index, optionCount - 1))
  }
}

export type QuizResult = { state: 'handled' | 'stopped' | 'protected' } | { state: 'failed'; message: string }
interface QuestionState { fingerprint: string; options: string[]; unsupported: boolean }

/** One selection per question; every transition is verified, never inferred from a click. */
export class QuizService {
  private readonly choices = new Map<string, number>()
  private closeRecords: NonNullable<CourseLayer['closeAttempts']> = []
  private closeSerial = 0
  get closeAttempts(): CourseLayer['closeAttempts'] { return this.closeRecords.map(record=>({...record})) }
  constructor(private readonly page: Page, private readonly log: Logger, private readonly strategy: AnswerStrategy = new RandomAnswerStrategy()) {}

  async findDialog(): Promise<Locator|null> {
    const overlays=new CourseOverlays(this.page,this.log)
    const layer=(await overlays.scan()).find(l=>l.kind==='quiz'&&l.actionable)
    return layer?overlays.root(layer):null
  }
  private async question(dialog:Locator):Promise<QuestionState>{
    return dialog.evaluate(root=>{
      const options=Array.from(root.querySelectorAll('.topic-item')).map(el=>(el.textContent??'').replace(/\s+/g,' ').trim())
      const question=(root.querySelector('#question,.topic-title,.topicTitle,.el-dialog__body p,p')?.textContent??'').replace(/\s+/g,' ').trim()
      return {fingerprint:JSON.stringify([question,options]),options,unsupported:/多选|填空|简答|排序/.test(question)||!!root.querySelector('textarea,input[type="text"],input[type="checkbox"]')}
    })
  }
  private async gone(dialog:Locator):Promise<boolean>{
    // Navigation or evaluation failure is not proof that the quiz was completed.
    return await dialog.count()===0 || !(await dialog.isVisible())
  }
  private async waitFor(check:()=>Promise<boolean>,shouldStop:()=>boolean,ms=1000):Promise<boolean>{
    const end=Date.now()+ms
    while(!shouldStop()){
      if(await check())return true
      if(Date.now()>=end)return false
      await this.page.waitForTimeout(80)
    }
    return false
  }
  async handle(dialog:Locator,shouldStop:()=>boolean=()=>false):Promise<QuizResult>{
    this.closeRecords=[]
    const fail=(message:string):QuizResult=>({state:'failed',message})
    try{
      const overlays=new CourseOverlays(this.page,this.log)
      for(let n=0;n<50;n++){
        if(shouldStop())return {state:'stopped'}
        if(await this.gone(dialog))return {state:'handled'}
        const visible=(await overlays.scan()).find(l=>l.actionable)
        if(visible&&visible.kind!=='quiz')return {state:'protected'} // coordinator handles the upper layer first
        const state=await this.question(dialog)
        if(state.unsupported||!state.options.length)return fail('弹题题型或选项无法识别')
        const id=await dialog.getAttribute('data-ac-layer')??'quiz'
        const key=id+state.fingerprint
        let index=this.choices.get(key)
        if(index===undefined){index=this.strategy.selectIndex(state.options.length);this.choices.set(key,index)}
        if(!Number.isInteger(index)||index<0||index>=state.options.length)return fail('答题策略返回了无效选项')
        const choice=dialog.locator('.topic-item').nth(index)
        const content=choice.locator('.item-topic').first()
        // The real site's option text may own the click handler; the row centre
        // can lie in blank space or outside the inner scrollbar's visible area.
        const control=await content.count()&&await content.isVisible()?content:choice
        const selected=async()=>choice.evaluate(el=>el.matches('.active,[aria-checked="true"]')||!!el.querySelector('.active,input:checked,[aria-checked="true"]'))
        let answered=await selected()
        let clickError=''
        for(let attempt=0;!answered&&attempt<2&&!shouldStop();attempt++){
          // Regular Playwright input only: no force and no synthetic click.
          try { await control.click({timeout:3000}) } catch(error) { clickError=String(error) }
          answered=await this.waitFor(async()=>await this.gone(dialog)||await selected(),shouldStop,2000)
          if(await this.gone(dialog))return {state:'handled'}
          const upper=(await overlays.scan()).find(l=>l.actionable)
          if(upper&&upper.kind!=='quiz')return {state:'protected'}
        }
        if(shouldStop())return {state:'stopped'}
        if(!answered)return fail('弹题选项未能确认选中'+(clickError?`：${clickError}`:''))
        const top=(await overlays.scan()).find(l=>l.actionable)
        if(top&&top.kind!=='quiz')return {state:'protected'}
        this.log.info(`弹题第 ${n+1} 题已选中第 ${index+1} 项（策略: ${this.strategy.name}）`)
        const next=dialog.locator('.btn-next').first()
        if(await next.isVisible()&&await next.isEnabled()){
          let advanced=false
          let nextError=''
          for(let attempt=0;attempt<2&&!shouldStop();attempt++){
            try { await next.click({timeout:3000}) } catch(error) { nextError=String(error);this.log.warn(`弹题下一题点击失败：${nextError}`) }
            advanced=await this.waitFor(async()=>await this.gone(dialog)||(await this.question(dialog)).fingerprint!==state.fingerprint,shouldStop)
            if(advanced)break
          }
          if(shouldStop())return {state:'stopped'}
          if(!advanced)return fail('点击下一题后题目未推进'+(nextError?`：${nextError}`:''))
          if(await this.gone(dialog))return {state:'handled'}
          continue
        }
        if(await this.close(dialog,shouldStop))return {state:'handled'}
        return shouldStop()?{state:'stopped'}:fail('弹题关闭后仍可见')
      }
      return fail('弹题超过 50 题处理上限')
    }catch(error){return shouldStop()?{state:'stopped'}:fail(`弹题处理失败：${String(error)}`)}
  }
  async close(dialog:Locator,shouldStop:()=>boolean=()=>false):Promise<boolean>{
    this.closeRecords=[]
    const tried=new Set<string>()
    for(let attempt=0;attempt<2&&!shouldStop();attempt++){
      if(await this.gone(dialog))return true
      // The report exposes both a header X and the real footer dismissal. Try
      // the explicit footer first, then a distinct header control if it fails.
      const groups=[dialog.locator('.dialog-footer .btn').filter({visible:true}),dialog.locator('.el-dialog__headerbtn,button[aria-label="Close"],button[aria-label="关闭"]').filter({visible:true}),dialog.locator('.el-dialog__close').filter({visible:true})]
      const candidates:Array<{el:Locator;id:string}>=[]
      const layerId=await dialog.getAttribute('data-ac-layer')??'quiz'
      for(const group of groups){
        for(let i=0;i<await group.count();i++){
          const el=group.nth(i)
          const id=await el.evaluate((el,generated)=>{
            if(el.matches('.el-dialog__close')&&el.closest('button,.el-dialog__headerbtn'))return null
            const explicit=/headerbtn|dialog__close/.test(el.getAttribute('class')??'')||/^(?:Close|关闭)$/i.test(el.getAttribute('aria-label')??'')||(el.textContent??'').trim()==='关闭'
            if(!explicit||el.closest('.yidun_popup,.yidun_modal,[class*="captcha" i]'))return null
            const id=el.getAttribute('data-ac-quiz-close')??generated
            el.setAttribute('data-ac-quiz-close',id)
            el.setAttribute('data-ac-layer-close',id)
            return id
          },`${layerId}-close-${this.closeSerial++}`)
          if(id)candidates.push({el,id})
        }
      }
      const chosen=candidates.find(candidate=>!tried.has(candidate.id))??candidates[0]
      if(!chosen)return false
      tried.add(chosen.id)
      const record:NonNullable<CourseLayer['closeAttempts']>[number]={attempt:attempt+1,clicked:false,hidden:false}
      this.closeRecords.push(record)
      if(shouldStop())return false
      try { await chosen.el.click({timeout:3000});record.clicked=true }
      catch(error){record.error=String(error);this.log.warn(`弹题关闭点击失败（${attempt+1}/2）：${record.error}`)}
      record.hidden=await this.waitFor(()=>this.gone(dialog),shouldStop,1500)
      if(record.hidden)return true
      if(record.clicked)this.log.warn(`弹题关闭点击已完成，但弹窗仍可见（${attempt+1}/2）`)
    }
    return false
  }
  async readQuestion(dialog:Locator):Promise<string>{return (await this.question(dialog)).fingerprint}
}
