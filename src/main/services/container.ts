/**
 * Service 容器 —— 主进程唯一的依赖装配点。
 *
 * 装配顺序（后面的依赖前面的）：
 *   Logger → Database(含 v1 导入) → Credentials → Settings
 *   → EventBus → BrowserService → BotService → SchedulerService
 *
 * Renderer 永远看不到这些对象本身，只能通过 typed IPC 调用。
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { addLogSink, createLogger } from './logger'
import { EventBus } from './event-bus'
import { SettingsService } from './settings-service'
import { BotService, type RunnerFactory } from './bot-service'
import { SchedulerService } from './scheduler-service'
import { Database } from '../storage/database'
import { CredentialStore } from '../storage/credentials'
import { maybeImportLegacy } from '../storage/migrations/v1-import'
import { BrowserService } from '../automation/browser-service'
import { IPC_EVENT, type EventName } from '@shared/ipc'
import type { LogEntry, LogLevel, MigrationReport } from '@shared/types'

const logger = createLogger('container')

export interface AppPaths {
  /** 应用数据目录（Electron userData） */
  userData: string
  /** v2 数据库文件 */
  databaseFile: string
  /** 加密凭据文件 */
  credentialsFile: string
  /** 转录输出与临时文件根目录 */
  transcriptionDir: string
  /** Browser Host 的下载落盘目录 */
  downloadDir: string
}

/** 所有需要转发到 Renderer 的事件 */
const FORWARDED_EVENTS: EventName[] = Object.values(IPC_EVENT)

export class ServiceContainer {
  readonly paths: AppPaths
  readonly bus = new EventBus()
  readonly db: Database
  readonly credentials: CredentialStore
  readonly settings: SettingsService
  readonly browser: BrowserService
  readonly bot: BotService
  readonly scheduler: SchedulerService
  readonly migration: MigrationReport

  private mainWindow: BrowserWindow | null = null
  private removeLogSink: (() => void) | null = null
  private recentLogs: LogEntry[] = []
  private runnerFactory: RunnerFactory | null = null
  private disposed = false

  constructor() {
    const userData = app.getPath('userData')
    this.paths = {
      userData,
      databaseFile: join(userData, 'auto_course.db'),
      credentialsFile: join(userData, 'credentials.bin'),
      transcriptionDir: join(userData, 'transcription'),
      downloadDir: join(userData, 'downloads')
    }

    this.db = new Database(this.paths.databaseFile)
    this.migration = maybeImportLegacy(this.db)

    this.credentials = new CredentialStore(this.paths.credentialsFile)
    this.settings = new SettingsService(this.db)
    this.browser = new BrowserService({ downloadDir: this.paths.downloadDir })

    this.bot = new BotService(
      this.db,
      this.credentials,
      this.settings,
      this.bus,
      this.browser,
      (mode, ctx) => {
        if (!this.runnerFactory) {
          throw new Error(`未注册 ${mode} 模式的 Runner`)
        }
        return this.runnerFactory(mode, ctx)
      }
    )

    this.scheduler = new SchedulerService(this.settings, this.db, this.bus, {
      isRunning: () => this.bot.isRunning(),
      startForSchedule: () => this.bot.startForSchedule(),
      stopForSchedule: (reason) => this.bot.stopForSchedule(reason)
    })
  }

  /** Phase 4/5 在启动时注册真正的 Runner。 */
  setRunnerFactory(factory: RunnerFactory): void {
    this.runnerFactory = factory
  }

  async initialize(): Promise<void> {
    logger.info(`用户数据目录: ${this.paths.userData}`)
    logger.info(`数据库文件: ${this.paths.databaseFile}`)
    if (this.migration.imported || this.migration.sourcePath) {
      logger.info(`v1 迁移: ${this.migration.message}`)
    }

    // 主进程日志 → EventBus，再由事件转发器送到 Renderer
    this.removeLogSink = addLogSink((level, message) => {
      const entry: LogEntry = { time: Date.now(), level, message }
      this.recentLogs.push(entry)
      if (this.recentLogs.length > 500) this.recentLogs = this.recentLogs.slice(-500)
      this.bus.emit('event:log', entry)
    })

    this.scheduler.start()
  }

  /** 主窗口创建/重建后调用：挂上事件转发并回灌历史日志 */
  attachMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    window.on('closed', () => {
      if (this.mainWindow === window) this.mainWindow = null
    })

    // 事件转发：EventBus → Renderer
    for (const event of FORWARDED_EVENTS) {
      this.bus.on(event, (payload) => this.send(event, payload))
    }

    // 回灌当前状态，避免新窗口空着
    this.send(IPC_EVENT.botStatus, this.bot.getStatus())
    this.send(IPC_EVENT.progress, this.progressSnapshot())
    this.send(IPC_EVENT.schedulerStatus, this.scheduler.getStatus())
  }

  private send(channel: EventName, payload: unknown): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send(channel, payload)
  }

  progressSnapshot(): {
    today: { date: string; watchedSeconds: number }
    sessionSeconds: number
    targetMinutes: number
  } {
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const settings = this.settings.getAll()
    return {
      today: { date, watchedSeconds: this.db.getDailyProgress(date) },
      sessionSeconds: this.bot.getStatus().watchedSeconds,
      targetMinutes: settings.autoMode ? settings.autoLimitMinutes : settings.timeLimitMinutes
    }
  }

  /** 触发一次状态广播（设置变更后调用） */
  broadcastSettings(): void {
    this.send(IPC_EVENT.settingsChanged, this.settings.getAll())
    this.send(IPC_EVENT.schedulerStatus, this.scheduler.getStatus())
    this.send(IPC_EVENT.progress, this.progressSnapshot())
  }

  getRecentLogs(): LogEntry[] {
    return [...this.recentLogs]
  }

  /** 供测试注入日志 */
  pushLog(level: LogLevel, message: string): void {
    this.bus.emit('event:log', { time: Date.now(), level, message })
  }

  // ------------------------------------------------------------------ 退出

  /** 可靠退出清理：调度器 → Bot → 浏览器 → 数据库。只执行一次。 */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    this.scheduler.stop()
    await this.bot.dispose().catch((error) => logger.exception('停止 Bot 失败', error))
    await this.browser.close().catch((error) => logger.exception('关闭浏览器失败', error))
    this.browser.dispose()

    this.removeLogSink?.()
    this.removeLogSink = null
    this.mainWindow = null

    this.db.close()
    this.bus.clear()
  }
}
