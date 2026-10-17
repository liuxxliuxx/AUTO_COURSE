import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassicCourseNavigator } from '../../src/main/automation/classic/navigator'
import { inspectLearningReadiness } from '../../src/main/automation/classic/learning-readiness'
import { QuizService } from '../../src/main/automation/quiz'
import type { CaptchaService } from '../../src/main/automation/captcha'
import type { Logger } from '../../src/main/services/logger'
import { ClassicCourseRunner } from '../../src/main/automation/classic/classic-course-runner'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { DEFAULT_SETTINGS } from '../../src/main/services/settings-service'
import { EventBus } from '../../src/main/services/event-bus'

let browser: Browser, page: Page
const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), exception: vi.fn() }
const navigator = () => new ClassicCourseNavigator(page, log,
  { checkAndHandle: vi.fn(async () => false) } as unknown as CaptchaService,
  new QuizService(page, log), false)

// Model the real ordering: catalogue -> study record -> player metadata.
const fixture = (delay = 450, failure = false) => `
<ul><li class="video current_play" onclick="document.body.dataset.clicked='yes';if(!course.$data.preVideoInfo.studiedLessonDto.id||video.readyState<1||course.$data.isSaving)document.body.dataset.error='初始化未完成时发生点击'"><span class="catalogue_title">样本视频</span></li></ul>
<div id="runtime"></div><video></video>
${failure ? '<div role="dialog" style="position:fixed;inset:100px;background:white">学习进度提交失败，请返回学堂<button onclick="this.parentElement.remove()">关闭</button></div>' : ''}
<script>
const course={$data:{backDialog:false,preVideoInfo:{studiedLessonDto:{}},isSaving:false,saveDataFilish:false}};
// A child DOM component can be the only exposed entry into the course VM.
document.querySelector('#runtime').__vue__={$parent:course};
const video=document.querySelector('video');
let metadata=false;
Object.defineProperty(video,'readyState',{get:()=>metadata?1:0});
Object.defineProperty(video,'duration',{get:()=>metadata?357:NaN});
setTimeout(()=>course.$data.preVideoInfo.studiedLessonDto.id=123,${delay});
setTimeout(()=>metadata=true,${delay + 200});
</script>`

beforeAll(async () => { browser = await chromium.launch({ headless: true }) })
beforeEach(async () => { vi.clearAllMocks(); page = await browser.newPage() })
afterEach(async () => { vi.restoreAllMocks(); await page.close() })
afterAll(async () => { await browser?.close() })

