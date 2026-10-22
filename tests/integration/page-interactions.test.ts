import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ClassicPageInteractions } from '../../src/main/automation/classic/page-interactions'
import { CourseOverlays } from '../../src/main/automation/classic/course-overlays'
import { QuizService, FixedAnswerStrategy } from '../../src/main/automation/quiz'
import { CourseDiagnostics } from '../../src/main/services/course-diagnostics'
import { secretLogContext, type Logger } from '../../src/main/services/logger'
import { ClassicCourseRunner } from '../../src/main/automation/classic/classic-course-runner'
import { ClassicCourseNavigator } from '../../src/main/automation/classic/navigator'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { EventBus } from '../../src/main/services/event-bus'
import { DEFAULT_SETTINGS } from '../../src/main/services/settings-service'
import { VideoController } from '../../src/main/automation/classic/video-controller'
import { TIMEOUT } from '../../src/main/automation/constants'
import type { RunnerContext } from '../../src/main/automation/runner'

let browser:Browser,page:Page,dir:string
const log:Logger={info:vi.fn(),warn:vi.fn(),error:vi.fn(),debug:vi.fn(),exception:vi.fn()}
const catalogue='<ul><li class="video current_play" style="position:absolute;left:10px;top:10px;width:150px;height:30px"><span class="catalogue_title">样本视频</span></li></ul>'
const errorPanel='<div class="dialog-back" role="dialog" style="position:fixed;inset:100px;background:white;z-index:100">学习进度提交失败，请返回学堂</div>'
const checkpoint=(diagnostics?:CourseDiagnostics,recording=()=>false,stop=()=>false)=>new ClassicPageInteractions(page,log,new QuizService(page,log,new FixedAnswerStrategy(0)),stop,diagnostics,recording)
beforeAll(async()=>{browser=await chromium.launch({headless:true})})
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'ac-interactions-'));page=await browser.newPage();await page.setContent(catalogue)})
afterEach(async()=>{vi.restoreAllMocks();await page.close();await rm(dir,{recursive:true,force:true})})
afterAll(async()=>{await browser?.close()})

