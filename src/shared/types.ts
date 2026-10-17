import type { AccentColor } from './appearance'

/**
 * 领域模型类型 —— Main / Preload / Renderer 三方共享。
 *
 * 该文件不得 import 任何 Electron / Node API，保证 Renderer 可以安全引用。
 */

// ============================================================================
// Bot 生命周期
// ============================================================================

/** Bot 真实生命周期状态。由 BotService 唯一持有，UI 只读。 */
export type BotState = 'idle' | 'starting' | 'running' | 'stopping'

/** 任务模式。各课程策略独立实现，不在一个 Runner 里混写。 */
export type TaskMode = 'classic' | 'map' | 'mastery' | 'transcribe-only'

export type RunPhase = 'idle' | 'preparing' | 'login' | 'loading-course' | 'executing' | 'waiting' | 'stopping' | 'finished'
export interface RunError { stage: RunPhase; code: 'login' | 'course' | 'execution'; message: string }
export interface RunRequest { courseId: string }
export interface RunSnapshot { id: string; accountId?: string; lastVideoTitle?: string | null; course: Course; settings: AppSettings; startedAt: string; source: 'manual' | 'schedule' }
export type RunStatus = BotStatus
export interface BotStatus {
  runId?: string | null
  courseId?: string | null
  phase?: RunPhase
  snapshot?: RunSnapshot | null
  error?: RunError | null
  intervention?: InterventionRequest | null
  state: BotState
  /** 当前任务模式；state === 'idle' 时为 null */
  mode: TaskMode | null
  /** 正在处理的视频/知识项标题 */
  currentTitle: string | null
  /** 本次运行已完成的视频数 */
  completedCount: number
  /** 本次运行累计观看秒数（仅刷课模式累加） */
  watchedSeconds: number
  /** 停止原因，state === 'idle' 且非用户主动停止时有值 */
  stoppedReason: StopReason | null
  /** 人类可读的状态文案 + 语义色 */
  message: string
  tone: StatusTone
}

export type StopReason =
  | 'user'
  | 'time-limit'
  | 'out-of-schedule'
  | 'target-reached'
  /** 本轮把整个列表跑完了一遍（skip_completed=false 时的正常终点） */
  | 'completed'
  /** 已经没有待处理项了（skip_completed=true 且全部完成） */
  | 'pool-exhausted'
  | 'error'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger'

// ============================================================================
// 日志
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface LogEntry {
  /** epoch ms */
  time: number
  level: LogLevel
  message: string
}

// ============================================================================
// 进度
// ============================================================================

export interface DailyProgress {
  /** YYYY-MM-DD */
  date: string
  watchedSeconds: number
}

export interface ProgressSnapshot {
  today: DailyProgress
  /** 本次运行累计秒数 */
  sessionSeconds: number
  /** 自动调度目标（分钟）；0 表示不限制 */
  targetMinutes: number
}

// ============================================================================
// 课程
// ============================================================================

export interface CourseRunOptions {
  action: 'learn' | 'learn-transcribe' | 'transcribe'
  startPosition: 'beginning' | 'resume'
  skipCompleted: boolean
  timeLimitMinutes: number
}
export interface Course {
  id: string
  name: string
  url: string
  identity: string
  kind: 'classic' | 'map' | 'mastery' | 'unknown'
  options: CourseRunOptions
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  progressWarning: string | null
}
export interface CourseInput { name: string; url: string; options: CourseRunOptions }
export interface CourseLibrary { courses: Course[]; selectedCourseId: string | null; defaults: CourseRunOptions }
export type CourseMutationResult = { ok: true; library: CourseLibrary; courseId?: string } | { ok: false; message: string; existingCourseId?: string }

/** Legacy import record only. */
export interface CourseItem {
  url: string
  note: string
  display: string
}

// ============================================================================
// 验证码
// ============================================================================

export interface InterventionRequest {
  id?: string
  kind: 'captcha' | 'manual-login'
  message: string
  scene: 'login' | 'course' | 'video'
  at: number
}
export interface CaptchaRequiredEvent {
  kind?: InterventionRequest['kind']
  /** 面向用户的提示文案 */
  message: string
  /** 触发场景，便于 UI 分类展示 */
  scene: 'login' | 'course' | 'video'
  /** epoch ms */
  at: number
}