describe('classic course initialization barrier', () => {
  it('chooses the first unfinished lesson after asynchronous account completion marks load',async()=>{
    await page.setContent(fixture(650).replace('<div id="runtime">','<li class="video"><span class="catalogue_title">未完成视频</span></li><div id="runtime">')+`<script>setTimeout(()=>document.querySelector('li.video').insertAdjacentHTML('beforeend','<i class="time_icofinish"></i>'),450)</script>`)
    const click=vi.spyOn(ClassicCourseNavigator.prototype,'clickVideoWithRetry').mockResolvedValue(false)
    const runner=new ClassicCourseRunner(()=>({method:'zhihuishu',login:async()=>({ok:true,alreadyLoggedIn:true,message:'fixture'})}))
    await runner.run({settings:{...DEFAULT_SETTINGS,videoUrl:'',skipCompleted:true,fromLastProgress:false},credentials:{username:'',password:''},session:new BrowserSession(page,()=>{}),bus:new EventBus(),log,media:null,lastVideoTitle:'',shouldStop:()=>false,sessionWatchedSeconds:()=>0,reportVideoWatched:vi.fn(),reportVideoCompleted:vi.fn(),reportCurrentTitle:vi.fn(),requestCaptcha:async()=>true})
    expect(click).toHaveBeenCalledOnce()
    expect(click.mock.calls[0][1]).toBe('未完成视频')
  })
  it('clicks the visible title when a wide catalogue row is clipped by its scroll container',async()=>{
    await page.setContent(`<div style="width:200px;height:90px;overflow:hidden"><li class="video" style="width:1000px;height:40px" onclick="document.body.dataset.clicked=String(event.isTrusted)"><span class="catalogue_title">裁剪目录</span></li></div>`)
    expect(await navigator().clickVideo(page.locator('li.video'),'裁剪目录')).toBe(true)
    expect(await page.locator('body').getAttribute('data-clicked')).toBe('true')
  })
  it('waits for both the study record and metadata before the first trusted course click', async () => {
    await page.setContent(fixture())
    expect(await page.evaluate(inspectLearningReadiness,undefined)).toMatchObject({ ready: false, reason: '学习记录尚未初始化' })
    expect(await navigator().clickVideo(page.locator('li.video'), '样本视频')).toBe(true)
    expect(await page.locator('body').getAttribute('data-error')).toBeNull()
    expect(await page.locator('body').getAttribute('data-clicked')).toBe('yes')
    expect(await page.evaluate(inspectLearningReadiness,undefined)).toMatchObject({ ready: true })
  })
  it('also waits after reloading a failed course rather than clicking the freshly rendered catalogue', async () => {
    let loads = 0
    await page.route('http://learning.test/**', async route => {
      loads++
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(450, loads === 1) })
    })
    await page.goto('http://learning.test/course')
    const nav = navigator()
    expect(await nav.clickVideoWithRetry(page.locator('li.video'), '样本视频', () => false), nav.lastClickError ?? '').toBe(true)
    expect(loads).toBe(2)
    expect(await page.locator('body').getAttribute('data-error')).toBeNull()
    expect(await page.locator('body').getAttribute('data-clicked')).toBe('yes')
  })
  it('does not proceed while the previous record is still being saved', async () => {
    await page.setContent(fixture(0))
    await page.evaluate(() => {
      const vm = (document.querySelector('#runtime') as unknown as { __vue__: { $parent: { $data: { isSaving: boolean } } } }).__vue__.$parent
      vm.$data.isSaving = true
      setTimeout(() => { vm.$data.isSaving = false }, 450)
    })
    expect(await page.evaluate(inspectLearningReadiness,undefined)).toMatchObject({ ready: false, reason: '上一节进度仍在保存或切换中' })
    expect((await navigator().waitForLearningReady()).state).toBe('clear')
    expect(await page.locator('body').getAttribute('data-clicked')).toBeNull()
  })
  it('reports initialization failure instead of clicking when the record never becomes ready', async () => {
    await page.setContent(fixture(60_000))
    const result = await navigator().waitForLearningReady(() => false, 300)
    expect(result.state).toBe('failed')
    if (result.state === 'failed') expect(result.message).toContain('课程初始化超时：学习记录尚未初始化')
    expect(await page.locator('body').getAttribute('data-clicked')).toBeNull()
  })
  it('honors stop during initialization without reporting an error or clicking', async () => {
    await page.setContent(fixture(60_000))
    const start = Date.now()
    expect((await navigator().waitForLearningReady(() => Date.now() - start > 100)).state).toBe('stopped')
    expect(log.error).not.toHaveBeenCalled()
    expect(await page.locator('body').getAttribute('data-clicked')).toBeNull()
  })
  it('requires the course runtime on the real platform even if a video shell exists', async () => {
    await page.route('https://studyvideoh5.zhihuishu.com/**', route => route.fulfill({ contentType: 'text/html', body: '<video></video><li class="video">课程</li>' }))
    await page.goto('https://studyvideoh5.zhihuishu.com/stuStudy')
    expect(await page.evaluate(inspectLearningReadiness,undefined)).toMatchObject({ ready: false, reason: '课程运行状态尚未加载' })
  })
  it('does not accept a ready old player merely because the new catalogue title is selected', async () => {
    await page.setContent(fixture(0))
    await navigator().waitForLearningReady()
    await page.evaluate(() => {
      Object.defineProperty(document.querySelector('video'), 'currentSrc', {get:()=> 'old-video', configurable:true})
      document.querySelector('.catalogue_title')!.textContent = '下一节'
    })
    const result = await navigator().waitForLearningReady(() => false, 300, {title:'下一节',previousSource:'old-video'})
    expect(result.state).toBe('failed')
    if(result.state==='failed') expect(result.message).toContain('播放器仍在使用上一节视频')
  })
  it('accepts the target only after its actual media source changes', async () => {
    await page.setContent(fixture(0))
    await navigator().waitForLearningReady()
    await page.evaluate(() => {
      const video = document.querySelector('video')!
      let source = 'old-video'
      Object.defineProperty(video, 'currentSrc', {get:()=>source})
      document.querySelector('.catalogue_title')!.textContent = '下一节'
      setTimeout(()=>{source='new-video'},450)
    })
    expect((await navigator().waitForLearningReady(() => false, 2000, {title:'下一节',previousSource:'old-video'})).state).toBe('clear')
  })
})
