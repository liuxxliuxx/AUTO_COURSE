/** 数字石大新旧登录模块回归。 */

import { chromium, type Browser, type Page } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { CaptchaService } from '../../src/main/automation/captcha'
import { UpcInstitutionLogin } from '../../src/main/automation/login/upc-institution'
import { UpcLegacyLogin } from '../../src/main/automation/login/upc-legacy'
import { buildUpcInstitutionCasUrl } from '../../src/main/automation/login/upc-cas'
import { submitCasForm } from '../../src/main/automation/login/upc-cas'
import { checkCourseSession } from '../../src/main/automation/login/session-check'
import { waitForAuthDestination } from '../../src/main/automation/login/auth-redirect'
import { ClassicCourseRunner } from '../../src/main/automation/classic/classic-course-runner'
import { MapCourseRunner } from '../../src/main/automation/map/map-course-runner'
import type { RunnerContext } from '../../src/main/automation/runner'
import { createLoginProvider } from '../../src/main/automation/login/provider'
import type { LoginContext } from '../../src/main/automation/login/provider'
import type { Logger } from '../../src/main/services/logger'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, '..', 'fixtures')
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

function context(requestCaptcha: () => Promise<boolean> = async () => false): LoginContext {
  const session = new BrowserSession(page, () => {})
  const log: Logger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, exception: () => {}
  }
  return {
    session,
    credentials: { username: '20260001', password: 'Abc123456' },
    settings: {
      videoUrl: server.origin + '/classic-course.html',
      loggedUrl: '',
      loginMethod: 'upc-institution'
    } as LoginContext['settings'],
    captcha: new CaptchaService({
      session,
      log,
      shouldStop: () => false,
      requestCaptcha
    }),
    shouldStop: () => false,
    log
  }
}

