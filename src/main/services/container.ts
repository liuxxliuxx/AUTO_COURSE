import { AccountService } from './account-service'
import { WorkflowService } from '../workflows/workflow-service'
import { WorkflowRunManager } from '../workflows/workflow-run-manager'
import { WorkflowScheduler } from '../workflows/workflow-scheduler'
import { RunRepository } from '../workflows/run-repository'
import { createWorkflowRuntime } from '../workflows/workflow-runtime'
/**
 * Service 容器 —— 主进程唯一的依赖装配点。
 *
 * 装配顺序（后面的依赖前面的）：
 *   Database → Settings / Accounts / Courses → Workflows → Runs → Scheduler
 *   每个步骤独立创建 BrowserService / BotService / TranscriptionService
 *
 * Renderer 永远看不到这些对象本身，只能通过 typed IPC 调用。
 */

import { app, BrowserWindow, session } from 'electron'
import { clearApplicationCache } from './cache-service'
import { join } from 'node:path'
import { addLogSink, createLogger } from './logger'
import { EventBus } from './event-bus'
import { SettingsService } from './settings-service'
import { CourseService } from './course-service'
import { CourseDiscoveryService } from './course-discovery-service'
import { type RunnerFactory } from './bot-service'
import { Database } from '../storage/database'
import type { SttWorkerOptions } from './stt-worker'
import { IPC_EVENT, type EventName } from '@shared/ipc'
import type { LogEntry, LogLevel, MigrationReport } from '@shared/types'

const logger = createLogger('container')

/** Use physical files for worker/WASM resources, including outside app.asar after packaging. */
function sttOptions(userData: string): SttWorkerOptions {
  return {
    modelDir: join(userData, 'models', 'sensevoice-small-int8-2024-07-17'),
    scriptPath: app.isPackaged
      ? join(process.resourcesPath, 'stt', 'worker.cjs')
      : join(app.getAppPath(), 'resources', 'stt', 'worker.cjs'),
    modulePath: app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sherpa-onnx', 'index.js')
      : require.resolve('sherpa-onnx'),
  }
}

export interface AppPaths {
  /** 应用数据目录（Electron userData） */
  userData: string
  /** v3 数据库文件 */
  databaseFile: string
  /** 转录输出与临时文件根目录 */
  transcriptionDir: string
  /** Browser Host 的下载落盘目录 */
  downloadDir: string
  /** Browser Host 的 profile 目录（cookie / 登录态，跨重启保留） */
  browserProfileDir: string
}

/** 所有需要转发到 Renderer 的事件 */
const FORWARDED_EVENTS: EventName[] = Object.values(IPC_EVENT)

export class ServiceContainer {
  readonly paths: AppPaths
  readonly bus = new EventBus()
  readonly db: Database
  readonly accounts: AccountService
  readonly settings: SettingsService
  readonly courses: CourseService
  readonly courseDiscovery: CourseDiscoveryService
  readonly workflows: WorkflowService
  readonly workflowRuns: WorkflowRunManager
  readonly workflowScheduler: WorkflowScheduler
  readonly migration: MigrationReport

  private mainWindow: BrowserWindow | null = null
  private removeLogSink: (() => void) | null = null
  private recentLogs: LogEntry[] = []
  private runnerFactory: RunnerFactory | null = null
  private disposed = false
  private eventForwardersAttached = false

