import type { WorkflowApi, Workflow, WorkflowInput, WorkflowRun, WorkflowStartResult, RunEvent } from './workflows'
/**
 * Typed IPC 契约 —— 单一事实来源。
 *
 * Renderer 只能通过 preload 暴露的 `window.appApi` 访问主进程能力。
 * `ipcRenderer` 绝不暴露给 Vue。
 */

import type {
  AppSettings,
  CourseLibrary, CourseInput, CourseMutationResult, CourseRunOptions, RunRequest,
  BotStatus,
  CredentialState,
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
  workflowsList: 'workflows:list', workflowsGet: 'workflows:get', workflowsCreate: 'workflows:create', workflowsUpdate: 'workflows:update', workflowsRemove: 'workflows:remove',
  workflowRuns: 'workflows:runs', workflowRun: 'workflows:run', workflowStart: 'workflows:start', workflowStop: 'workflows:stop', workflowWindow: 'workflows:window', workflowConfirm: 'workflows:confirm', workflowLogs: 'workflows:logs',
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
  coursesCreate: 'courses:create',
  coursesUpdate: 'courses:update',
  coursesRemove: 'courses:remove',
  coursesDefaults: 'courses:defaults',

  interventionConfirm: 'intervention:confirm',

  schedulerGet: 'scheduler:get',
  schedulerUpdate: 'scheduler:update',

  progressGet: 'progress:get',

  browserOpenCourseWindow: 'browser:openCourseWindow',

  transcriptionGet: 'transcription:get',

  migrationReport: 'migration:report',

  logsRecent: 'logs:recent',

  dialogPickDirectory: 'dialog:pickDirectory',

  appVersion: 'app:version'
} as const

/** Main → Renderer，send/on（事件推送） */
export const IPC_EVENT = {
  workflowRun: 'event:workflow-run',
  botStatus: 'event:bot-status',
  log: 'event:log',
  progress: 'event:progress',
  courseLibraryChanged: 'event:course-library-changed',
  transcriptionStatus: 'event:transcription-status',
  schedulerStatus: 'event:scheduler-status',
  settingsChanged: 'event:settings-changed'
} as const

// ============================================================================
// 事件负载映射
// ============================================================================

export interface EventPayloads {
  'event:workflow-run': WorkflowRun
  [IPC_EVENT.botStatus]: BotStatus
  [IPC_EVENT.log]: LogEntry
  [IPC_EVENT.progress]: ProgressSnapshot
  [IPC_EVENT.courseLibraryChanged]: CourseLibrary
  [IPC_EVENT.transcriptionStatus]: TranscriptionStatus
  [IPC_EVENT.schedulerStatus]: SchedulerStatus
  [IPC_EVENT.settingsChanged]: AppSettings
}

export type EventName = keyof EventPayloads

// ============================================================================
// 请求 / 响应映射
// ============================================================================

export interface InvokeMap {
  'workflows:list': {req:void;res:Workflow[]}
  'workflows:get': {req:{id:string};res:Workflow|null}
  'workflows:create': {req:WorkflowInput;res:Workflow}
  'workflows:update': {req:{id:string;version:number;input:WorkflowInput};res:Workflow}
  'workflows:remove': {req:{id:string};res:void}
  'workflows:runs': {req:void;res:WorkflowRun[]}
  'workflows:run': {req:{id:string};res:WorkflowRun|null}
  'workflows:start': {req:{workflowId:string};res:WorkflowStartResult}
  'workflows:stop': {req:{runId:string};res:void}
  'workflows:window': {req:{runId:string};res:void}
  'workflows:confirm': {req:{runId:string;stepId:string;requestId:string};res:void}
  'workflows:logs': {req:{runId:string};res:RunEvent[]}

  [IPC_INVOKE.botStart]: { req: RunRequest; res: { ok: true } | { ok: false; errors: ValidationError[] } }
  [IPC_INVOKE.botStop]: { req: void; res: void }
  [IPC_INVOKE.botStatus]: { req: void; res: BotStatus }

  [IPC_INVOKE.settingsGetAll]: { req: void; res: AppSettings }
  [IPC_INVOKE.settingsUpdate]: { req: SettingsPatch; res: AppSettings }
  [IPC_INVOKE.settingsValidate]: { req: void; res: ValidationError[] }

