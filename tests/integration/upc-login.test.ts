/** 数字石大新旧登录模块回归。 */

import { chromium, type Browser, type Page } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { CaptchaService } from '../../src/main/automation/captcha'
import { UpcInstitutionLogin } from '../../src/main/automation/login/upc-institution'
import { UpcLegacyLogin } from '../../src/main/automation/login/upc-legacy'
import { buildUpcInstitutionCasUrl } from '../../src/main/automation/login/upc-cas'
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

function context(): LoginContext {
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
      requestCaptcha: async () => false
    }),
    shouldStop: () => false,
    log
  }
}

describe('数字石大登录模块', () => {
  it('新模块直接提交标准 CAS 表单并保留浏览器 Cookie', async () => {
    await page.context().clearCookies()
    const provider = new UpcInstitutionLogin({ casLoginUrl: server.origin + '/login/cas-request' })
    const result = await provider.login(context())

    expect(result.ok).toBe(true)
    expect(result.message).toContain('机构 SSO 登录成功')
    expect(page.url()).toContain('/classic-course.html')
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'fixture-sso')).toBe(true)
  })

  it('新旧实现由设置值明确选择，不互相回退', () => {
    expect(createLoginProvider('upc-institution')).toBeInstanceOf(UpcInstitutionLogin)
    expect(createLoginProvider('upc')).toBeInstanceOf(UpcLegacyLogin)
  })

  it('机构 CAS 地址直接指向智慧树 OAuth，不依赖机构搜索 UI', () => {
    const url = new URL(buildUpcInstitutionCasUrl('123'))
    const service = new URL(url.searchParams.get('service')!)
    expect(url.hostname).toBe('cas.upc.edu.cn')
    expect(service.hostname).toBe('upcsso.zhihuishu.com')
    expect(service.searchParams.get('client_id')).toBe('zhihuishuupc')
    expect(service.searchParams.get('state')).toBe('123')
  })
})