// ============================================================================
// 转录
// ============================================================================

export type TranscriptionPhase =
  | 'idle'
  | 'starting-worker'
  | 'recording'
  | 'converting'
  | 'downloading'
  | 'transcribing'
  | 'done'
  | 'failed'
  | 'worker-unavailable'

export interface TranscriptionStatus {
  outputFiles?: string[]
  phase: TranscriptionPhase
  /** 当前视频标题（可能被截断） */
  title: string | null
  completed: number
  failed: number
  message: string
  tone: StatusTone
  /** 0-100，未知为 null */
  percent: number | null
}

// ============================================================================
// 自动调度
// ============================================================================

export interface SchedulerConfig {
  courseId?: string | null
  enabled: boolean
  /** HH:mm */
  startTime: string
  /** HH:mm */
  endTime: string
  /** 勾选后忽略时间段 */
  allDay: boolean
  /** 每日目标分钟数，0 = 不限制 */
  dailyLimitMinutes: number
}

export interface SchedulerStatus {
  pausedReason?: string | null
  config: SchedulerConfig
  /** 当前是否处于允许运行时间段内 */
  inRange: boolean
  /** 今日是否已达目标 */
  targetReached: boolean
  /** 下次评估时间 epoch ms */
  nextTickAt: number
}

// ============================================================================
// 设置
// ============================================================================

export type LoginMethod = 'zhihuishu' | 'upc-institution' | 'upc'

/**
 * 持久化设置。所有字段都会落到 SQLite `settings` 表。
 * 键名与 v1 保持一致，便于 v1 数据库迁移。
 */
export interface AppSettings {
  /** 课程窗口静音，不改变视频本身的音轨。 */
  mutePlayback: boolean
  /** 启动课程窗口时保持隐藏，可手动打开。 */
  backgroundRun: boolean
  // --- 账号 ---
  loginMethod: LoginMethod

  // --- 课程 ---
  /** 课程视频 URL / 图谱课 URL */
  videoUrl: string
  /** 课程备注（同时作为 course_progress 的业务主键） */
  courseNote: string
  /** 登录后跳转 URL */
  loggedUrl: string

  // --- 刷课行为 ---
  brushEnabled: boolean
  mapMode: boolean
  skipCompleted: boolean
  fromLastProgress: boolean
  /** 单次运行时长上限（分钟），0 = 不限制 */
  timeLimitMinutes: number

  // --- 转录 ---
  transcribeEnabled: boolean
  transcribeBaseDir: string

  // --- 自动调度 ---
  autoMode: boolean
  autoStartTime: string
  autoEndTime: string
  autoAllDay: boolean
  autoLimitMinutes: number

  // --- 外观 ---
  /** 界面缩放系数（0.9 – 1.3）。v1 的 bg_blur_radius 属于旧的毛玻璃界面，
   *  v2 界面是平铺布局，该字段不再沿用。 */
  uiScale: number
  accentColor: AccentColor
}

export type SettingsPatch = Partial<AppSettings>

/** 凭据不落 SQLite，存 safeStorage 加密文件。 */
export interface Credentials {
  username: string
  password: string
}

export interface CredentialState {
  hasUsername: boolean
  hasPassword: boolean
  /** safeStorage 在当前平台是否可用 */
  encryptionAvailable: boolean
}

// ============================================================================
// 启动校验
// ============================================================================

export interface ValidationError {
  field: keyof AppSettings | 'credentials' | 'courseId'
  message: string
}

// ============================================================================
// 数据库迁移
// ============================================================================

export interface MigrationReport {
  /** 是否执行了从 v1 数据库的导入 */
  imported: boolean
  /** 已存在的 v2 库版本 */
  schemaVersion: number
  /** 从 v1 导入的行数统计 */
  importedRows: Record<string, number>
  /** 源数据库路径（未导入时为 null） */
  sourcePath: string | null
  message: string
}
