/**
 * BrowserService —— 浏览器生命周期的唯一管理者。
 *
 * 架构见 docs/PLAYWRIGHT_POC.md：
 *   Playwright 无法接管应用自身的 BrowserWindow（Electron 在
 *   --remote-debugging-port 上不提供 Runtime domain），因此由本服务用同一个
 *   Electron 二进制再拉起一个 `--browser-host` 进程，再用 Playwright 驱动它。
 *
 * 职责边界：
 *  - 谁都不许自己 launch / close 浏览器，只能通过这里拿 BrowserSession。
 *  - 宿主进程与 Playwright 句柄由本服务独占，业务代码拿不到。
 */

import { app } from 'electron'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserSession } from './browser-session'
import { createLogger } from '../services/logger'

const logger = createLogger('browser')

/** 首次打开课程窗口的等待上限 */
const FIRST_WINDOW_TIMEOUT_MS = 40_000

export interface BrowserServiceOptions {
  /** 宿主把页面下载落到哪里 */
  downloadDir: string
  /**
   * 宿主 profile 目录（cookie / 登录态）。
   * 放在应用数据目录下，跨重启保留 —— 会话能复用就不必重新登录。
   */
  profileDir: string
}

export class BrowserService {
  private electronApp: ElectronApplication | null = null
  private session: BrowserSession | null = null
  private launching: Promise<ElectronApplication> | null = null
  private disposed = false

  constructor(private readonly options: BrowserServiceOptions) {}

  /** 宿主是否已就绪 */
  get isHostRunning(): boolean {
    return this.electronApp !== null
  }

  get currentSession(): BrowserSession | null {
    return this.session && !this.session.isClosed ? this.session : null
  }

  // ------------------------------------------------------------------ 宿主

  /**
   * 启动宿主进程。
   * 打包后与应用本体是同一个二进制，只差一个 `--browser-host` 标志；
   * 开发模式下 Electron 需要额外接收应用目录作为第一个参数。
   */
  private async launchHost(): Promise<ElectronApplication> {
    mkdirSync(this.options.downloadDir, { recursive: true })
    this.migrateLegacyProfile()

    const args = [
      `--browser-host`,
      `--download-dir=${this.options.downloadDir}`,
      `--profile-dir=${this.options.profileDir}`
    ]
    if (!app.isPackaged) {
      // 未打包时 process.execPath 是 Electron 本体，必须显式告诉它 app 在哪
      args.unshift(app.getAppPath())
    }

    logger.info(`启动 Browser Host: ${process.execPath} ${args.join(' ')}`)

    // cwd 必须是**真实目录**：打包后 app.getAppPath() 指向
    // `.../Contents/Resources/app.asar`，那是个文件，spawn 会直接 ENOTDIR。
    const cwd = app.isPackaged ? process.resourcesPath : app.getAppPath()

    const electronApp = await electron.launch({
      executablePath: process.execPath,
      args,
      cwd,
      env: Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
      )
    })

    electronApp.process().on('exit', (code, signal) => {
      logger.warn(`Browser Host 进程退出 code=${code} signal=${signal}`)
      this.electronApp = null
      this.session = null
      this.launching = null
    })

    // 宿主的 stdout/stderr 转发到主进程日志，便于排查
    electronApp.process().stdout?.on('data', (d: Buffer) => {
      const text = d.toString().trim()
      if (text) logger.debug(`[host] ${text}`)
    })
    electronApp.process().stderr?.on('data', (d: Buffer) => {
      const text = d.toString().trim()
      // Electron 在 macOS 上会刷一些与本项目无关的警告
      if (text && !/IMKClient|IMKInputSession|Warning: cache/.test(text)) {
        logger.debug(`[host:err] ${text}`)
      }
    })

