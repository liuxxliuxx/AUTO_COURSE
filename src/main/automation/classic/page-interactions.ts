import type { Locator, Page } from 'playwright-core'
import type { Logger } from '../../services/logger'
import type { CourseDiagnosticPort } from '../../services/course-diagnostics'
import type { QuizService } from '../quiz'
import { CourseOverlays, type CourseLayer } from './course-overlays'

export type InteractionResult =
  | {state:'clear'|'handled'|'protected'|'stopped'}
  | {state:'recover';layer:CourseLayer;message:string}
  | {state:'failed';message:string}

/** One owner per workflow step. No runner/navigator maintains a second popup loop. */
export class ClassicPageInteractions {
  readonly overlays:CourseOverlays
  private readonly reloads=new Map<string,number>()
  private readonly evidence=new Map<string,string|null>()
  constructor(private readonly page:Page,private readonly log:Logger,private readonly quiz:QuizService,private readonly shouldStop:()=>boolean=()=>false,private readonly diagnostics?:CourseDiagnosticPort,private readonly recording:()=>boolean=()=>false){
    this.overlays=new CourseOverlays(page,log)
  }
  async failure(reason:string,layer?:CourseLayer,attempts?:number):Promise<{state:'failed';message:string}>{
    if(this.shouldStop())return {state:'failed',message:'运行已停止'}
    const path=await this.diagnostics?.capture(this.page,{reason,layer:layer?{kind:layer.kind,description:layer.description}:undefined,attempts})
    const message=reason+(path?`（现场：${path}）`:'')
    this.log.error(message)
    return {state:'failed',message}
  }
  async checkpoint(target?:Locator):Promise<InteractionResult>{
    let handled=false
    try{
      for(let round=0;round<10;round++){
        if(this.shouldStop())return {state:'stopped'}
        const layers=await this.overlays.scan(target)
        // A protected challenge owns the page even if its centre is occupied by an inner frame.
        const layer=layers.find(l=>l.actionable&&(l.kind!=='unknown'||l.blocking))
        if(!layer){
          const obstruction=target?await this.overlays.obstruction(target):null
          if(obstruction)return this.failure(`操作目标被无法识别的浮层遮挡：${obstruction}`)
          return {state:handled?'handled':'clear'}
        }
        if(layer.kind==='protected')return {state:'protected'}
        if(layer.exiting){
          const cleared=await this.overlays.waitForExit(layer)
          if(this.shouldStop())return {state:'stopped'}
          if(!cleared)return this.failure('弹窗退出后遮罩仍在遮挡页面',layer)
          handled=true;continue
        }
        if(layer.kind==='progress-error'){
          if(!this.evidence.has(layer.id))this.evidence.set(layer.id,await this.diagnostics?.capture(this.page,{reason:'进度提交或连接异常，恢复页面前保存',layer:{kind:layer.kind,description:layer.description}})??null)
          const path=this.evidence.get(layer.id)
          const message=layer.description+(path?`（现场：${path}）`:'')
          if(this.recording()){
            const failure={state:'failed' as const,message:`实时录音期间发生进度提交异常，停止以避免输出中断录音：${message}`}
            this.log.error(failure.message);return failure
          }
          return {state:'recover',layer,message}
        }
        if(layer.kind==='quiz'){
          const result=await this.quiz.handle(this.overlays.root(layer),this.shouldStop)
          if(result.state==='stopped')return {state:'stopped'}
          if(result.state==='failed')return this.failure(result.message,layer)
          if(result.state==='protected')continue
          handled=true;continue
        }
        if(!layer.closeId)return this.failure(`无法明确关闭课程浮层（${layer.kind}）：${layer.description}`,layer)
        if(!await this.overlays.close(layer,this.shouldStop)){
          if(this.shouldStop())return {state:'stopped'}
          return this.failure(`课程浮层关闭失败（${layer.kind}）：${layer.description}`,layer,2)
        }
        handled=true
      }
      return this.failure('课程浮层处理超过 10 轮上限')
    }catch(error){
      if(this.shouldStop())return {state:'stopped'}
      return this.failure(`课程页面检查失败：${String(error)}`)
    }
  }
  /** One reload budget per video across every checkpoint and recovery call. */
  async reserveReload(key:string):Promise<{state:'handled'}|{state:'failed';message:string}>{
    const used=this.reloads.get(key)??0
    if(used>=2)return this.failure('课程页面恢复失败：已重载 2 次，请检查网络后重新运行',undefined,used)
    this.reloads.set(key,used+1)
    this.log.warn(`重载课程页恢复当前视频（${used+1}/2）`)
    return {state:'handled'}
  }
}
