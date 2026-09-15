/**
 * 智慧树登录（改版后的「登录中心」）局部回归。
 *
 * 线上问题：课程页把未登录的会话重定向到登录页后，登录流程用的还是 v1 的
 * 老入口 `onlineweb.zhihuishu.com` + 老选择器（`#lUsername`/`.wall-sub-btn`），
 * 那边表单已经藏进弹窗、不可见 → 找不到输入框 → **既不重试也不提示**，整轮停住。
 *
 * 夹具 `login/center.html` 复刻改版后的结构。这里钉两件事：
 *  1. 新表单能被找到并填上（选择器跟着站点改）；
 *  2. 第一轮失败会**重来**，第二轮成功。
 */

import { chromium, type Browser, type Page } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { CaptchaService } from '../../src/main/automation/captcha'
import { ZhihuishuLogin } from '../../src/main/automation/login/zhihuishu'
import type { LoginContext } from '../../src/main/automation/login/provider'
import type { Logger } from '../../src/main/services/logger'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, '..', 'fixtures')

let server: FixtureServer
let browser: Browser
let page: Page
let session: BrowserSession

beforeAll(async () => {
  server = await startFixtureServer(fixturesDir)
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
  session = new BrowserSession(page, () => {})
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

interface Harness {
  ctx: LoginContext
  logs: string[]
  manualRequests: string[]
}

async function makeContext(): Promise<Harness> {
  const logs: string[] = []
  const manualRequests: string[] = []
  const log: Logger = {
    debug: () => {},
    info: (m) => logs.push(m),
    warn: (m) => logs.push(`WARN ${m}`),
    error: (m) => logs.push(`ERROR ${m}`),
    exception: () => {}
  }
  const captcha = new CaptchaService({
    session,
    shouldStop: () => false,
    log,
    requestCaptcha: async (_scene, message) => {
      manualRequests.push(message)
      return true
    }
  })
  return {
    ctx: {
      session,
      credentials: { username: '13800000000', password: 'Abc123456' },
      // videoUrl 置空 → checkCourseSession 不去导航（保住夹具页）
      settings: { videoUrl: '', loggedUrl: '', loginMethod: 'zhihuishu' } as LoginContext['settings'],
      captcha,
      shouldStop: () => false,
      log
    },
    logs,
    manualRequests
  }
}

describe('ZhihuishuLogin（新版登录中心）', () => {
  it('能填上账号密码、点到登录，并判定登录成功', async () => {
    await page.goto(`${server.origin}/login/center.html`)
    await page.evaluate(() => sessionStorage.clear())

    const harness = await makeContext()
    const provider = new ZhihuishuLogin({
      loginUrl: `${server.origin}/login/center.html`,
      attemptTimeoutMs: 5_000
    })
    const result = await provider.login(harness.ctx)

    expect(result.ok).toBe(true)
    expect(harness.logs.join('\n')).toContain('已填入账号')
    expect(harness.logs.join('\n')).toContain('已填入密码')
    // 成功路径不该打扰用户
    expect(harness.manualRequests).toHaveLength(0)
  })

  it('第一轮找不到表单会重来，第二轮成功', async () => {
    await page.goto(`${server.origin}/login/center.html`)
    await page.evaluate(() => sessionStorage.clear())

    const harness = await makeContext()
    const provider = new ZhihuishuLogin({
      loginUrl: `${server.origin}/login/center.html?slowform=1`,
      maxAttempts: 3,
      attemptTimeoutMs: 5_000
    })
    const result = await provider.login(harness.ctx)
    const text = harness.logs.join('\n')

    expect(text).toContain('账号密码登录 第 1/3 次')
    expect(text).toContain('账号密码登录 第 2/3 次')
    expect(text).toContain('第 1 次登录未成功')
    expect(result.ok).toBe(true)
  })

  it('点了登录仍停在登录页时，重试用完才请人工介入', async () => {
    await page.goto(`${server.origin}/login/center.html`)
    await page.evaluate(() => sessionStorage.clear())

    const harness = await makeContext()
    const provider = new ZhihuishuLogin({
      loginUrl: `${server.origin}/login/center.html?fail=1`,
      maxAttempts: 2,
      attemptTimeoutMs: 600
    })
    const result = await provider.login(harness.ctx)
    const text = harness.logs.join('\n')

    expect(text).toContain('账号密码登录 第 1/2 次')
    expect(text).toContain('账号密码登录 第 2/2 次')
    expect(text).toContain('仍停留在登录页')
    // 自动失败后才提示人工（以前这里是"没有验证码就直接返回失败"，用户看不到任何提示）
    expect(harness.manualRequests).toHaveLength(1)
    expect(result.ok).toBe(true) // 用户确认后按"已人工登录"处理
  })
})
