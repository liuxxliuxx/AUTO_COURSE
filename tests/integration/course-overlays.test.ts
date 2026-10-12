import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseOverlays } from '../../src/main/automation/classic/course-overlays'
import { ClassicCourseNavigator } from '../../src/main/automation/classic/navigator'
import { ClassicCourseRunner } from '../../src/main/automation/classic/classic-course-runner'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { DEFAULT_SETTINGS } from '../../src/main/services/settings-service'
import { EventBus } from '../../src/main/services/event-bus'
import type { RunnerContext } from '../../src/main/automation/runner'
import { CLICK_VIDEO_MAX_RETRIES } from '../../src/main/automation/constants'
import type { CaptchaService } from '../../src/main/automation/captcha'
import type { QuizService } from '../../src/main/automation/quiz'
import type { Logger } from '../../src/main/services/logger'

const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), exception: vi.fn() }
let browser: Browser
let page: Page
let overlays: CourseOverlays
const markup = `
  <style>
    #catalogue {position:absolute;right:24px;top:120px;width:300px}
    li.video {height:45px;background:#ddd;cursor:pointer}
    #assistant {position:fixed;right:20px;top:90px;width:320px;height:400px;z-index:100;border-radius:24px;background:#dde7ff}
    #assistant i {position:absolute;right:15px;top:15px;width:24px;height:24px;cursor:pointer}
    #assistant .content {padding:50px 20px}
  </style>
  <ul id="catalogue"><li class="video"><span class="catalogue_title">1.1 计算机网络起源</span></li></ul>
  <div id="assistant" class="arbitrary-v4-name">
    <i class="arbitrary-icon-v7">×</i>
    <div class="content"><b>王同学</b><p>欢迎你加入课程计算机网络，学习过程中有任何疑问可寻求小智帮助哦~</p>
    <p>课程学习时间：2026-08-15 至 2026-11-30</p><p>考试时间：2026-12-01 至 2026-12-10</p><p>考核比：总成绩100分</p></div>
  </div>`
const navigator = () => new ClassicCourseNavigator(page, log,
  { checkAndHandle: vi.fn(async () => false) } as unknown as CaptchaService,
  { findDialog: vi.fn(async () => null) } as unknown as QuizService, false)

beforeAll(async () => { browser = await chromium.launch({ headless: true }) })
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await page.setContent(markup)
  overlays = new CourseOverlays(page, log)
})
afterEach(async () => { vi.restoreAllMocks(); await page.close() })
afterAll(async () => { await browser?.close() })