describe('unified course interaction checkpoints',()=>{
  it('closes the report-shaped preschool header icon after a slow layout settles',async()=>{
    await page.setContent(`<style>@keyframes moving{from{transform:translateX(0)}to{transform:translateX(15px)}}.dialog-read{position:fixed;left:100px;top:100px;width:500px;height:300px;background:white;animation:moving .3s infinite alternate}.iconguanbi{position:absolute;right:10px;top:10px;width:24px;height:24px;cursor:pointer}</style><div class="dialog"><div class="dialog-read"><div class="el-dialog__header"><h4>学前必读</h4><i class="iconfont iconguanbi" onclick="document.body.dataset.trusted=String(event.isTrusted);this.closest('.dialog').remove()"></i></div></div></div><script>setTimeout(()=>document.querySelector('.dialog-read').style.animation='none',2600)</script>`)
    const overlays=new CourseOverlays(page,log),layer=(await overlays.scan()).find(l=>l.kind==='preschool')!
    expect(layer.closeId).not.toBeNull()
    expect(await overlays.close(layer)).toBe(true)
    expect(layer.closeAttempts?.length).toBeLessThanOrEqual(2)
    expect(layer.closeAttempts?.at(-1)).toMatchObject({clicked:true,hidden:true})
    for(const attempt of layer.closeAttempts??[])if(!attempt.clicked)expect(attempt.error).toContain('Timeout')
    expect(await page.locator('body').getAttribute('data-trusted')).toBe('true')
  })
  it('preserves the actual click exception when a preschool close icon stays covered',async()=>{
    await page.setContent(`<div class="dialog-read" style="position:fixed;left:100px;top:100px;width:400px;height:300px;background:white"><h4>学前必读</h4><i class="iconguanbi" style="position:absolute;left:10px;top:10px;width:25px;height:25px"></i></div><div style="position:fixed;left:110px;top:110px;width:25px;height:25px;z-index:999;background:red"></div>`)
    const diagnostics=new CourseDiagnostics(dir,{runId:'run',courseId:'course'},log)
    expect((await checkpoint(diagnostics).checkpoint()).state).toBe('failed')
    const state=JSON.parse(await readFile(join(dir,(await readdir(dir))[0],'state.json'),'utf8'))
    expect(state.layer.closeAttempts).toHaveLength(2)
    for(const attempt of state.layer.closeAttempts){expect(attempt.clicked).toBe(false);expect(attempt.error).toContain('intercepts pointer events')}
    expect(state.renderer.closeControls[0]).toMatchObject({receivesPointer:false,inViewport:true,element:{tag:'i',className:'iconguanbi'}})
    expect(await page.locator('.dialog-read').count()).toBe(1)
    await diagnostics.finish()
  })
  it('temporarily closes course reminders without changing the permanent setting',async()=>{
    await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend',`<div class="el-dialog__wrapper dialog-warn"><div role="dialog" style="position:fixed;inset:100px;z-index:100;background:white">课程提醒<div class="rlready-bound-btn" onclick="document.body.dataset.permanent='true'">已绑定，不再提示</div><div class="talk-later-btn" onclick="document.body.dataset.trusted=event.isTrusted;this.parentElement.parentElement.remove()">下次再说</div></div></div>`))
    expect((await checkpoint().checkpoint(page.locator('li.video'))).state).toBe('handled')
    expect(await page.locator('body').getAttribute('data-permanent')).toBeNull()
    expect(await page.locator('body').getAttribute('data-trusted')).toBe('true')
  })
  it('handles a sibling mask and a div dismissal, then verifies that the target is clear',async()=>{
    await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend',`<div id="mask" style="position:fixed;inset:0;z-index:100;background:#8888"></div><div role="dialog" class="ai-helper-agreement-Dialog" style="position:fixed;inset:100px;z-index:101;background:white">使用提示<div class="primary-btn" onclick="document.querySelector('#mask').remove();this.parentElement.remove()">我知道了</div></div>`))
    expect((await checkpoint().checkpoint(page.locator('li.video'))).state).toBe('handled')
    expect(await page.locator('#mask').count()).toBe(0)
  })
  it('waits for the leaving mask after closing a dialog and continues without diagnostics',async()=>{
    await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend',`<div id="mask" class="v-modal" style="position:fixed;inset:0;z-index:100;background:#8888"></div><div role="dialog" class="ai-helper-agreement-Dialog" style="position:fixed;inset:100px;z-index:101;background:white">使用提示<div onclick="document.querySelector('#mask').classList.add('v-modal-leave');setTimeout(()=>document.querySelector('#mask').remove(),400);this.parentElement.remove()">我知道了</div></div>`))
    const diagnostics=new CourseDiagnostics(dir,{runId:'run',courseId:'course'},log)
    const capture=vi.spyOn(diagnostics,'capture')
    expect((await checkpoint(diagnostics).checkpoint(page.locator('li.video'))).state).toBe('handled')
    expect(await page.locator('#mask').count()).toBe(0)
    expect(capture).not.toHaveBeenCalled()
    await diagnostics.finish()
  })
  it('rescans after a leaving mask disappears even without an operation target',async()=>{
    await page.locator('body').evaluate(body=>{
      body.insertAdjacentHTML('beforeend','<div class="v-modal v-modal-leave" style="position:fixed;inset:0;z-index:100;background:#8888"></div>')
      setTimeout(()=>{
        document.querySelector('.v-modal')!.remove()
        body.insertAdjacentHTML('beforeend','<div role="dialog" style="position:fixed;inset:100px;background:white">欢迎你加入课程<button onclick="this.parentElement.remove()">关闭</button></div>')
      },200)
    })
    expect((await checkpoint().checkpoint()).state).toBe('handled')
    expect(await page.getByRole('dialog').count()).toBe(0)
  })
  it('captures and stops when a leaving mask remains stuck rather than deleting it',async()=>{
    await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend','<div class="v-modal v-modal-leave" style="position:fixed;inset:0;z-index:100;opacity:0;background:#8888"></div>'))
    const diagnostics=new CourseDiagnostics(dir,{runId:'run',courseId:'course'},log)
    const result=await checkpoint(diagnostics).checkpoint(page.locator('li.video'))
    expect(result.state).toBe('failed')
    if(result.state==='failed')expect(result.message).toContain('遮罩仍在遮挡')
    expect(await page.locator('.v-modal').count()).toBe(1)
    expect((await readdir(dir)).length).toBe(1)
    await diagnostics.finish()
  })
  it('closes the top layer first and rescans a stacked assistant panel with an external collapse control',async()=>{
    await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend',`<section class="ai-helper-sections"><div class="ai-draggable-dialog" style="position:fixed;inset:100px;z-index:100;background:white">助教<input value="draft"></div><div class="not-expand-icon" style="position:fixed;left:100px;top:100px;width:30px;height:30px;z-index:100" onclick="this.parentElement.remove()">收起</div></section><div role="dialog" class="ai-helper-agreement-Dialog" style="position:fixed;inset:200px;z-index:101;background:white">使用提示<div onclick="this.parentElement.remove()">我知道了</div></div>`))
    expect((await checkpoint().checkpoint()).state).toBe('handled')
    expect(await page.locator('.ai-helper-sections').count()).toBe(0)
  })
  it('ignores hidden and clipped candidates, and never registers the excluded player layer',async()=>{
    await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend',`<div style="opacity:0"><div role="dialog" style="position:fixed;inset:100px">学习进度提交失败</div></div><div style="overflow:hidden;width:1px;height:1px;position:absolute;left:500px;top:500px"><div role="dialog" style="position:absolute;left:100px;top:100px;width:100px;height:100px">学习进度提交失败</div></div><div class="video-topic" style="position:fixed;inset:0;z-index:999"><div role="dialog">学习进度提交失败<button>关闭</button></div></div>`))
    expect(await new CourseOverlays(page,log).scan(page.locator('li.video'))).toEqual([])
    expect((await checkpoint().checkpoint(page.locator('li.video'))).state).toBe('clear')
    expect(await page.locator('.video-topic').count()).toBe(1)
  })
  it('does not remove a passive panel whose close button is broken',async()=>{
    await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend',`<div role="dialog" style="position:fixed;inset:100px;background:white">欢迎你加入课程<button>关闭</button></div>`))
    const diagnostics=new CourseDiagnostics(dir,{runId:'run',courseId:'course',accountId:'account'},log)
    const result=await checkpoint(diagnostics).checkpoint(page.locator('li.video'))
    expect(result.state).toBe('failed')
    expect(await page.getByRole('dialog').count()).toBe(1)
    expect((await readdir(dir)).length).toBe(1)
    const state=JSON.parse(await readFile(join(dir,(await readdir(dir))[0],'state.json'),'utf8'))
    expect(state.layer.closeAttempts).toEqual([{attempt:1,clicked:true,hidden:false},{attempt:2,clicked:true,hidden:false}])
    expect(state.renderer.closeControls[0].receivesPointer).toBe(true)
    await diagnostics.finish()
  })
  it('preserves challenges and does not reload or click through their mask',async()=>{
    await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend',`<div class="yidun_modal" style="position:fixed;inset:0;z-index:200;background:white">验证<button onclick="document.body.dataset.closed='yes'">关闭</button></div>`))
    expect((await checkpoint().checkpoint(page.locator('li.video'))).state).toBe('protected')
    expect(await page.locator('body').getAttribute('data-closed')).toBeNull()
  })
  it('captures a progress failure once before recovery and refuses to reload during recording',async()=>{
    await page.locator('body').evaluate((body,html)=>body.insertAdjacentHTML('beforeend',html),errorPanel)
    const diagnostics=new CourseDiagnostics(dir,{runId:'run',courseId:'course'},log)
    const capture=vi.spyOn(diagnostics,'capture')
    const interactions=checkpoint(diagnostics)
    expect((await interactions.checkpoint()).state).toBe('recover')
    expect((await interactions.checkpoint()).state).toBe('recover')
    expect(capture).toHaveBeenCalledTimes(1)
    const recorded=await checkpoint(undefined,()=>true).checkpoint()
    expect(recorded.state).toBe('failed')
    if(recorded.state==='failed')expect(recorded.message).toContain('实时录音')
    await diagnostics.finish()
  })
  it('shares recovery budgets across checkpoints and instances do not share mutable state',async()=>{
    const first=checkpoint(),second=checkpoint()
    expect((await first.reserveReload('same-video')).state).toBe('handled')
    expect((await first.reserveReload('same-video')).state).toBe('handled')
    expect((await first.reserveReload('same-video')).state).toBe('failed')
    expect((await second.reserveReload('same-video')).state).toBe('handled')
    expect((await first.reserveReload('another-video')).state).toBe('handled')
  })
  it('does no work after stop is requested',async()=>{
    await page.locator('body').evaluate((body,html)=>body.insertAdjacentHTML('beforeend',html),errorPanel)
    expect((await checkpoint(undefined,()=>false,()=>true).checkpoint()).state).toBe('stopped')
    expect(await readdir(dir)).toEqual([])
  })
})