  constructor() {
    const userData = app.getPath('userData')
    this.paths = {
      userData,
      databaseFile: join(userData, 'auto_course.db'),
      transcriptionDir: join(userData, 'transcription'),
      downloadDir: join(userData, 'downloads'),
      // 刻意放在 userData 下而不是系统临时目录：
      // 会话要跨应用重启保留，否则每次开课都要重新登录
      browserProfileDir: join(userData, 'browser-profile')
    }

    this.db = new Database(this.paths.databaseFile)
    this.migration = { imported: false, sourcePath: null, schemaVersion: this.db.userVersion, message: 'v3 使用独立数据目录，旧数据未导入', importedRows: {} }

    this.settings = new SettingsService(this.db)
    this.courses = new CourseService(this.db, this.settings, () => this.workflowRuns?.occupiedCourses() ?? [])
    this.accounts = new AccountService(this.db, userData, () => this.workflowRuns?.occupiedAccounts() ?? [])
    this.workflows = new WorkflowService(this.db, this.courses, id => this.workflowRuns?.isActive(id) ?? false, this.accounts)
    this.workflowRuns = new WorkflowRunManager(this.workflows,this.courses,this.settings,this.accounts,new RunRepository(this.db),(run,report)=> {
      return createWorkflowRuntime(run,report,{db:this.db,accounts:this.accounts,courses:this.courses,settingsService:this.settings,userData,worker:sttOptions(userData),runnerFactory:()=>this.runnerFactory})
    },run=>this.bus.emit('event:workflow-run',run))
    this.workflowScheduler = new WorkflowScheduler(this.db,this.workflows,this.workflowRuns)
    this.courseDiscovery = new CourseDiscoveryService(this.accounts, this.courses, this.settings, this.workflowRuns, userData)


  }

  /**
   * 注册 Runner 工厂。
   * 传统课程、图谱课程和掌握度课程各自实现 CourseRunner，BotService 按 TaskMode 取用。
   */
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
    this.removeLogSink = addLogSink((level, message, context) => {
      if(context) this.workflowRuns.repository.event({...context,time:Date.now(),level,message})
      const entry: LogEntry = { time: Date.now(), level, message }
      this.recentLogs.push(entry)
      if (this.recentLogs.length > 500) this.recentLogs = this.recentLogs.slice(-500)
      this.bus.emit('event:log', entry)
    })

    this.workflowScheduler.start()
  }

  /** 主窗口创建/重建后调用：挂上事件转发并回灌历史日志 */
  attachMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    window.on('closed', () => {
      if (this.mainWindow === window) this.mainWindow = null
    })

    // 事件转发：EventBus → Renderer
    if (!this.eventForwardersAttached) {
      for (const event of FORWARDED_EVENTS) this.bus.on(event, payload => this.send(event, payload))
      this.eventForwardersAttached = true
    }

    // 回灌当前状态，避免新窗口空着
    this.send(IPC_EVENT.progress, this.progressSnapshot())
    this.applyUiScale()
  }

  /**
   * 应用界面缩放。
   * 只在主进程侧做 —— Renderer 拿不到 webFrame，也不该拿到。
   */
  applyUiScale(): void {
    const scale = this.settings.getAll().uiScale
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    if (!Number.isFinite(scale) || scale < 0.5 || scale > 2) return
    try {
      this.mainWindow.webContents.setZoomFactor(scale)
    } catch (error) {
      logger.exception('设置界面缩放失败', error)
    }
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
      sessionSeconds: this.workflowRuns.repository.list().filter(r=>r.state==='running'||r.state==='stopping').reduce((sum,r)=>sum+r.steps.reduce((n,s)=>n+(s.status?.watchedSeconds??0),0),0),
      targetMinutes: settings.autoMode ? settings.autoLimitMinutes : settings.timeLimitMinutes
    }
  }

  /** 触发一次状态广播（设置变更后调用） */
  broadcastSettings(): void {
    this.send(IPC_EVENT.settingsChanged, this.settings.getAll())
    this.send(IPC_EVENT.progress, this.progressSnapshot())
    this.applyUiScale()
  }

  async clearCache(): Promise<{ bytes: number }> {
    return this.workflowRuns.withMaintenance(async () => {
      const result = await clearApplicationCache(this.paths.userData, () => session.defaultSession.clearCache())
      logger.info(`已清理网页缓存与临时下载文件（${result.bytes} 字节）`)
      return result
    })
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

    this.workflowScheduler.stop()
    await this.courseDiscovery.dispose()
    await this.workflowRuns.dispose()

    this.removeLogSink?.()
    this.removeLogSink = null
    this.mainWindow = null

    this.db.close()
    this.bus.clear()
  }
}