describe('数字石大登录模块', () => {
  it('新模块直接提交标准 CAS 表单并保留浏览器 Cookie', async () => {
    await page.context().clearCookies()
    const provider = new UpcInstitutionLogin({ casLoginUrl: server.origin + '/login/cas-request',
      accepts: url => url.pathname === '/cas-success' })
    const result = await provider.login(context())

    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(result.message).toContain('机构 SSO 登录成功')
    expect(page.url()).toContain('/classic-course.html')
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'fixture-sso')).toBe(true)
  })

  it('新旧实现由设置值明确选择，不互相回退', () => {
    expect(createLoginProvider('upc-institution')).toBeInstanceOf(UpcInstitutionLogin)
    expect(createLoginProvider('upc')).toBeInstanceOf(UpcLegacyLogin)
  })

  it('跳回普通登录中心时报告链路失败，不误报验证码', async () => {
    await page.context().clearCookies()
    let captchaRequests = 0
    const provider = new UpcInstitutionLogin({
      casLoginUrl: server.origin + '/login/cas-redirect-login', timeoutMs: 800
    })
    const result = await provider.login(
      context(async () => {
        captchaRequests += 1
        return true
      })
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('等待 CAS/OAuth 完成超时')
    expect(captchaRequests).toBe(0)
  })

  it('wxTransit 等待超过 500ms 后仍能完成授权，中途不导航课程页', async () => {
    await page.route('https://login.zhihuishu.com/wxTransit/3**', route => route.fulfill({
      contentType: 'text/html', body: `<script>setTimeout(() => location.href='https://hub.polymas.com/', 1800)</script>`
    }))
    await page.route('https://hub.polymas.com/', route => route.fulfill({
      contentType: 'text/html', body: '<h1>工作台</h1>'
    }))
    try {
      const result = await submitCasForm(page, 'https://login.zhihuishu.com/wxTransit/3', 'u', 'p', 6000)
      expect(result.ok, result.detail).toBe(true)
      expect(page.url()).toBe('https://hub.polymas.com/')
    } finally { await page.unrouteAll({ behavior: 'wait' }) }
  })

  it('授权一直停在 wxTransit 时不报成功，也不抢先离开页面', async () => {
    await page.route('https://login.zhihuishu.com/wxTransit/3', route => route.fulfill({ body: '' }))
    try {
      const result = await submitCasForm(page, 'https://login.zhihuishu.com/wxTransit/3', 'u', 'p', 800)
      expect(result.ok).toBe(false)
      expect(page.url()).toContain('/wxTransit/3')
    } finally { await page.unrouteAll({ behavior: 'wait' }) }
  })

  it('旧门户等待异步认证落地，才允许打开 forward 工作台', async () => {
    await page.context().clearCookies()
    let authenticated = false
    let forwardedBeforeAuth = false
    let forwarded = false
    const probe = vi.spyOn(page.request, 'get').mockResolvedValue({
      url: () => 'https://cas.upc.edu.cn/cas/login'
    } as Awaited<ReturnType<typeof page.request.get>>)
    await page.route('https://i.upc.edu.cn/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/') {
        await route.fulfill({ contentType: 'text/html', body: `<script>location.href='https://cas.upc.edu.cn/cas/login'</script>` })
      } else if (path === '/dcp/index.jsp') {
        authenticated = true
        await route.fulfill({ contentType: 'text/html', body: '<h1>门户</h1>' })
      } else {
        forwarded = true
        forwardedBeforeAuth = !authenticated
        await route.fulfill({ contentType: 'text/html', body: `<script>location.href='${server.origin}/cas-success'</script>` })
      }
    })
    await page.route('https://cas.upc.edu.cn/cas/**', route => route.fulfill({
      contentType: 'text/html',
      body: route.request().url().endsWith('login-normal')
        ? `<div id="app"></div><script>document.querySelector('#app').__vue__={passwordLogin(){setTimeout(()=>parent.location.href='https://i.upc.edu.cn/dcp/index.jsp',1800)}}</script>`
        : '<iframe src="/cas/login-normal" style="width:500px;height:500px"></iframe>'
    }))
    try {
      const ctx = context()
      ctx.settings.loggedUrl = server.origin + '/cas-success'
      const result = await new UpcLegacyLogin().login(ctx)
      expect(result.ok, result.message + ' ' + page.url()).toBe(true)
      expect(forwarded).toBe(true)
      expect(forwardedBeforeAuth).toBe(false)
    } finally {
      probe.mockRestore()
      await page.unrouteAll({ behavior: 'wait' })
    }
  })

  it('等待门户期间用户停止会立即退出，不等待完整超时', async () => {
    await page.goto(server.origin + '/login/center.html')
    const start = Date.now()
    expect(await waitForAuthDestination(page, () => false, { shouldStop: () => true })).toBe(false)
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it.each(['classic', 'map'] as const)('登录失败时 %s 运行器保留当前页并返回 error', async mode => {
    await page.goto(server.origin + '/login/center.html')
    const before = page.url()
    const login = vi.fn(async () => ({ ok: false, alreadyLoggedIn: false, message: '授权尚未完成' }))
    const failing = () => ({ method: 'upc' as const, login })
    const ctx = { ...context(), settings: { ...context().settings,
      videoUrl: 'https://hike.zhihuishu.com/singleCourse/knowledgeStudy/123/456'
    }, reportVideoCompleted: vi.fn(), reportVideoWatched: vi.fn() } as unknown as RunnerContext
    const runner = mode === 'classic' ? new ClassicCourseRunner(failing) : new MapCourseRunner(failing)
    const result = await runner.run(ctx)
    expect(login).toHaveBeenCalledOnce()
    expect(result.reason).toBe('error')
    expect(page.url()).toBe(before)
    expect(ctx.reportVideoCompleted).not.toHaveBeenCalled()
  })

  it('传统课 URL 暂时不变但目录未加载时，等待并识别后续登录跳转', async () => {
    const course = 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=fixture'
    await page.context().addCookies([{ name: 'fixture-session', value: 'expired', domain: '.zhihuishu.com', path: '/' }])
    await page.route('https://studyvideoh5.zhihuishu.com/**', route => route.fulfill({
      contentType: 'text/html', body: `<script>setTimeout(()=>location.href='https://login.zhihuishu.com/', 1800)</script>`
    }))
    await page.route('https://login.zhihuishu.com/', route => route.fulfill({ body: '<h1>登录</h1>' }))
    try {
      const ctx = context()
      ctx.settings.videoUrl = course
      expect((await checkCourseSession(ctx)).loggedIn).toBe(false)
      expect(page.url()).toBe('https://login.zhihuishu.com/')
    } finally {
      await page.unrouteAll({ behavior: 'wait' })
      await page.context().clearCookies()
    }
  })

  it('机构 CAS 地址直接指向智慧树 OAuth，不依赖机构搜索 UI', () => {
    const url = new URL(buildUpcInstitutionCasUrl())
    const service = new URL(url.searchParams.get('service')!)
    expect(url.hostname).toBe('cas.upc.edu.cn')
    expect(service.hostname).toBe('upcsso.zhihuishu.com')
    expect(service.searchParams.get('client_id')).toBe('zhihuishuupc')
    expect(service.searchParams.get('state')).toBe('09876999')
  })
})
