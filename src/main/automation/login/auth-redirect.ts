import type { Page } from 'playwright-core'

export interface AuthWaitOptions {
  timeoutMs?: number
  shouldStop?: () => boolean
}

/** Only the expected landing page can finish authentication; redirects are not success. */
export async function waitForAuthDestination(
  page: Page,
  accepts: (url: URL) => boolean,
  options: AuthWaitOptions = {}
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? 45_000)
  let candidate = ''
  let since = 0
  while (Date.now() < deadline) {
    if (page.isClosed() || options.shouldStop?.()) return false
    const current = page.url()
    let accepted = false
    try { accepted = accepts(new URL(current)) } catch { /* Navigation not ready. */ }
    if (accepted) {
      if (candidate !== current) {
        candidate = current
        since = Date.now()
      }
      if (Date.now() - since >= 1_500) return true
    } else {
      candidate = ''
      since = 0
    }
    try { await page.waitForTimeout(200) } catch { return false }
  }
  return false
}

export function isInstitutionDestination(url: URL): boolean {
  return (
    (url.hostname === 'hub.polymas.com' && !url.pathname.includes('/login')) ||
    url.hostname === 'onlineweb.zhihuishu.com' ||
    (url.hostname === 'onlineh5.zhihuishu.com' && url.pathname === '/onlineWeb.html') ||
    (url.hostname === 'studyvideoh5.zhihuishu.com' && url.pathname === '/stuStudy')
  )
}
