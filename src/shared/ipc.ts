/**
 * Typed IPC 契约 —— 单一事实来源。
 *
 * Renderer 只能通过 preload 暴露的 `window.appApi` 访问主进程能力。
 * `ipcRenderer` 绝不暴露给 Vue。
 */

import type {
  AppSettings,
  BotStatus,
  CaptchaRequiredEvent,
  ChromeDetectionResult,
  CourseItem,
  CredentialState,
  Credentials,
  DailyProgress,
  LogEntry,
  MigrationReport,
  ProgressSnapshot,
  SchedulerConfig,
  SchedulerStatus,
  SettingsPatch,
  TaskMode,
  TranscriptionStatus,
  ValidationError
} from './types'

// ============================================================================
// Channel 名称
// ============================================================================

/** Renderer → Main，invoke/handle（请求-响应） */
export const IPC_INVOKE = {
  botStart: 'bot:start',
  botStop: 'bot:stop',
  botStatus: 'bot:status',

  settingsGetAll: 'settings:getAll',
  settingsUpdate: 'settings:update',
  settingsValidate: 'settings:validate',

  credentialsGet: 'credentials:get',
  credentialsSet: 'credentials:set',
  credentialsState: 'credentials:state',

  coursesList: 'courses:list',
  coursesSelect: 'courses:select',

  captchaConfirm: 'captcha:confirm',

  schedulerGet: 'scheduler:get',
  schedulerUpdate: 'scheduler:update',

  progressGet: 'progress:get',

  browserOpenCourseWindow: 'browser:openCourseWindow',
  browserDetectChrome: 'browser:detectChrome',

  transcriptionGet: 'transcription:get',

  migrationReport: 'migration:report',

  logsRecent: 'logs:recent',

  dialogPickDirectory: 'dialog:pickDirectory',
  dialogPickFile: 'dialog:pickFile',

  appVersion: 'app:version'
} as const

/** Main → Renderer，send/on（事件推送） */
export const IPC_EVENT = {
  botStatus: 'event:bot-status',
  log: 'event:log',
  progress: 'event:progress',
  courseChanged: 'event:course-changed',
  captchaRequired: 'event:captcha-required',
  captchaCleared: 'event:captcha-cleared',
  transcriptionStatus: 'event:transcription-status',
  schedulerStatus: 'event:scheduler-status',
  settingsChanged: 'event:settings-changed',
  error: 'event:error'
} as const

export type InvokeChannel = (typeof IPC_INVOKE)[keyof typeof IPC_INVOKE]
export type EventChannel = (typeof IPC_EVENT)[keyof typeof IPC_EVENT]

// ============================================================================
// 事件负载映射
// ============================================================================

export interface EventPayloads {
  [IPC_EVENT.botStatus]: BotStatus
  [IPC_EVENT.log]: LogEntry
  [IPC_EVENT.progress]: ProgressSnapshot
  [IPC_EVENT.courseChanged]: CourseItem | null
  [IPC_EVENT.captchaRequired]: CaptchaRequiredEvent
  [IPC_EVENT.captchaCleared]: null
  [IPC_EVENT.transcriptionStatus]: TranscriptionStatus
  [IPC_EVENT.schedulerStatus]: SchedulerStatus
  [IPC_EVENT.settingsChanged]: AppSettings
  [IPC_EVENT.error]: { message: string; detail?: string }
}

export type EventName = keyof EventPayloads

// ============================================================================
// 请求 / 响应映射
// ============================================================================

export interface InvokeMap {
  [IPC_INVOKE.botStart]: { req: void; res: { ok: true } | { ok: false; errors: ValidationError[] } }
  [IPC_INVOKE.botStop]: { req: void; res: void }
  [IPC_INVOKE.botStatus]: { req: void; res: BotStatus }

  [IPC_INVOKE.settingsGetAll]: { req: void; res: AppSettings }
  [IPC_INVOKE.settingsUpdate]: { req: SettingsPatch; res: AppSettings }
  [IPC_INVOKE.settingsValidate]: { req: void; res: ValidationError[] }

  [IPC_INVOKE.credentialsGet]: { req: void; res: Credentials }
  [IPC_INVOKE.credentialsSet]: { req: Credentials; res: CredentialState }
  [IPC_INVOKE.credentialsState]: { req: void; res: CredentialState }