  [IPC_INVOKE.credentialsGet]: { req: void; res: { username: string; hasPassword: boolean } }
  [IPC_INVOKE.credentialsSet]: { req: { username: string; password?: string }; res: CredentialState }
  [IPC_INVOKE.credentialsState]: { req: void; res: CredentialState }

  [IPC_INVOKE.coursesList]: { req: void; res: CourseLibrary }
  [IPC_INVOKE.coursesSelect]: { req: { id: string }; res: CourseMutationResult }
  [IPC_INVOKE.coursesCreate]: { req: CourseInput; res: CourseMutationResult }
  [IPC_INVOKE.coursesUpdate]: { req: { id: string; input: CourseInput }; res: CourseMutationResult }
  [IPC_INVOKE.coursesRemove]: { req: { id: string }; res: CourseMutationResult }
  [IPC_INVOKE.coursesDefaults]: { req: CourseRunOptions; res: CourseMutationResult }

  [IPC_INVOKE.interventionConfirm]: { req: void; res: void }

  [IPC_INVOKE.schedulerGet]: { req: void; res: SchedulerStatus }
  [IPC_INVOKE.schedulerUpdate]: { req: Partial<SchedulerConfig>; res: SchedulerStatus }

  [IPC_INVOKE.progressGet]: { req: void; res: ProgressSnapshot }

  [IPC_INVOKE.browserOpenCourseWindow]: { req: void; res: void }

  [IPC_INVOKE.transcriptionGet]: { req: void; res: TranscriptionStatus }

  [IPC_INVOKE.migrationReport]: { req: void; res: MigrationReport }

  [IPC_INVOKE.logsRecent]: { req: void; res: LogEntry[] }

  [IPC_INVOKE.dialogPickDirectory]: { req: void; res: string }

  [IPC_INVOKE.appVersion]: {
    req: void
    res: { version: string; electron: string; chrome: string; platform: NodeJS.Platform }
  }
}

export type InvokeName = keyof InvokeMap

// ============================================================================
// Preload 暴露的 API
// ============================================================================

export type Unsubscribe = () => void

export interface AppApi {
  workflows: WorkflowApi
  bot: {
    start(request: RunRequest): Promise<InvokeMap[typeof IPC_INVOKE.botStart]['res']>
    stop(): Promise<void>
    status(): Promise<BotStatus>
  }

  settings: {
    getAll(): Promise<AppSettings>
    update(patch: SettingsPatch): Promise<AppSettings>
    validate(): Promise<ValidationError[]>
  }

  credentials: {
    get(): Promise<{ username: string; hasPassword: boolean }>
    set(creds: { username: string; password?: string }): Promise<CredentialState>
    state(): Promise<CredentialState>
  }

  courses: {
    list(): Promise<CourseLibrary>
    select(id: string): Promise<CourseMutationResult>
    create(input: CourseInput): Promise<CourseMutationResult>
    update(id: string, input: CourseInput): Promise<CourseMutationResult>
    remove(id: string): Promise<CourseMutationResult>
    defaults(options: CourseRunOptions): Promise<CourseMutationResult>
  }

  /** 人工介入（验证码或手动登录）完成后由渲染层确认 */
  intervention: {
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
  }

  app: {
    version(): Promise<InvokeMap[typeof IPC_INVOKE.appVersion]['res']>
  }

  events: {
    onWorkflowRun(cb: (payload: WorkflowRun) => void): Unsubscribe
    onBotStatus(cb: (payload: BotStatus) => void): Unsubscribe
    onLog(cb: (payload: LogEntry) => void): Unsubscribe
    onProgress(cb: (payload: ProgressSnapshot) => void): Unsubscribe
    onCourseLibraryChanged(cb: (payload: CourseLibrary) => void): Unsubscribe
    onTranscriptionStatus(cb: (payload: TranscriptionStatus) => void): Unsubscribe
    onSchedulerStatus(cb: (payload: SchedulerStatus) => void): Unsubscribe
    onSettingsChanged(cb: (payload: AppSettings) => void): Unsubscribe
  }
}

/** 供 Renderer 使用的模式标签（TaskMode → 中文） */
export const TASK_MODE_LABEL: Record<TaskMode, string> = {
  classic: '刷课',
  map: '图谱刷课',
  mastery: '掌握度练习',
  'transcribe-only': '仅转录'
}