describe('passive course overlays', () => {
  it('closes a screenshot-style assistant with unknown classes using a trusted event', async () => {
    await page.evaluate(() => {
      document.querySelector('#assistant i')!.addEventListener('click', event => {
        document.body.dataset.trusted = String(event.isTrusted)
        document.querySelector('#assistant')!.remove()
      })
    })
    expect(await overlays.obstruction(page.locator('li.video'))).not.toBeNull()
    expect(await overlays.dismiss()).toBe(1)
    expect(await page.locator('body').getAttribute('data-trusted')).toBe('true')
    expect(await overlays.obstruction(page.locator('li.video'))).toBeNull()
    await page.locator('li.video').click()
  })
  it('finds an unlabelled corner control by layout and handles changed welcome text', async () => {
    await page.evaluate(() => {
      document.querySelector('#assistant p')!.textContent = '本学期课程安排'
      const old = document.querySelector('#assistant i')!
      const control = document.createElement('div')
      control.style.cssText = 'position:absolute;right:10px;top:10px;width:25px;height:25px;cursor:pointer'
      control.innerHTML = '<svg width="20" height="20"><path d="M0 0L20 20M0 20L20 0"/></svg>'
      control.addEventListener('click', event => { document.body.dataset.trusted = String(event.isTrusted); document.querySelector('#assistant')!.remove() })
      old.replaceWith(control)
    })
    expect(await overlays.dismiss()).toBe(1)
    expect(await page.locator('body').getAttribute('data-trusted')).toBe('true')
  })
  it('recognizes welcome copy split across styled spans and whitespace', async () => {
    await page.locator('#assistant .content').evaluate(el => {
      el.innerHTML = '<p><span>欢迎</span> 你加入课程</p><p>本学期课程通知</p>'
    })
    expect(await overlays.dismiss()).toBe(1)
    expect(await page.locator('#assistant').count()).toBe(0)
  })
  it('verifies dismissal and removes only the passive card if its close control is broken', async () => {
    expect(await overlays.dismiss()).toBe(1)
    expect(await page.locator('#assistant').count()).toBe(0)
    expect(await page.locator('li.video').count()).toBe(1)
    expect(await overlays.dismiss()).toBe(0)
  })
  it('handles cards without controls and ignores matching text in regular page content', async () => {
    await page.evaluate(() => {
      document.querySelector('#assistant i')!.remove()
      const content = document.createElement('section'); content.id = 'normal'
      content.innerHTML = '<p>课程学习时间</p><p>考试时间</p>'
      document.body.append(content)
    })
    expect(await overlays.dismiss()).toBe(1)
    expect(await page.locator('#normal').count()).toBe(1)
    expect(await page.locator('li.video').count()).toBe(1)
  })
  it('preserves normal course copy within an absolute page layout', async () => {
    await page.evaluate(() => {
      document.querySelector('#assistant')!.remove()
      const layout = document.createElement('main')
      layout.style.cssText = 'position:absolute;inset:0'
      layout.innerHTML = '<section id="normal"><p>欢迎你加入课程</p><p>课程学习时间</p><p>考试时间</p></section><ul><li class="video">课程目录</li></ul>'
      document.body.append(layout)
    })
    expect(await overlays.dismiss()).toBe(0)
    expect(await page.locator('#normal').count()).toBe(1)
  })
  it('ignores hidden cards and preserves captcha/question controls', async () => {
    await page.evaluate(() => {
      const assistant = document.querySelector('#assistant') as HTMLElement
      assistant.style.display = 'none'
      for (const className of ['yidun_popup', 'topic-option-item']) {
        const dialog = assistant.cloneNode(true) as HTMLElement
        dialog.id = className; dialog.className = className; dialog.style.cssText = 'position:fixed;right:20px;top:90px;width:320px;height:400px;z-index:200;display:block'
        document.body.append(dialog)
      }
    })
    expect(await overlays.dismiss()).toBe(0)
    expect(await page.locator('#yidun_popup').count()).toBe(1)
    expect(await page.locator('#topic-option-item').count()).toBe(1)
  })
  it('handles stacked legacy progress and assistant cards', async () => {
    await page.evaluate(() => {
      const progress = document.createElement('div')
      progress.className = 'ss2077-msg-custom'
      progress.style.cssText = 'position:fixed;left:10px;top:10px;width:300px;height:100px;z-index:200;background:white'
      progress.innerHTML = '<p>学习进度：班级平均学习进度</p>'
      document.body.append(progress)
    })
    expect(await overlays.dismiss()).toBe(2)
    expect(await page.locator('.ss2077-msg-custom, #assistant').count()).toBe(0)
  })
  it('clears a late card before clicking a lesson', async () => {
    await page.evaluate(() => document.querySelector('#assistant i')!.addEventListener('click', () => document.querySelector('#assistant')!.remove()))
    const nav = navigator()
    vi.spyOn(page, 'waitForTimeout').mockResolvedValue(undefined)
    expect(await nav.clickVideo(page.locator('li.video'), '网络起源')).toBe(true)
    expect(await page.locator('#assistant').count()).toBe(0)
  })
  it('reports an unknown blocker quickly instead of forcing a click through it', async () => {
    await page.evaluate(() => {
      document.querySelector('#assistant')!.remove()
      const blocker = document.createElement('div'); blocker.id = 'unknown'
      blocker.style.cssText = 'position:fixed;inset:0;z-index:999;background:white'
      blocker.textContent = '未知遮挡'
      blocker.addEventListener('click', () => { document.body.dataset.wrongClick = 'true' })
      document.body.append(blocker)
    })
    const start = Date.now()
    expect(await navigator().clickVideo(page.locator('li.video'), '网络起源')).toBe(false)
    expect(Date.now() - start).toBeLessThan(2000)
    expect(await page.locator('body').getAttribute('data-wrong-click')).toBeNull()
    expect(await page.locator('#unknown').count()).toBe(1)
  })
  it('bounds retry count and honors stopping before a click', async () => {
    await page.locator('#assistant').evaluate(el => el.remove())
    const nav = navigator()
    const click = vi.spyOn(nav, 'clickVideo').mockResolvedValue(false)
    vi.spyOn(nav, 'handleInitialDialogs').mockResolvedValue(undefined)
    vi.spyOn(page, 'waitForTimeout').mockResolvedValue(undefined)
    expect(await nav.clickVideoWithRetry(page.locator('li.video'), '网络起源', () => false)).toBe(false)
    expect(click).toHaveBeenCalledTimes(CLICK_VIDEO_MAX_RETRIES + 1)
    click.mockClear()
    expect(await nav.clickVideoWithRetry(page.locator('li.video'), '网络起源', () => true)).toBe(false)
    expect(click).not.toHaveBeenCalled()
  })
  it('ends with an actionable error rather than skipping every blocked lesson', async () => {
    const click = vi.spyOn(ClassicCourseNavigator.prototype, 'clickVideoWithRetry').mockResolvedValue(false)
    const next = vi.spyOn(ClassicCourseNavigator.prototype, 'nextVideoAfter')
    const completed = vi.fn()
    const ctx: RunnerContext = {
      settings: { ...DEFAULT_SETTINGS, videoUrl: '', skipCompleted: false },
      credentials: { username: '', password: '' },
      session: new BrowserSession(page, () => {}), bus: new EventBus(), log, media: null,
      lastVideoTitle: '', shouldStop: () => false, sessionWatchedSeconds: () => 0,
      reportVideoWatched: vi.fn(), reportVideoCompleted: completed, reportCurrentTitle: vi.fn(), requestCaptcha: async () => true,
    }
    const runner = new ClassicCourseRunner(() => ({ method: 'zhihuishu', login: async () => ({ ok: true, alreadyLoggedIn: true, message: 'fixture' }) }))
    const result = await runner.run(ctx)
    expect(result.reason).toBe('error')
    expect(result.error?.message).toContain('关闭遮挡浮层')
    expect(result.completedCount).toBe(0)
    expect(click).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
    expect(completed).not.toHaveBeenCalled()
  })

})

