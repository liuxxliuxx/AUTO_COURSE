import { join } from 'node:path'
import { currentCourseTerm, emptyDiscoveryStatus, type CourseDiscoveryResult, type CourseDiscoveryStatus } from '@shared/course-discovery'
import { BrowserService } from '../automation/browser-service'
import { CourseDiscoveryNavigator } from '../automation/course-discovery'
import { CaptchaService } from '../automation/captcha'
import { createLoginProvider } from '../automation/login/provider'
import { DEFAULT_LOGGED_URL } from '../automation/constants'
import { isCourseDestination } from '../automation/login/session-check'
import { createLogger, redactSecrets } from './logger'
import type { AccountService } from './account-service'
import type { CourseService } from './course-service'
import type { SettingsService } from './settings-service'
import type { WorkflowRunManager } from '../workflows/workflow-run-manager'

const log = createLogger('course-discovery')

export class CourseDiscoveryService {
  private status = emptyDiscoveryStatus()
  private browser: BrowserService | null = null
  private browserClosing: Promise<void> | null = null
  private pending: Promise<CourseDiscoveryResult> | null = null
  private stopped = false
  private closing = false
  private confirmation: ((confirmed: boolean) => void) | null = null
  constructor(private accounts: AccountService, private courses: CourseService,
    private settings: SettingsService, private runs: WorkflowRunManager, private userData: string) {}

  getStatus(): CourseDiscoveryStatus { return structuredClone(this.status) }
  private message(message: string): void { this.status.message = message; log.info(message) }

  start(accountId: string): Promise<CourseDiscoveryResult> {
    if (this.closing) throw new Error('应用正在退出')
    if (this.pending) throw new Error('正在获取课程，请等待结束或取消')
    const account = this.accounts.get(accountId)
    if (!account) throw new Error('请选择有效账号')
    const release = this.runs.reserveAccount(accountId)
    this.stopped = false
    this.browserClosing = null
    this.status = { ...emptyDiscoveryStatus(), phase: 'running', accountId, term: currentCourseTerm(), message: '正在登录课程主页' }
    this.pending = Promise.resolve().then(async () => {
      try {
        if (this.stopped) throw new Error('已取消')
        this.browser = new BrowserService({ profileDir: this.accounts.profileDir(accountId),
          downloadDir: join(this.userData, 'discovery-downloads', accountId), migrateLegacyProfile: false })
        const session = await this.browser.ensureSession()
        const shouldStop = (): boolean => this.stopped || session.isClosed
        const captcha = new CaptchaService({ session, shouldStop, log, requestCaptcha: async (_scene, message) => {
          if (shouldStop()) return false
          this.status.phase = 'waiting'
          this.message(message)
          const confirmed = await new Promise<boolean>(resolve => {
            const timer = setTimeout(() => finish(false), 5 * 60_000)
            const onClose = (): void => finish(false)
            const finish = (ok: boolean): void => {
              clearTimeout(timer); session.playwrightPage.off('close', onClose)
              this.confirmation = null; resolve(ok)
            }
            this.confirmation = finish
            session.playwrightPage.once('close', onClose)
          })
          if (!this.stopped) this.status.phase = 'running'
          return confirmed && !shouldStop()
        } })
        const login = await createLoginProvider(account.loginMethod).login({ session,
          settings: { ...this.settings.getAll(), loginMethod: account.loginMethod, loggedUrl: account.loggedUrl, videoUrl: DEFAULT_LOGGED_URL },
          credentials: this.accounts.credentials(accountId), captcha, shouldStop, log, authenticateFirst: true })
        if (!login.ok) throw new Error(login.message)
        if (shouldStop()) throw new Error('已取消或课程窗口已关闭')
        // 包括 SSO 的 hub 工作台落地：采集前必须进入课程中心，不能从工作台判断课程。
        if (!isCourseDestination(DEFAULT_LOGGED_URL, session.getCurrentUrl())) {
          this.message('登录完成，正在进入课程主页')
          await session.navigate(DEFAULT_LOGGED_URL)
        }
        await this.browser.enableCourseDiscoveryNavigation()
        const navigator = new CourseDiscoveryNavigator(session.playwrightPage, shouldStop, message => this.message(message))
        const scan = await navigator.scan(this.status.term)
        if (shouldStop()) throw new Error('已取消或课程窗口已关闭')
        const imported = this.courses.importDiscovered(scan.courses)
        this.status = { ...this.status, ...imported, scanned: scan.scanned, completed: scan.completed,
          unsupported: scan.unsupported, warnings: scan.warnings.map(redactSecrets), phase: 'done',
          message: `获取完成：新增 ${imported.added} 门，已存在 ${imported.existing} 门，已完成 ${scan.completed} 门，其他类型 ${scan.unsupported} 门，未能识别 ${scan.warnings.length} 门` }
      } catch (error) {
        this.status.phase = this.stopped ? 'cancelled' : 'failed'
        this.message(this.stopped ? '已取消获取，本次未导入课程' : `获取失败：${redactSecrets(error instanceof Error ? error.message : String(error))}`)
      } finally {
        this.confirmation?.(false)
        const browser = this.browser
        try { await this.closeBrowser() } finally { browser?.dispose(); this.browser = null; release() }
      }
      return { status: this.getStatus(), library: this.courses.list() }
    }).finally(() => { this.pending = null })
    return this.pending
  }

  confirm(): void {
    if (this.status.phase !== 'waiting' || !this.confirmation) throw new Error('当前没有待确认的验证')
    this.confirmation(true)
  }
  async openWindow(): Promise<void> {
    if (!this.browser?.currentSession) throw new Error('课程窗口尚未就绪或已关闭')
    await this.browser.focusCourseWindow()
  }
  async cancel(): Promise<void> {
    if (!this.pending) return
    if (this.status.phase === 'done' || this.status.phase === 'failed') { await this.pending; return }
    this.stopped = true
    this.status.phase = 'stopping'
    this.message('正在取消获取…')
    this.confirmation?.(false)
    await this.closeBrowser()
    await this.pending
  }
  private closeBrowser(): Promise<void> {
    if (!this.browserClosing && this.browser) this.browserClosing = this.browser.close()
    return this.browserClosing ?? Promise.resolve()
  }
  async dispose(): Promise<void> { this.closing = true; await this.cancel() }
}