describe('diagnostic evidence',()=>{
  it('keeps sanitized DOM and state when screenshot rendering times out',async()=>{
    vi.spyOn(page,'screenshot').mockRejectedValue(new Error('screenshot timeout'))
    const diagnostics=new CourseDiagnostics(dir,{runId:'run',courseId:'course'},log)
    const path=await diagnostics.capture(page,{reason:'弹题选项未能确认选中'})
    expect(path).toMatch(/^diagnostics\//)
    const folder=join(dir,(await readdir(dir))[0])
    expect(await readFile(join(folder,'dom.html'),'utf8')).toContain('样本视频')
    expect(JSON.parse(await readFile(join(folder,'state.json'),'utf8'))).toMatchObject({reason:'弹题选项未能确认选中',screenshotError:'Error: screenshot timeout'})
    await diagnostics.finish()
  })
  it('redacts forms, embedded state, secrets, query values and the excluded subtree',async()=>{
    await page.route('http://evidence.test/**',route=>route.fulfill({contentType:'text/html',body:`${catalogue}<input type="password" value="private-password"><textarea>private-draft</textarea><script type="application/json">{"token":"private-token"}</script><div data-token="private-token" onclick="alert('secret')">private-password</div><div class="video-topic">excluded-text</div><a href="https://example.test/?token=private-token">link</a>`}))
    await page.goto('http://evidence.test/course?token=private-token')
    const diagnostics=new CourseDiagnostics(dir,{runId:'run-A',stepId:'step-A',accountId:'account-A',courseId:'course-A'},log)
    const path=await secretLogContext.run(['private-password'],()=>diagnostics.capture(page,{reason:'private-password'}))
    expect(path).toMatch(/^diagnostics\//)
    const folder=join(dir,(await readdir(dir))[0])
    const html=await readFile(join(folder,'dom.html'),'utf8'),state=await readFile(join(folder,'state.json'),'utf8')
    for(const secret of ['private-password','private-token','private-draft','video-topic','excluded-text','<script','onclick'])expect(html).not.toContain(secret)
    expect(state).not.toContain('private-password')
    expect(JSON.parse(state)).toMatchObject({runId:'run-A',stepId:'step-A',accountId:'account-A',courseId:'course-A',url:'http://evidence.test/course'})
    expect((await readFile(join(folder,'screen.png'))).length).toBeGreaterThan(0)
    await diagnostics.finish()
  })
  it('keeps only the last 100 evidence folders and preserves unrelated files',async()=>{
    for(let i=0;i<102;i++){
      const folder=join(dir,randomUUID()+'-'+randomUUID());await mkdir(folder);await utimes(folder,new Date(i*1000),new Date(i*1000))
    }
    await writeFile(join(dir,'unrelated.txt'),'keep')
    await new CourseDiagnostics(dir,{runId:'run',courseId:'course'},log).finish()
    expect((await readdir(dir)).length).toBe(101)
    expect(await readFile(join(dir,'unrelated.txt'),'utf8')).toBe('keep')
  })
  it('keeps the original failure when evidence cannot be written',async()=>{
    const file=join(dir,'not-a-directory');await writeFile(file,'x')
    const diagnostics=new CourseDiagnostics(file,{runId:'run',courseId:'course'},log)
    const interactions=checkpoint(diagnostics)
    const result=await interactions.failure('original error')
    expect(result.message).toBe('original error')
    await diagnostics.finish()
  })
})

function runnerContext():RunnerContext{
  return {settings:{...DEFAULT_SETTINGS,videoUrl:'',skipCompleted:false,brushEnabled:true},credentials:{username:'',password:''},session:new BrowserSession(page,()=>{}),bus:new EventBus(),log,media:null,lastVideoTitle:'',shouldStop:()=>false,sessionWatchedSeconds:()=>0,reportVideoWatched:vi.fn(),reportVideoCompleted:vi.fn(),reportCurrentTitle:vi.fn(),requestCaptcha:async()=>true}
}
const runner=()=>new ClassicCourseRunner(()=>({method:'zhihuishu',login:async()=>({ok:true,alreadyLoggedIn:true,message:'fixture'})}))
describe('completion and recording boundaries',()=>{
  it('does not advance continuation on a monitor timeout',async()=>{
    const maximum=TIMEOUT.videoMonitorMax
    try{
      Object.assign(TIMEOUT,{videoMonitorMax:0})
      vi.spyOn(ClassicCourseNavigator.prototype,'clickVideoWithRetry').mockResolvedValue(true)
      vi.spyOn(VideoController.prototype,'isPlaying').mockResolvedValue(true)
      vi.spyOn(VideoController.prototype,'restartFromBeginning').mockResolvedValue(true)
      vi.spyOn(VideoController.prototype,'readState').mockResolvedValue({exists:true,playing:true,paused:false,ended:false,currentSeconds:0,durationSeconds:10})
      const ctx=runnerContext(),result=await runner().run(ctx)
      expect(result.reason).toBe('error');expect(result.completedCount).toBe(0)
      expect(ctx.reportVideoCompleted).not.toHaveBeenCalled()
      expect(result.error?.message).toContain('超时')
    }finally{Object.assign(TIMEOUT,{videoMonitorMax:maximum})}
  })
  it('does not report completion when an error arrives on the last frame during recording',async()=>{
    vi.spyOn(ClassicCourseNavigator.prototype,'clickVideoWithRetry').mockResolvedValue(true)
    vi.spyOn(VideoController.prototype,'isPlaying').mockResolvedValue(true)
    vi.spyOn(VideoController.prototype,'restartFromBeginning').mockResolvedValue(true)
    vi.spyOn(VideoController.prototype,'readState').mockImplementation(async()=>{
      await page.locator('body').evaluate((body,html)=>body.insertAdjacentHTML('beforeend',html),errorPanel)
      return {exists:true,playing:false,paused:true,ended:true,currentSeconds:10,durationSeconds:10}
    })
    const end=vi.fn(),ctx=runnerContext()
    Object.assign(ctx,{media:{hasActiveRecording:()=>true,onVideoBegin:vi.fn(),onVideoEnd:end,transcribeOnly:vi.fn()}})
    const result=await runner().run(ctx)
    expect(result.reason).toBe('error');expect(result.completedCount).toBe(0)
    expect(ctx.reportVideoCompleted).not.toHaveBeenCalled();expect(end).not.toHaveBeenCalled()
    expect(result.error?.message).toContain('实时录音')
  })
})

const quizPanel=(optionAction:string,nextAction:string)=>`<div role="dialog" aria-label="弹题测验" class="el-dialog" style="position:fixed;inset:100px;background:white"><p id="question">【单选题】样本问题</p><div class="topic-item" onclick="${optionAction}">A. 选项</div><button class="btn-next" onclick="${nextAction}">下一题</button><div class="dialog-footer"><div class="btn" onclick="document.body.dataset.unknown='clicked'">确认提交</div><div class="btn" onclick="this.closest('.el-dialog').remove()">关闭</div></div></div>`
describe('verified quiz transitions',()=>{
  it('reclassifies a quiz appearing between the layer scan and target hit test',async()=>{
    const interactions=checkpoint(),obstruction=interactions.overlays.obstruction.bind(interactions.overlays)
    vi.spyOn(interactions.overlays,'obstruction').mockImplementationOnce(async target=>{
      await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend',`<div id="playTopic-dialog" class="el-dialog__wrapper" style="position:fixed;inset:0;z-index:100;background:#8888"><div class="el-dialog" role="dialog" aria-label="弹题测验" style="position:absolute;inset:100px;background:white"><p class="topic-title">【单选题】样本问题</p><div class="topic-item active">A. 样本</div><div class="dialog-footer"><div class="btn" onclick="document.body.dataset.trusted=String(event.isTrusted);this.closest('.el-dialog__wrapper').remove()">关闭</div></div></div></div>`))
      return obstruction(target)
    })
    expect((await interactions.checkpoint(page.locator('li.video'))).state).toBe('handled')
    expect(await page.locator('#playTopic-dialog').count()).toBe(0)
    expect(await page.locator('body').getAttribute('data-trusted')).toBe('true')
  })
  it('waits for a transparent quiz entrance to finish before classifying its wrapper',async()=>{
    await page.locator('body').evaluate(body=>{
      body.insertAdjacentHTML('beforeend',`<div id="playTopic-dialog" class="el-dialog__wrapper" style="position:fixed;inset:0;z-index:100;opacity:0"><div class="el-dialog" role="dialog" aria-label="弹题测验" style="position:absolute;inset:100px;background:white"><p class="topic-title">【单选题】样本问题</p><div class="topic-item active">A. 样本</div><div class="dialog-footer"><div class="btn" onclick="this.closest('.el-dialog__wrapper').remove()">关闭</div></div></div></div>`)
      setTimeout(()=>document.querySelector<HTMLElement>('#playTopic-dialog')!.style.opacity='1',250)
    })
    expect((await checkpoint().checkpoint(page.locator('li.video'))).state).toBe('handled')
    expect(await page.locator('#playTopic-dialog').count()).toBe(0)
  })
  it('keeps a permanently transparent blocker and fails within the rescan budget',async()=>{
    await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend','<div id="playTopic-dialog" style="position:fixed;inset:0;z-index:100;opacity:0"></div>'))
    const started=Date.now(),result=await checkpoint().checkpoint(page.locator('li.video'))
    expect(result).toMatchObject({state:'failed',message:expect.stringContaining('无法识别的浮层遮挡')})
    expect(Date.now()-started).toBeLessThan(3000)
    expect(await page.locator('#playTopic-dialog').count()).toBe(1)
  })
  it('yields to a challenge arriving between scan and obstruction checks',async()=>{
    const interactions=checkpoint(),obstruction=interactions.overlays.obstruction.bind(interactions.overlays)
    vi.spyOn(interactions.overlays,'obstruction').mockImplementationOnce(async target=>{
      await page.locator('body').evaluate(body=>body.insertAdjacentHTML('beforeend','<div class="yidun_modal" style="position:fixed;inset:0;z-index:100;background:white">验证</div>'))
      return obstruction(target)
    })
    expect((await interactions.checkpoint(page.locator('li.video'))).state).toBe('protected')
    expect(await page.locator('.yidun_modal').count()).toBe(1)
  })
  it.each(['right','error'])('closes an already graded multiple-choice quiz with %s feedback without changing selections',async(feedback)=>{
    await page.setContent(quizPanel('','').replace('【单选题】样本问题',`<span class="${feedback}">结果反馈</span>【多选题】样本问题`).replace('<div class="topic-item" onclick="">A. 选项</div>',`<div class="topic-item" onclick="document.body.dataset.changed='yes'"><span class="topic-option-item active">A.</span><span class="item-topic active">样本甲</span></div><div class="topic-item active" onclick="document.body.dataset.changed='yes'">B. 样本乙</div><p class="answer">正确答案：A,B</p>`).replace('<button class="btn-next" onclick="">下一题</button>',''))
    const selectIndex=vi.fn(()=>0),quiz=new QuizService(page,log,{name:'counted',selectIndex})
    expect((await quiz.handle((await quiz.findDialog())!)).state).toBe('handled')
    expect(selectIndex).not.toHaveBeenCalled()
    expect(await page.locator('body').getAttribute('data-changed')).toBeNull()
  })
  it('does not treat selected multiple-choice options alone as a submitted result',async()=>{
    await page.setContent(quizPanel("document.body.dataset.changed='yes'",'').replace('单选题','多选题').replace('class="topic-item"','class="topic-item active"'))
    const quiz=new QuizService(page,log)
    expect(await quiz.handle((await quiz.findDialog())!)).toMatchObject({state:'failed',message:'弹题题型或选项无法识别'})
    expect(await page.getByRole('dialog').isVisible()).toBe(true)
    expect(await page.locator('body').getAttribute('data-changed')).toBeNull()
  })
  it.each(['close','next'])('preserves the report selection C instead of clicking covered D before %s',async(action)=>{
    await page.setViewportSize({width:1271,height:667})
    await page.setContent(`<div class="el-dialog" role="dialog" aria-label="弹题测验" style="position:fixed;left:300px;top:100px;width:600px;height:450px;background:white">
      <p class="topic-title"><span class="right">正确</span>【单选题】样本问题</p>
      <ul>${['A','B','C','D'].map((letter,i)=>`<li class="topic-item" onclick="document.body.dataset.optionClicked='yes'" style="height:80px"><span class="topic-option-item ${i===2?'active':''}">${letter}.</span><div class="item-topic ${i===2?'active':''}">样本选项 ${letter}</div></li>`).join('')}</ul>
      <p class="answer">正确答案：C</p>
      <button class="btn-next" ${action==='close'?'disabled':''} onclick="document.body.dataset.next='yes';this.closest('.el-dialog').remove()">下一题</button>
      <div class="dialog-footer" style="position:absolute;left:0;right:0;top:315px;height:60px;background:white"><div class="btn" style="height:100%" onclick="document.body.dataset.closed=String(event.isTrusted);this.closest('.el-dialog').remove()">关闭</div></div>
    </div>`)
    const selectIndex=vi.fn(()=>3),quiz=new QuizService(page,log,{name:'would-choose-D',selectIndex})
    expect((await quiz.handle((await quiz.findDialog())!)).state).toBe('handled')
    expect(selectIndex).not.toHaveBeenCalled()
    expect(await page.locator('body').getAttribute('data-option-clicked')).toBeNull()
    expect(await page.locator('body').getAttribute(action==='close'?'data-closed':'data-next')).toBe(action==='close'?'true':'yes')
  })
  it('does not treat result feedback appearing in the title as question advancement',async()=>{
    await page.setContent(quizPanel("this.classList.add('active')","document.querySelector('#question').insertAdjacentHTML('afterbegin','<span class=&quot;right&quot;>正确</span>')"))
    const selectIndex=vi.fn(()=>0),quiz=new QuizService(page,log,{name:'counted',selectIndex})
    expect(await quiz.handle((await quiz.findDialog())!)).toMatchObject({state:'failed',message:'点击下一题后题目未推进'})
    expect(selectIndex).toHaveBeenCalledTimes(1)
    expect(await page.getByRole('dialog').isVisible()).toBe(true)
  })
  it('uses the report footer close instead of repeatedly clicking an ineffective header X',async()=>{
    await page.setContent(`<div class="el-dialog" role="dialog" aria-label="弹题测验" style="position:fixed;inset:100px;background:white"><button aria-label="Close" class="el-dialog__headerbtn" onclick="document.body.dataset.header='clicked'"><i class="el-dialog__close">×</i></button><p class="topic-title">【判断题】子网掩码示例</p><div class="topic-item"><span class="topic-option-item active">A.</span><div class="item-topic active">对</div></div><button class="btn-next" disabled>下一题</button><div class="dialog-footer"><div class="btn" onclick="document.body.dataset.trusted=String(event.isTrusted);this.closest('.el-dialog').remove()">关闭</div></div></div>`)
    const quiz=new QuizService(page,log,new FixedAnswerStrategy(0))
    expect((await quiz.handle((await quiz.findDialog())!)).state).toBe('handled')
    expect(await page.locator('body').getAttribute('data-header')).toBeNull()
    expect(await page.locator('body').getAttribute('data-trusted')).toBe('true')
    expect(quiz.closeAttempts).toEqual([{attempt:1,clicked:true,hidden:true}])
  })
  it('falls back to a distinct header control when footer close has no effect',async()=>{
    await page.setContent(`<div class="el-dialog" role="dialog" aria-label="弹题测验" style="position:fixed;inset:100px;background:white"><button aria-label="Close" class="el-dialog__headerbtn" onclick="this.closest('.el-dialog').remove()"><i class="el-dialog__close">×</i></button><div class="dialog-footer"><div class="btn" onclick="document.body.dataset.footer='clicked'">关闭</div></div></div>`)
    const quiz=new QuizService(page,log)
    expect(await quiz.close((await quiz.findDialog())!)).toBe(true)
    expect(await page.locator('body').getAttribute('data-footer')).toBe('clicked')
    expect(quiz.closeAttempts).toEqual([{attempt:1,clicked:true,hidden:false},{attempt:2,clicked:true,hidden:true}])
  })
  it('writes quiz close attempts and tagged close control geometry into diagnostics',async()=>{
    await page.setContent(quizPanel("this.classList.add('active')",'').replace('<button class="btn-next" onclick="">下一题</button>','').replace("this.closest('.el-dialog').remove()",'void 0'))
    const diagnostics=new CourseDiagnostics(dir,{runId:'run',courseId:'course'},log)
    expect((await checkpoint(diagnostics).checkpoint()).state).toBe('failed')
    const state=JSON.parse(await readFile(join(dir,(await readdir(dir))[0],'state.json'),'utf8'))
    expect(state.reason).toBe('弹题关闭后仍可见')
    expect(state.layer.closeAttempts).toEqual([{attempt:1,clicked:true,hidden:false},{attempt:2,clicked:true,hidden:false}])
    expect(state.renderer.closeControls.some((el:{receivesPointer:boolean})=>el.receivesPointer)).toBe(true)
    await diagnostics.finish()
  })
  it('clicks the real text control when blank option-row space has no click handler',async()=>{
    await page.setContent(quizPanel('','').replace('<div class="topic-item" onclick="">A. 选项</div>',`<div class="topic-item" style="width:500px;height:80px"><span class="item-topic" onclick="this.classList.add('active');document.body.dataset.trusted=String(event.isTrusted)">A. 选项</span></div>`).replace('<button class="btn-next" onclick="">下一题</button>',''))
    const quiz=new QuizService(page,log,new FixedAnswerStrategy(0))
    expect((await quiz.handle((await quiz.findDialog())!)).state).toBe('handled')
    expect(await page.locator('body').getAttribute('data-trusted')).toBe('true')
  })
  it('allows delayed selection confirmation without toggling the selected option again',async()=>{
    await page.setContent(quizPanel("document.body.dataset.clicks=String(+(document.body.dataset.clicks||0)+1);setTimeout(()=>this.classList.add('active'),1400)",'').replace('<button class="btn-next" onclick="">下一题</button>',''))
    const quiz=new QuizService(page,log,new FixedAnswerStrategy(0))
    expect((await quiz.handle((await quiz.findDialog())!)).state).toBe('handled')
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1')
  })
  it('keeps one strategy selection when answering fails and does not hide the failure by closing',async()=>{
    await page.setContent(quizPanel('',''))
    const selectIndex=vi.fn(()=>0),quiz=new QuizService(page,log,{name:'counted',selectIndex})
    const result=await quiz.handle((await quiz.findDialog())!)
    expect(result.state).toBe('failed');expect(selectIndex).toHaveBeenCalledTimes(1)
    expect(await page.getByRole('dialog').isVisible()).toBe(true)
    expect(await page.locator('body').getAttribute('data-unknown')).toBeNull()
  })
  it('stops on an unchanged question rather than answering it repeatedly',async()=>{
    await page.setContent(quizPanel("this.classList.add('active')",''))
    const selectIndex=vi.fn(()=>0),quiz=new QuizService(page,log,{name:'counted',selectIndex})
    const result=await quiz.handle((await quiz.findDialog())!)
    expect(result).toMatchObject({state:'failed',message:'点击下一题后题目未推进'})
    expect(selectIndex).toHaveBeenCalledTimes(1)
  })
  it('yields to a challenge arriving after selection and resumes without choosing again',async()=>{
    await page.setContent(quizPanel("this.classList.add('active');document.body.insertAdjacentHTML('beforeend','<div class=&quot;yidun_modal&quot; style=&quot;position:fixed;inset:0;z-index:999;background:white&quot;>验证</div>')","this.closest('.el-dialog').remove()"))
    const selectIndex=vi.fn(()=>0),quiz=new QuizService(page,log,{name:'counted',selectIndex})
    const dialog=(await quiz.findDialog())!
    expect((await quiz.handle(dialog)).state).toBe('protected')
    await page.locator('.yidun_modal').evaluate(el=>el.remove())
    expect((await quiz.handle(dialog)).state).toBe('handled')
    expect(selectIndex).toHaveBeenCalledTimes(1)
  })
  it('does not guess unsupported question types or arbitrary footer actions',async()=>{
    await page.setContent(quizPanel("document.body.dataset.selected='yes'",'').replace('单选题','多选题'))
    const quiz=new QuizService(page,log),result=await quiz.handle((await quiz.findDialog())!)
    expect(result.state).toBe('failed')
    expect(await page.locator('body').getAttribute('data-selected')).toBeNull()
    expect(await page.locator('body').getAttribute('data-unknown')).toBeNull()
  })
  it('reports a broken close control as failure',async()=>{
    await page.setContent('<div role="dialog" aria-label="弹题测验" style="position:fixed;inset:100px;background:white"><button aria-label="Close">关闭</button></div>')
    const quiz=new QuizService(page,log)
    expect(await quiz.close((await quiz.findDialog())!)).toBe(false)
    expect(await page.getByRole('dialog').isVisible()).toBe(true)
  })
})
