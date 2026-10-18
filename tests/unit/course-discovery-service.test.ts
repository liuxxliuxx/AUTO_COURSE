import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseDiscoveryService } from '../../src/main/services/course-discovery-service'
import type { AccountService } from '../../src/main/services/account-service'
import type { CourseService } from '../../src/main/services/course-service'
import type { SettingsService } from '../../src/main/services/settings-service'
import type { WorkflowRunManager } from '../../src/main/workflows/workflow-run-manager'
import { DEFAULT_LOGGED_URL } from '../../src/main/automation/constants'

const mocks = vi.hoisted(() => ({ login: vi.fn(), provider: vi.fn(), scan: vi.fn(), close: vi.fn(), release: vi.fn(), reserve: vi.fn(), import: vi.fn(), session: {} as Record<string, unknown>,
  account: { loginMethod: 'zhihuishu' as 'zhihuishu' | 'upc-institution' | 'upc', loggedUrl: '' } }))
vi.mock('../../src/main/automation/browser-service', () => ({ BrowserService: class {
  get currentSession() { return mocks.session }
  async ensureSession() { return mocks.session }
  async enableCourseDiscoveryNavigation() {}
  async focusCourseWindow() {}
  close() { return mocks.close() }
  dispose() {}
} }))
vi.mock('../../src/main/automation/login/provider', () => ({ createLoginProvider: mocks.provider }))
vi.mock('../../src/main/automation/course-discovery', () => ({ CourseDiscoveryNavigator: class { scan = mocks.scan } }))
const library = { courses: [], selectedCourseId: null, defaults: {} }
let service: CourseDiscoveryService
beforeEach(() => {
  vi.clearAllMocks()
  mocks.account = { loginMethod: 'zhihuishu', loggedUrl: '' }
  mocks.provider.mockReturnValue({ login: mocks.login })
  mocks.session = { isClosed: false, playwrightPage: new EventEmitter(), getCurrentUrl: () => DEFAULT_LOGGED_URL, navigate: vi.fn() }
  mocks.login.mockResolvedValue({ ok: true })
  mocks.scan.mockResolvedValue({ courses: [{ name: '课程' }], scanned: 1, completed: 0, unsupported: 0, warnings: [] })
  mocks.import.mockReturnValue({ added: 1, existing: 0 })
  mocks.close.mockImplementation(async () => { mocks.session.isClosed = true })
  mocks.reserve.mockReturnValue(mocks.release)
  service = new CourseDiscoveryService(
    { get: () => mocks.account, credentials: () => ({ username: 'selected-account', password: 'fixture' }), profileDir: () => 'fixture-profile' } as unknown as AccountService,
    { list: () => library, importDiscovered: mocks.import } as unknown as CourseService,
    { getAll: () => ({ loginMethod: 'zhihuishu', loggedUrl: 'https://global.example', videoUrl: 'https://global.example/course' }) } as SettingsService,
    { reserveAccount: mocks.reserve } as unknown as WorkflowRunManager, 'fixture-data'
  )
})

describe('课程获取生命周期', () => {
  it.each(['zhihuishu', 'upc-institution', 'upc'] as const)('使用账号的 %s 登录设置，授权成功前不导航主页、不扫描课程', async method => {
    mocks.account = { loginMethod: method, loggedUrl: 'https://hub.polymas.com/stu-hike/ctp/student-workspace' }
    mocks.session.getCurrentUrl = () => 'about:blank'
    let finishLogin!: (result: { ok: boolean }) => void
    mocks.login.mockImplementationOnce(() => new Promise(resolve => { finishLogin = resolve }))
    const pending = service.start('a')
    await vi.waitFor(() => expect(mocks.login).toHaveBeenCalledOnce())
    expect(mocks.provider).toHaveBeenCalledExactlyOnceWith(method)
    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({
      authenticateFirst: true,
      settings: expect.objectContaining({ loginMethod: method, loggedUrl: mocks.account.loggedUrl, videoUrl: DEFAULT_LOGGED_URL }),
      credentials: { username: 'selected-account', password: 'fixture' }
    }))
    expect(mocks.session.navigate).not.toHaveBeenCalled()
    expect(mocks.scan).not.toHaveBeenCalled()
    finishLogin({ ok: true })
    expect((await pending).status.phase).toBe('done')
    expect(mocks.session.navigate).toHaveBeenCalledWith(DEFAULT_LOGGED_URL)
  })
  it('SSO 落在 hub 后先跳转课程中心，再开始扫描', async () => {
    mocks.session.getCurrentUrl = () => 'https://hub.polymas.com/stu-hike/ctp/student-workspace'
    const navigate = mocks.session.navigate as ReturnType<typeof vi.fn>
    mocks.scan.mockImplementationOnce(async () => {
      expect(navigate).toHaveBeenCalledWith(DEFAULT_LOGGED_URL)
      return { courses: [], scanned: 0, completed: 0, unsupported: 0, warnings: [] }
    })
    expect((await service.start('a')).status.phase).toBe('done')
  })
  it('成功后入库并清理浏览器，拿到账号锁前不进行异步操作', async () => {
    const pending = service.start('a')
    expect(mocks.reserve).toHaveBeenCalledWith('a')
    expect(() => service.start('a')).toThrow('正在获取')
    expect((await pending).status).toMatchObject({ phase: 'done', added: 1, scanned: 1 })
    expect(mocks.import).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it('登录失败时不入库、释放账号，允许重试', async () => {
    mocks.login.mockResolvedValueOnce({ ok: false, message: '登录失败' })
    expect((await service.start('a')).status.phase).toBe('failed')
    expect(mocks.import).not.toHaveBeenCalled()
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(mocks.session.navigate).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
    mocks.session.isClosed = false
    expect((await service.start('a')).status.phase).toBe('done')
  })
  it('等待人工验证时取消，不导入且只关闭一次，关闭完成前不释放账号', async () => {
    mocks.login.mockImplementation(async ({ captcha }) => ({ ok: await captcha.requestManualHelp('login', '请登录') }))
    const pending = service.start('a')
    await vi.waitFor(() => expect(service.getStatus().phase).toBe('waiting'))
    let finishClose!: () => void
    mocks.close.mockImplementation(() => new Promise<void>(resolve => { finishClose = resolve }))
    const cancellation = service.cancel()
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce())
    expect(mocks.release).not.toHaveBeenCalled()
    finishClose()
    await cancellation
    expect((await pending).status.phase).toBe('cancelled')
    expect(mocks.import).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(() => service.confirm()).toThrow('没有待确认')
  })
  it('人工确认后继续，退出后拒绝新请求', async () => {
    mocks.login.mockImplementation(async ({ captcha }) => ({ ok: await captcha.requestManualHelp('login', '请登录') }))
    const pending = service.start('a')
    await vi.waitFor(() => expect(service.getStatus().phase).toBe('waiting'))
    service.confirm()
    expect((await pending).status.phase).toBe('done')
    await service.dispose()
    expect(() => service.start('a')).toThrow('应用正在退出')
  })
})