  [IPC_INVOKE.coursesList]: { req: void; res: CourseItem[] }
  [IPC_INVOKE.coursesSelect]: { req: { url: string; note: string }; res: CourseItem[] }

  [IPC_INVOKE.captchaConfirm]: { req: void; res: void }

  [IPC_INVOKE.schedulerGet]: { req: void; res: SchedulerStatus }
  [IPC_INVOKE.schedulerUpdate]: { req: Partial<SchedulerConfig>; res: SchedulerStatus }

  [IPC_INVOKE.progressGet]: { req: void; res: ProgressSnapshot }

  [IPC_INVOKE.browserOpenCourseWindow]: { req: void; res: void }
  [IPC_INVOKE.browserDetectChrome]: { req: void; res: ChromeDetectionResult }

  [IPC_INVOKE.transcriptionGet]: { req: void; res: TranscriptionStatus }

  [IPC_INVOKE.migrationReport]: { req: void; res: MigrationReport }

  [IPC_INVOKE.logsRecent]: { req: void; res: LogEntry[] }

  [IPC_INVOKE.dialogPickDirectory]: { req: void; res: string }
  [IPC_INVOKE.dialogPickFile]: { req: { kind: 'chrome' | 'chromedriver' | 'image' }; res: string }

  [IPC_INVOKE.appVersion]: {
    req: void
    res: { version: string; electron: string; chrome: string; platform: NodeJS.Platform }
  }
}

export type InvokeName = keyof InvokeMap

/** 便捷别名：取某个 channel 的响应类型 */
export type Res<C extends InvokeName> = InvokeMap[C]['res']

// ============================================================================
// Preload 暴露的 API
// ============================================================================

export type Unsubscribe = () => void

export interface AppApi {
  bot: {
    start(): Promise<InvokeMap[typeof IPC_INVOKE.botStart]['res']>
    stop(): Promise<void>
    status(): Promise<BotStatus>
  }

  settings: {
    getAll(): Promise<AppSettings>
    update(patch: SettingsPatch): Promise<AppSettings>
    validate(): Promise<ValidationError[]>
  }

  credentials: {
    get(): Promise<Credentials>
    set(creds: Credentials): Promise<CredentialState>
    state(): Promise<CredentialState>
  }

  courses: {
    list(): Promise<CourseItem[]>
    select(url: string, note: string): Promise<CourseItem[]>
  }

  captcha: {
    confirm(): Promise<void>
  }

  scheduler: {
    get(): Promise<SchedulerStatus>
    update(patch: Partial<SchedulerConfig>): Promise<SchedulerStatus>
  }

  progress: {
    get(): Promise<ProgressSnapshot>
    today(): Promise<DailyProgress>
  }

  browser: {
    openCourseWindow(): Promise<void>
    detectChrome(): Promise<ChromeDetectionResult>
  }

  transcription: {
    get(): Promise<TranscriptionStatus>
  }

  migration: {
    report(): Promise<MigrationReport>
  }

  logs: {
    recent(): Promise<LogEntry[]>
  }

  dialog: {
    pickDirectory(): Promise<string>
    pickFile(kind: 'chrome' | 'chromedriver' | 'image'): Promise<string>
  }

  app: {
    version(): Promise<InvokeMap[typeof IPC_INVOKE.appVersion]['res']>
  }

  events: {
    onBotStatus(cb: (payload: BotStatus) => void): Unsubscribe
    onLog(cb: (payload: LogEntry) => void): Unsubscribe
    onProgress(cb: (payload: ProgressSnapshot) => void): Unsubscribe
    onCourseChanged(cb: (payload: CourseItem | null) => void): Unsubscribe
    onCaptchaRequired(cb: (payload: CaptchaRequiredEvent) => void): Unsubscribe
    onCaptchaCleared(cb: () => void): Unsubscribe
    onTranscriptionStatus(cb: (payload: TranscriptionStatus) => void): Unsubscribe
    onSchedulerStatus(cb: (payload: SchedulerStatus) => void): Unsubscribe
    onSettingsChanged(cb: (payload: AppSettings) => void): Unsubscribe
    onError(cb: (payload: EventPayloads[typeof IPC_EVENT.error]) => void): Unsubscribe
  }
}

/** 供 Renderer 使用的模式标签（TaskMode → 中文） */
export const TASK_MODE_LABEL: Record<TaskMode, string> = {
  classic: '刷课',
  map: '图谱刷课',
  'transcribe-only': '仅转录'
}