    return electronApp
  }

  /**
   * 把老版本留在系统临时目录里的会话搬过来（只做一次）。
   *
   * 老版本用 `<tmpdir>/auto-course-browser-host` 当 profile，macOS 会定期清理，
   * 而且用户升级后第一件事就是被要求重新登录。这里在新目录还没有会话时
   * 拷一份过去，升级体验就是"登录态还在"。
   */
  private migrateLegacyProfile(): void {
    const legacy = join(tmpdir(), 'auto-course-browser-host')
    if (!existsSync(legacy)) return
    // 新目录已经建过（不管里面有没有会话）就不要动它
    if (existsSync(this.options.profileDir)) return
    if (!existsSync(join(legacy, 'Cookies'))) return
    try {
      // 目标目录不存在时 cp 才会把 src **当成** dst（而不是拷进 dst 里面）
      cpSync(legacy, this.options.profileDir, { recursive: true })
      logger.info(`已把旧临时目录的浏览器会话搬到 ${this.options.profileDir}`)
    } catch (error) {
      logger.warn(`搬迁旧浏览器会话失败（忽略，照常新建会话）：${String(error)}`)
    }
  }

  private async ensureHost(): Promise<ElectronApplication> {
    if (this.disposed) throw new Error('BrowserService 已关闭')
    if (this.electronApp) return this.electronApp
    if (this.launching) return this.launching

    this.launching = this.launchHost()
      .then((electronApp) => {
        this.electronApp = electronApp
        return electronApp
      })
      .finally(() => {
        this.launching = null
      })

    return this.launching
  }

  // ------------------------------------------------------------------ 会话

  /**
   * 打开课程窗口并返回会话。
   * 若已存在会话则直接复用（不新开窗口）。
   */
  async openSession(url?: string): Promise<BrowserSession> {
    const existing = this.currentSession
    if (existing) {
      if (url) await existing.navigate(url)
      return existing
    }

    const electronApp = await this.ensureHost()

    const page: Page = await electronApp.firstWindow({ timeout: FIRST_WINDOW_TIMEOUT_MS })
    await page.waitForLoadState('domcontentloaded').catch(() => {
      /* about:blank 可能没有可等待的 load 事件 */
    })

    this.session = new BrowserSession(page, (reason) => {
      logger.info(`课程窗口关闭: ${reason}`)
      this.session = null
    })

    if (url) await this.session.navigate(url)
    logger.info('课程窗口已就绪')

    return this.session
  }

  /** 仅当没有会话时才开窗口，用于「打开课程窗口」按钮 */
  async ensureSession(): Promise<BrowserSession> {
    return this.openSession()
  }

  /**
   * 把课程窗口提到前台并聚焦。
   *
   * 宿主开窗时走的是 `showInactive()`（不抢焦点），所以**只有用户主动要求**
   * （点运行页的「打开课程窗口 / 验证窗口 / 登录窗口」）时才调用这里。
   * 自动运行、宿主重启都不会调用。
   */
  async focusCourseWindow(): Promise<boolean> {
    const host = this.electronApp
    if (!host) return false
    try {
      return await host.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())
        if (!window) return false
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        window.moveTop()
        return true
      })
    } catch (error) {
      logger.warn(`聚焦课程窗口失败: ${String(error)}`)
      return false
    }
  }

  // ---------------------------------------------------------------- 下载

  /**
   * 读取宿主记录下来的下载。
   * Playwright 的 download 事件在 Electron 下不触发（见 PLAYWRIGHT_POC §3.2），
   * 所以下载结果从宿主写的索引文件里取。
   */
  async listDownloads(): Promise<Array<{ filename: string; path: string; state: string; bytes: number; at: number }>> {
    const { readFile } = await import('node:fs/promises')
    const indexPath = join(this.options.downloadDir, '_index.jsonl')
    try {
      const text = await readFile(indexPath, 'utf8')
      return text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }

  // ---------------------------------------------------------------- 关闭

  /** 关闭会话与宿主进程。可重复调用。 */
  async close(): Promise<void> {
    const electronApp = this.electronApp
    this.electronApp = null
    this.session = null

    if (!electronApp) return
    try {
      logger.info('正在关闭 Browser Host...')
      await electronApp.close()
      logger.info('Browser Host 已关闭')
    } catch (error) {
      logger.exception('关闭 Browser Host 失败，进程可能残留', error)
    }
  }

  dispose(): void {
    this.disposed = true
  }
}
