/**
 * Service 容器 —— 主进程唯一的依赖装配点。
 *
 * Phase 1 只搭骨架（路径、日志转发）。
 * Phase 3 起在这里接入 StorageService / CredentialService / EventBus /
 * SchedulerService / BotService；Renderer 永远看不到这些对象本身。
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { addLogSink, createLogger } from './logger'
import { IPC_EVENT } from '@shared/ipc'
import type { LogEntry, LogLevel } from '@shared/types'

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
  /** 应用日志文件 */
  logFile: string
}

export class ServiceContainer {
  readonly paths: AppPaths

  private mainWindow: BrowserWindow | null = null
  private removeLogSink: (() => void) | null = null
  private recentLogs: LogEntry[] = []
  private disposed = false

  constructor() {
    const userData = app.getPath('userData')
    this.paths = {
      userData,
      databaseFile: join(userData, 'auto_course.db'),
      credentialsFile: join(userData, 'credentials.bin'),
      transcriptionDir: join(userData, 'transcription'),
      logFile: join(userData, 'logs', 'app.log')
    }
  }

  async initialize(): Promise<void> {
    logger.info(`用户数据目录: ${this.paths.userData}`)
    logger.info(`数据库文件: ${this.paths.databaseFile}`)

    // 把主进程日志送进 Renderer 的日志面板。
    this.removeLogSink = addLogSink((level, message) => {
      this.pushLog(level, message)
    })
  }

  /** 主窗口创建/重建后调用，用于把历史日志回灌到新窗口 */
  attachMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    window.on('closed', () => {
      if (this.mainWindow === window) this.mainWindow = null
    })
  }

  /** Renderer 启动时拉取最近日志 */
  getRecentLogs(): LogEntry[] {
    return [...this.recentLogs]
  }

  private pushLog(level: LogLevel, message: string): void {
    const entry: LogEntry = { time: Date.now(), level, message }
    this.recentLogs.push(entry)
    if (this.recentLogs.length > 500) {
      this.recentLogs = this.recentLogs.slice(-500)
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_EVENT.log, entry)
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.removeLogSink?.()
    this.removeLogSink = null
    this.mainWindow = null
  }
}