const failure = `<div id="failure" class="ss2077-msg-custom" style="position:fixed;inset:0;z-index:999;background:white">
  <h3>温馨提示</h3><p>因网络连接问题，导致学习进度提交失败，为保证您不丢失学习进度，请回到学堂重新进入视频学习页。</p>
  <button onclick="document.body.dataset.returned='true'">返回学堂</button></div>`
const catalogue = `<ul><li class="video" style="height:45px" onclick="document.body.dataset.clicked='first'"><span class="catalogue_title">起源</span></li>
  <li class="video" style="height:45px" onclick="document.body.dataset.clicked='second'"><span class="catalogue_title">定义与分类</span></li></ul>`

async function recoveryFixture(persistent = false, changed = false): Promise<() => number> {
  let loads = 0
  await page.route('http://recovery.test/**', async route => {
    loads++
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: catalogue.replace('起源', changed && loads > 1 ? '目录已改变' : '起源') +
      (loads === 1 || persistent ? failure : '') })
  })
  await page.goto('http://recovery.test/course')
  return () => loads
}

describe('blocker classification and page recovery', () => {
  it('preserves a progress submission error rather than removing it as a passive card', async () => {
    await page.setContent(catalogue + failure)
    expect(await overlays.dismiss()).toBe(0)
    expect((await overlays.inspect(page.locator('li.video').last()))?.reloadRequired).toBe(true)
    expect(await page.locator('#failure').count()).toBe(1)
  })
  it('reloads the course and clicks the original pending lesson without returning to the school', async () => {
    const loads = await recoveryFixture()
    const nav = navigator()
    vi.spyOn(page, 'waitForTimeout').mockResolvedValue(undefined)
    expect(await nav.clickVideoWithRetry(page.locator('li.video').last(), '定义与分类', () => false), nav.lastClickError ?? '').toBe(true)
    expect(loads()).toBe(2)
    expect(await page.locator('body').getAttribute('data-clicked')).toBe('second')
    expect(await page.locator('body').getAttribute('data-returned')).toBeNull()
    expect(nav.lastClickError).toBeNull()
  })
  it('continues a transcription run after recovery without reprocessing saved lessons', async () => {
    let loads = 0
    await page.route('http://runner-recovery.test/**', async route => {
      loads++
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: catalogue })
    })
    await page.goto('http://runner-recovery.test/course')
    vi.spyOn(page, 'waitForTimeout').mockResolvedValue(undefined)
    const transcribeOnly = vi.fn(async (_session: BrowserSession, title: string) => {
      if (title === '起源') await page.locator('body').evaluate((body, html) => body.insertAdjacentHTML('beforeend', html), failure)
      return true
    })
    const ctx: RunnerContext = {
      settings: { ...DEFAULT_SETTINGS, videoUrl: page.url(), skipCompleted: false, brushEnabled: false, mapMode: false },
      credentials: { username: '', password: '' },
      session: new BrowserSession(page, () => {}), bus: new EventBus(), log,
      media: { transcribeOnly } as unknown as RunnerContext['media'],
      lastVideoTitle: '', shouldStop: () => false, sessionWatchedSeconds: () => 0,
      reportVideoWatched: vi.fn(), reportVideoCompleted: vi.fn(), reportCurrentTitle: vi.fn(), requestCaptcha: async () => true,
    }
    const runner = new ClassicCourseRunner(() => ({ method: 'zhihuishu', login: async () => ({ ok: true, alreadyLoggedIn: true, message: 'fixture' }) }))
    const result = await runner.run(ctx)
    expect(result.reason).toBe('completed')
    expect(result.completedCount).toBe(2)
    expect(transcribeOnly.mock.calls.map(call => call[1])).toEqual(['起源', '定义与分类'])
    expect(loads).toBe(2)
  })
  it('bounds recovery to two reloads and reports the real network error', async () => {
    const loads = await recoveryFixture(true)
    const nav = navigator()
    vi.spyOn(page, 'waitForTimeout').mockResolvedValue(undefined)
    expect(await nav.clickVideoWithRetry(page.locator('li.video').last(), '定义与分类', () => false)).toBe(false)
    expect(loads()).toBe(3)
    expect(nav.lastClickError).toContain('学习进度提交失败')
    expect(nav.lastClickError).toContain('已重载 2 次')
    expect(await page.locator('body').getAttribute('data-clicked')).toBeNull()
  })
  it('stops if a refreshed catalogue changed instead of clicking a stale index', async () => {
    const loads = await recoveryFixture(false, true)
    const nav = navigator()
    expect(await nav.clickVideoWithRetry(page.locator('li.video').last(), '定义与分类', () => false)).toBe(false)
    expect(loads()).toBe(2)
    expect(nav.lastClickError).toContain('课程目录在恢复后发生变化')
    expect(await page.locator('body').getAttribute('data-clicked')).toBeNull()
  })
  it('honors a stop received during reload', async () => {
    const loads = await recoveryFixture()
    const nav = navigator()
    expect(await nav.clickVideoWithRetry(page.locator('li.video').last(), '定义与分类', () => loads() > 1)).toBe(false)
    expect(loads()).toBe(2)
    expect(await page.locator('body').getAttribute('data-clicked')).toBeNull()
  })
  it('finds error content in a dialog next to a full-page mask', async () => {
    await page.setContent(catalogue + `<div style="position:fixed;inset:0;z-index:100;background:white"></div>
      <div class="unknown-dialog-v8" style="position:fixed;left:20px;top:400px;z-index:101">网络连接异常，请重新进入视频学习页</div>`)
    expect((await overlays.inspect(page.locator('li.video').last()))?.reloadRequired).toBe(true)
  })
  it('dismisses an unfamiliar dialog with an explicit button and verifies a trusted click', async () => {
    await page.setContent(catalogue + `<div id="notice" style="position:fixed;inset:0;z-index:99;background:white">
      任意课程通知 <button onclick="document.body.dataset.trusted=event.isTrusted;this.parentElement.remove()">知道了</button></div>`)
    const nav = navigator()
    vi.spyOn(page, 'waitForTimeout').mockResolvedValue(undefined)
    expect(await nav.clickVideoWithRetry(page.locator('li.video').last(), '定义与分类', () => false), nav.lastClickError ?? '').toBe(true)
    expect(await page.locator('body').getAttribute('data-trusted')).toBe('true')
    expect(await page.locator('body').getAttribute('data-clicked')).toBe('second')
  })
  it('stops after two identical unknown obstructions without clicking unknown confirmation controls', async () => {
    await page.setContent(catalogue + `<div id="unknown" style="position:fixed;inset:0;z-index:99;background:white">
      未知操作 <button onclick="document.body.dataset.wrong='true'">确认提交</button></div>`)
    const nav = navigator()
    const click = vi.spyOn(nav, 'clickVideo')
    vi.spyOn(page, 'waitForTimeout').mockResolvedValue(undefined)
    expect(await nav.clickVideoWithRetry(page.locator('li.video').last(), '定义与分类', () => false)).toBe(false)
    expect(click).toHaveBeenCalledTimes(2)
    expect(nav.lastClickError).toContain('未知操作')
    expect(await page.locator('#unknown').count()).toBe(1)
    expect(await page.locator('body').getAttribute('data-wrong')).toBeNull()
  })
  it.each(['yidun_popup', 'topic-option-item'])('preserves %s even with an explicit close button', async className => {
    await page.setContent(catalogue + `<div class="${className}" style="position:fixed;inset:0;z-index:99;background:white">
      需要处理的内容 <button>关闭</button></div>`)
    const blocker = await overlays.inspect(page.locator('li.video').last())
    expect(blocker?.reloadRequired).toBe(false)
    expect(blocker?.closeId).toBeNull()
  })
  it('does not report a broken close button as successful dismissal', async () => {
    await page.setContent(catalogue + `<div id="broken" style="position:fixed;inset:0;z-index:99;background:white">通知 <button>知道了</button></div>`)
    const nav = navigator()
    vi.spyOn(page, 'waitForTimeout').mockResolvedValue(undefined)
    expect(await nav.clickVideoWithRetry(page.locator('li.video').last(), '定义与分类', () => false)).toBe(false)
    expect(await page.locator('#broken').count()).toBe(1)
    expect(await page.locator('body').getAttribute('data-clicked')).toBeNull()
  })
})
