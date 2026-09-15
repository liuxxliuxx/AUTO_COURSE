/**
 * 回归测试：学习页的「检测到异常脚本」守卫。
 *
 * 线上问题（2026-09-15）：传统课刷课跑几秒就弹「检测到异常脚本…」，
 * 3 秒后 `location.replace('https://www.zhihuishu.com')` 跳回学堂首页。
 *
 * 站点侧的依据（从 studyvideoh5 的 app.js / stuStudy.js 里解出来的原文）：
 *
 *   document.getElementById('container').addEventListener('click', function (e) {
 *     e.preventDefault()
 *     if (e instanceof Event && !e.isTrusted) {
 *       $alert('检测到异常脚本，为保证您的正常学习进度，请您关闭插件后，回到学堂重新进入视频学习页正常学习', ...)
 *       ablePlayerX('container').pause()
 *       setTimeout(function () { window.location.replace('https://www.zhihuishu.com') }, 3000)
 *     }
 *   })
 *
 * 夹具 `anti-script-guard.html` 复刻了这段守卫 + 播放器的点击捕获层。
 * 这里要钉死的是：**自动化代码不允许再派发合成点击**（`element.click()`），
 * 被遮罩挡住时必须换用 `locator.click({ force: true })`，事件仍然可信。
 */

import { chromium, type Browser, type Page } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { VideoController } from '../../src/main/automation/classic/video-controller'
import { safeClick } from '../../src/main/automation/locators'
import type { Logger } from '../../src/main/services/logger'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, '..', 'fixtures')

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  exception: () => {}
}

let server: FixtureServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await startFixtureServer(fixturesDir)
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

beforeEach(async () => {
  await page.goto(`${server.origin}/anti-script-guard.html`)
  await page.waitForFunction(() => (window as never as { __mediaReady?: boolean }).__mediaReady === true, null, {
    timeout: 20_000
  })
})

interface GuardState {
  scriptDetected: boolean
  clicks: Array<{ target: string; trusted: boolean; pointer: boolean }>
}

const guardState = (): Promise<GuardState> =>
  page.evaluate(() => {
    const w = window as never as { __scriptDetected: boolean; __clicks: GuardState['clicks'] }
    return { scriptDetected: w.__scriptDetected, clicks: w.__clicks }
  })

describe('防脚本守卫夹具自身', () => {
  it('合成点击会被判成异常脚本（守卫没写空）', async () => {
    await page.evaluate(() => document.getElementById('bigPlay')?.click())
    const state = await guardState()
    expect(state.scriptDetected).toBe(true)
    expect(state.clicks.at(-1)?.trusted).toBe(false)
  })
})

describe('VideoController.play() 不使用合成点击', () => {
  it('大播放按钮被捕获层挡住时，仍然用可信点击开始播放', async () => {
    const video = new VideoController(page, silentLog)
    const started = await video.play()

    expect(started).toBe(true)
    expect(await video.isPlaying()).toBe(true)

    const state = await guardState()
    // 关键断言：没有触发「检测到异常脚本」
    expect(state.scriptDetected).toBe(false)
    expect(state.clicks.length).toBeGreaterThan(0)
    expect(state.clicks.every((c) => c.trusted)).toBe(true)
  })

  it('safeClick 在被遮挡时退回的是可信的坐标点击', async () => {
    const covered = page.locator('#bigPlay').first()
    const startedAt = Date.now()
    expect(await safeClick(covered, 2_000)).toBe(true)
    // 被遮罩时不再先等一个 timeout：识别到遮挡就直接按坐标点
    expect(Date.now() - startedAt).toBeLessThan(500)

    const state = await guardState()
    expect(state.scriptDetected).toBe(false)
    expect(state.clicks.every((c) => c.trusted)).toBe(true)
  })
})
