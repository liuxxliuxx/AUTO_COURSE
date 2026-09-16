import type { Page } from 'playwright-core'
import { isInstitutionDestination, waitForAuthDestination, type AuthWaitOptions } from './auth-redirect'

// Observed in the institution entry's service URL; not evidence of why login failed.
const UPC_ZHS_OAUTH_STATE = '09876999'

export function buildUpcInstitutionCasUrl(state = UPC_ZHS_OAUTH_STATE): string {
  const service = new URL('http://upcsso.zhihuishu.com/authorize')
  service.searchParams.set('portal', '14')
  service.searchParams.set('response_type', 'code')
  service.searchParams.set('scope', 'read')
  service.searchParams.set('client_id', 'zhihuishuupc')
  service.searchParams.set('redirect_uri', 'http://oc.zhihuishu.com/oauth/callback/upc')
  service.searchParams.set('state', state)

  const cas = new URL('https://cas.upc.edu.cn/cas/login')
  cas.searchParams.set('service', service.toString())
  return cas.toString()
}

export interface CasSubmitResult {
  ok: boolean
  finalUrl: string
  detail: string
}

export async function submitCasForm(
  page: Page,
  loginUrl: string,
  username: string,
  password: string,
  timeoutMs = 45_000,
  options: AuthWaitOptions & { accepts?: (url: URL) => boolean } = {}
): Promise<CasSubmitResult> {
  const accepts = options.accepts ?? isInstitutionDestination
  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    const deadline = Date.now() + timeoutMs
    let submitted = false
    while (Date.now() < deadline) {
      if (page.isClosed() || options.shouldStop?.()) {
        return { ok: false, finalUrl: page.url(), detail: '登录已停止或课程窗口已关闭' }
      }
      if (accepts(new URL(page.url()))) {
        const ok = await waitForAuthDestination(page, accepts, {
          ...options, timeoutMs: Math.max(0, deadline - Date.now())
        })
        return {
          ok, finalUrl: page.url(),
          detail: ok ? 'CAS/OAuth 已到达授权目标页' : '授权目标页未稳定或登录已停止'
        }
      }
      // Only submit on the requested CAS origin/path, never on an OAuth transit page.
      const requested = new URL(loginUrl)
      const current = new URL(page.url())
      if (!submitted && requested.origin === current.origin && requested.pathname === current.pathname) {
        const form = page.locator('form#loginForm')
        if (await form.count()) {
          submitted = true
          await form.evaluate((element, credentials) => {
            const loginForm = element as HTMLFormElement
            const user = loginForm.elements.namedItem('username') as HTMLInputElement | null
            const pass = loginForm.elements.namedItem('password') as HTMLInputElement | null
            if (!user || !pass) throw new Error('CAS 标准表单字段缺失')
            user.value = credentials.username
            pass.value = credentials.password
            const submitter = loginForm.querySelector<HTMLInputElement>('input[type="submit"]')
            loginForm.requestSubmit(submitter ?? undefined)
          }, { username, password })
        }
      }
      await page.waitForTimeout(200)
    }
    return {
      ok: false, finalUrl: page.url(),
      detail: `等待 CAS/OAuth 完成超时（${submitted ? '已提交表单' : '尚未提交表单/已有 CAS 会话跳转'}）：${page.url()}`
    }
  } catch (error) {
    return { ok: false, finalUrl: page.url(), detail: String(error) }
  }
}
