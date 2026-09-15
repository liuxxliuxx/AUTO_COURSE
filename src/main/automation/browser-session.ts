/**
 * BrowserSession —— handoff §6 的 BrowserAutomation 抽象。
 *
 * 课程业务（LoginService / ClassicCourseRunner / MapCourseRunner / QuizService /
 * CaptchaService）只认这个接口，**不自行管理 Chromium 生命周期**，
 * 也不直接持有 Playwright 的 ElectronApplication。
 *
 * 接口刻意直接暴露 Playwright 的 Locator / FrameLocator：
 * handoff §4 的目标就是"最终使用 Playwright API"，
 * 再包一层自造的 Locator 只会削弱 auto-wait 与严格模式。
 */

import type { BrowserContext, Cookie, Locator, FrameLocator, Page } from 'playwright-core'
import { createLogger } from '../services/logger'

const logger = createLogger('browser-session')

export interface NavigationRecord {
  url: string
  at: number
}

export class BrowserSession {
  private readonly navigations: NavigationRecord[] = []
  private readonly navigationListeners = new Set<(record: NavigationRecord) => void>()
  private closed = false

  constructor(
    readonly page: Page,
    /** 会话被外部关闭（例如用户手动关掉课程窗口）时的回调 */
    private readonly onClosed: (reason: string) => void
  ) {
    this.page.on('framenavigated', (frame) => {
      if (frame !== this.page.mainFrame()) return
      const record = { url: frame.url(), at: Date.now() }
      this.navigations.push(record)
      if (this.navigations.length > 200) this.navigations.shift()
      for (const listener of this.navigationListeners) {
        try {
          listener(record)
        } catch (error) {
          logger.exception('导航订阅者抛错', error)
        }
      }
    })

    this.page.on('close', () => {
      this.closed = true
      this.onClosed('课程窗口已关闭')
    })
  }

  get isClosed(): boolean {
    return this.closed || this.page.isClosed()
  }

  // -------------------------------------------------------------- 导航

  async navigate(url: string, timeoutMs = 60_000): Promise<void> {
    logger.info(`导航到 ${url}`)
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  }

  getCurrentUrl(): string {
    return this.page.url()
  }

  /** 当前是否已落在目标 URL 上；用于 v1 `check_already_logged_in` 的等价判断 */
  urlContains(fragment: string): boolean {
    if (!fragment) return true
    return this.getCurrentUrl().includes(fragment)
  }

  /** 等待 URL 命中条件；返回是否命中（不抛错，与 v1 的"超时也继续"语义一致） */
  async waitForUrlContains(fragment: string, timeoutMs: number): Promise<boolean> {
    if (!fragment) return true
    try {
      await this.page.waitForURL((url) => url.toString().includes(fragment), { timeout: timeoutMs })
      return true
    } catch {
      return false
    }
  }

  onNavigation(listener: (record: NavigationRecord) => void): () => void {
    this.navigationListeners.add(listener)
    return () => this.navigationListeners.delete(listener)
  }

  recentNavigations(): NavigationRecord[] {
    return [...this.navigations]
  }

  // -------------------------------------------------------------- 定位

  locator(selector: string): Locator {
    return this.page.locator(selector)
  }

  frameLocator(selector: string): FrameLocator {
    return this.page.frameLocator(selector)
  }

  /** 逃生口：确实需要 Playwright 全能力时使用（例如 evaluate、waitForFunction） */
  get playwrightPage(): Page {
    return this.page
  }

  // -------------------------------------------------------------- 会话

  async getCookies(): Promise<Cookie[]> {
    return this.page.context().cookies()
  }

  async getCookieHeader(): Promise<string> {
    const cookies = await this.getCookies()
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  }

  async setCookies(cookies: Parameters<BrowserContext['addCookies']>[0]): Promise<void> {
    await this.page.context().addCookies(cookies)
  }

  // -------------------------------------------------------------- 弹窗

  /**
   * 等待一个由当前页面开启的新窗口。
   * 宿主里的 window.open 默认被拒（见 browser-host.ts），
   * 真正需要多窗口时由业务显式调用这个方法并放开对应策略。
   */
  async waitForPopup(timeoutMs = 15_000): Promise<BrowserSession | null> {
    const popup = await this.page.waitForEvent('popup', { timeout: timeoutMs }).catch(() => null)
    return popup ? new BrowserSession(popup, this.onClosed) : null
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: false })
  }

  async close(): Promise<void> {
    if (this.isClosed) return
    try {
      await this.page.close()
    } catch (error) {
      logger.exception('关闭课程窗口失败', error)
    }
  }
}
