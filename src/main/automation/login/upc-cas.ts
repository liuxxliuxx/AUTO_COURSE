import type { Page } from 'playwright-core'

export function buildUpcInstitutionCasUrl(state = String(Date.now())): string {
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
  timeoutMs = 30_000
): Promise<CasSubmitResult> {
  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    const form = page.locator('form#loginForm')
    if ((await form.count()) === 0 && !isCasLoginUrl(page.url())) {
      return { ok: true, finalUrl: page.url(), detail: '复用已有 CAS 会话' }
    }

    await form.waitFor({ state: 'attached', timeout: 10_000 })
    const formUrl = page.url()

    await Promise.all([
      page.waitForURL((url) => url.toString() !== formUrl, { timeout: timeoutMs }),
      form.evaluate(
        (element, credentials) => {
          const loginForm = element as HTMLFormElement
          const usernameInput = loginForm.elements.namedItem('username') as HTMLInputElement | null
          const passwordInput = loginForm.elements.namedItem('password') as HTMLInputElement | null
          if (!usernameInput || !passwordInput) {
            throw new Error('CAS 标准表单字段缺失')
          }

          usernameInput.value = credentials.username
          passwordInput.value = credentials.password
          loginForm.requestSubmit()
        },
        { username, password }
      )
    ])

    return { ok: true, finalUrl: page.url(), detail: 'CAS/OAuth 重定向完成' }
  } catch (error) {
    return { ok: false, finalUrl: page.url(), detail: String(error) }
  }
}

export function isCasLoginUrl(value: string): boolean {
  try {
    return new URL(value).pathname.includes('/cas/login')
  } catch {
    return false
  }
}
