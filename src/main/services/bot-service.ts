/**
 * BotService —— 任务生命周期的唯一持有者。
 *
 *   idle → start → starting → running → stopping → idle
 *
 * handoff §10：不要让 UI 自己维护 Bot 的真实生命周期。Renderer 只能调用
 * start()/stop() 并订阅 bot-status，状态推导全部在这里。
 *
 * 本服务还负责：
 *  - 每日观看时长的记账（与是否启用转录**无关** —— 修复 v1 缺陷 #1/#3）
 *  - course_progress 的持久化（同样与转录解耦 —— 修复 v1 缺陷 #1）
 *  - 验证码人工确认的握手
 */

import type {
  AppSettings,
  RunRequest, RunSnapshot, RunPhase, RunError, InterventionRequest,
  BotState,
  BotStatus,
  CaptchaRequiredEvent,
  Credentials,
  StopReason,
  TaskMode,
  ValidationError
} from '@shared/types'
import { TASK_MODE_LABEL } from '@shared/ipc'
import type { AccountService } from './account-service'
import type { Database } from '../storage/database'
import type { CredentialStore } from '../storage/credentials'
import type { SettingsService } from './settings-service'
import type { EventBus } from './event-bus'
import type { BrowserService } from '../automation/browser-service'
import type { BrowserSession } from '../automation/browser-session'
import type { CourseRunner, MediaPort, RunOutcome, RunnerContext } from '../automation/runner'
import { randomUUID } from 'node:crypto'
import { identifyCourse, settingsForCourse, validateRunOptions } from '@shared/courses'
import type { CourseService } from './course-service'
import { createLogger, redactSecrets } from './logger'
import { MasteryQuestionBank } from '../automation/mastery/question-bank'

const logger = createLogger('bot')

export type RunnerFactory = (
  mode: TaskMode,
  ctx: RunnerContext
) => CourseRunner

function todayString(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export class BotService {
  private snapshot: RunSnapshot | null = null
  private phase: RunPhase = 'idle'
  private error: RunError | null = null
  private intervention: InterventionRequest | null = null
  private state: BotState = 'idle'
  private mode: TaskMode | null = null
  private currentTitle: string | null = null
  private completedCount = 0
  private watchedSeconds = 0
  private stoppedReason: StopReason | null = null
  private message = '就绪'
  private tone: BotStatus['tone'] = 'neutral'

  private runPromise: Promise<void> | null = null
  private stopRequested = false
  private disposed = false

  /** 尚未结算的观看秒数（不足 1 秒的零头先攒着，避免反复写库） */
  private pendingSeconds = 0

  /** 人工介入握手：验证码与手动登录共用同一条通道 */
  private interventionPending: { resolve: (confirmed: boolean) => void } | null = null

  constructor(
    private readonly db: Database,
    private readonly credentials: Pick<CredentialStore, 'get'>,
    private readonly settings: SettingsService,
    private readonly bus: EventBus,
    private readonly browser: BrowserService,
    private readonly createRunner: RunnerFactory,
    /**
     * 取得媒体/转录端口。返回 null 表示本次不转录。
     * 由 TranscriptionService 提供；不转录时**不会**启动 WASM worker。
     */
    private readonly acquireMedia: (
      settings: AppSettings,
      transcribeOnly: boolean,
      courseId: string
    ) => Promise<MediaPort | null>,
    private readonly courses: CourseService,
    private readonly accounts?: AccountService
  ) {}

  // ------------------------------------------------------------------ 状态

  getStatus(): BotStatus {
    return {
      runId: this.snapshot?.id ?? null, courseId: this.snapshot?.course.id ?? null,
      snapshot: this.snapshot, phase: this.phase, error: this.error ? {...this.error, message:redactSecrets(this.error.message)} : null, intervention: this.intervention,
      state: this.state,
      mode: this.mode,
      currentTitle: this.currentTitle,
      completedCount: this.completedCount,
      watchedSeconds: this.watchedSeconds,
      stoppedReason: this.stoppedReason,
      message: this.message,
      tone: this.tone
    }
  }

  isRunning(): boolean {
    return this.state === 'running' || this.state === 'starting' || this.state === 'stopping'
  }

  private setStatus(
    state: BotState,
    message: string,
    tone: BotStatus['tone'] = 'neutral',
    reason: StopReason | null = null
  ): void {
    this.state = state
    this.message = redactSecrets(message)
    this.tone = tone
    this.stoppedReason = reason
    this.bus.emit('event:bot-status', this.getStatus())
  }

  private emitStatus(): void {
    this.bus.emit('event:bot-status', this.getStatus())
  }

  // ------------------------------------------------------------------ 启动

  async start(request: RunRequest, source: 'manual' | 'schedule' = 'manual', explicit?: { snapshot: RunSnapshot; credentials: Credentials }): Promise<{ ok: true } | { ok: false; errors: ValidationError[] }> {
    if (this.isRunning()) {
      return { ok: false, errors: [{ field: 'videoUrl', message: '任务已在运行中' }] }
    }

    const course = explicit?.snapshot.course ?? this.courses.get(request?.courseId)
    if (!course) return { ok: false, errors: [{ field: 'courseId', message: '请选择一门有效的课程' }] }
    try { identifyCourse(course.url); validateRunOptions(course.options, course.kind) }
    catch (error) { return { ok: false, errors: [{ field: 'courseId', message: String(error) }] } }
    const runSettings = explicit?.snapshot.settings ?? settingsForCourse(this.settings.getAll(), course)
    const errors = this.settings.validate(runSettings)
    const creds = explicit?.credentials ?? this.credentials.get()
    if (!creds.username.trim()) {
      errors.push({ field: 'credentials', message: '账号不能为空' })
    }
    if (!creds.password) {
      errors.push({ field: 'credentials', message: '密码不能为空' })
    }
    if (errors.length) return { ok: false, errors }

    const mode = this.settings.deriveTaskMode(runSettings, course.kind)
    this.snapshot = explicit?.snapshot ?? { id: randomUUID(), course: structuredClone(course), settings: { ...runSettings }, startedAt: new Date().toISOString(), source }
    this.phase = 'preparing'
    this.error = null
    this.intervention = null
    if (this.snapshot.accountId) this.accounts?.markRun(this.snapshot.accountId, course.id)
    this.mode = mode
    this.completedCount = 0
    this.watchedSeconds = 0
    this.pendingSeconds = 0
    this.currentTitle = null
    this.stopRequested = false

    this.setStatus('starting', `正在初始化（${TASK_MODE_LABEL[mode]}）...`, 'success')

    this.runPromise = this.runLoop(mode, this.snapshot, { ...creds }).finally(() => {
      this.runPromise = null
    })

    return { ok: true }
  }

  async execute(snapshot: RunSnapshot, credentials: Credentials): Promise<BotStatus> {
    const result = await this.start({courseId:snapshot.course.id}, snapshot.source, {snapshot,credentials})
    if (!result.ok) throw new Error(result.errors.map(e => e.message).join('；'))
    await this.runPromise
    return this.getStatus()
  }

  /** 由调度器调用；与手动 start 的唯一区别是不做交互式报错 */
  async startForSchedule(courseId: string): Promise<void> {
    const result = await this.start({ courseId }, 'schedule')
    if (!result.ok) {
      const text = result.errors.map((e) => e.message).join('；')
      logger.warn(`自动启动被跳过: ${text}`)
      this.setStatus('idle', text, 'warning', 'error')
      throw new Error(text)
    }
  }

  // ------------------------------------------------------------------ 停止

  /**
   * 请求停止并等待运行循环收尾。
   * 只收尾一次：重复调用是安全的（handoff §28「生命周期只能收尾一次」）。
   */
  async stop(reason: StopReason = 'user'): Promise<void> {
    if (this.state === 'idle') return

    if (this.stopRequested) {
      // 已经在停：等上一次收尾完成即可
      await this.runPromise?.catch(() => undefined)
      return
    }

    this.stopRequested = true
    this.phase = 'stopping'
    this.stoppedReason = reason
    this.setStatus('stopping', '正在停止...', 'warning', reason)

    // 打断可能正在等待的人工介入确认
    this.interventionPending?.resolve(false)
    this.interventionPending = null

    await this.runPromise?.catch((error) => {
      logger.exception('等待运行循环结束时报错', error)
    })
  }

  async stopForSchedule(reason: StopReason): Promise<void> {
    await this.stop(reason)
  }

  // ------------------------------------------------------------------ 主循环

  private async runLoop(mode: TaskMode, snapshot: RunSnapshot, credentials: Credentials): Promise<void> {
    let outcome: RunOutcome = { completedCount: 0, watchedSeconds: 0, reason: 'user' }

    try {
      const settings = snapshot.settings

      const session = await this.browser.openSession()
      if (this.stopRequested) return

      // 仅转录：不播放视频，直接下载音轨。与 v1 bridge.py:274 的推导一致。
      const transcribeOnly = !settings.brushEnabled && !settings.mapMode
      const media = await this.acquireMedia(settings, transcribeOnly, snapshot.course.id)

      if (this.stopRequested) return
      const ctx = this.buildContext(
        settings,
        credentials,
        session,
        snapshot.course.options.startPosition === 'resume' ? snapshot.lastVideoTitle ?? '' : '',
        media
      )

      this.setStatus('running', `正在${TASK_MODE_LABEL[mode]}`, 'success')
      const runner = this.createRunner(mode, ctx)
      outcome = await runner.run(ctx)
      if (outcome.error && outcome.reason !== 'user') this.error = outcome.error
      if (outcome.reason === 'error' && !this.error) this.error = { stage: this.phase, code: this.phase === 'login' ? 'login' : this.phase === 'loading-course' ? 'course' : 'execution', message: '任务未能完成，请查看日志并重试' }
    } catch (error) {
      logger.exception('运行循环异常', error)
      this.error = { stage: this.phase, code: this.phase === 'login' ? 'login' : this.phase === 'loading-course' ? 'course' : 'execution', message: error instanceof Error ? error.message : String(error) }
      outcome = { ...outcome, reason: 'error' }
      this.setStatus('idle', '⚠ 运行出错，请查看日志', 'danger', 'error')
    } finally {
      this.flushPending()
      this.phase = 'finished'
      this.intervention = null
      // 只在这里收尾一次
      if (this.state !== 'idle') {
        this.state = 'idle'
        this.mode = null
        this.currentTitle = null
      }
      const label = this.describeOutcome(outcome)
      this.setStatus('idle', label.text, label.tone, outcome.reason)
      this.emitProgress()
    }
  }

  private describeOutcome(outcome: RunOutcome): { text: string; tone: BotStatus['tone'] } {
    switch (outcome.reason) {
      case 'user':
        return { text: '已停止', tone: 'danger' }
      case 'time-limit':
        return { text: '已达到单次时长上限', tone: 'warning' }
      case 'target-reached':
        return { text: '今日自动刷课已到目标时长', tone: 'warning' }
      case 'out-of-schedule':
        return { text: '不在允许运行时间内', tone: 'warning' }
      case 'pool-exhausted':
        return { text: '课程已全部完成', tone: 'success' }
      case 'completed':
        return { text: '本轮课程已跑完', tone: 'success' }
      case 'error':
        return { text: this.error?.message ?? '运行失败，请展开日志查看原因', tone: 'danger' }
      default:
        return { text: '已完成', tone: 'success' }
    }
  }

  /**
   * 「从上次进度继续」的起点。
   *
   * v1 只在转录成功时才写 course_progress，导致不开转录时这个功能静默失效
   * （docs/V1_BASELINE.md §7.1）。v2 的写入在 reportVideoCompleted 里，
   * 与转录完全无关；这里只负责读。
   */
  private buildContext(
    settings: AppSettings,
    credentials: Credentials,
    session: BrowserSession,
    lastVideoTitle: string,
    media: MediaPort | null
  ): RunnerContext {
    return {
      settings,
      credentials,
      bus: this.bus,
      session,
      log: createLogger('runner'),
      media,
      masteryQuestionBank: new MasteryQuestionBank(this.db, this.snapshot?.course.id),
      lastVideoTitle,
      shouldStop: () => this.stopRequested,
      sessionWatchedSeconds: () => this.watchedSeconds,
      reportVideoWatched: (seconds) => this.reportVideoWatched(seconds),
      reportVideoCompleted: (title) => this.reportVideoCompleted(title),
      reportCurrentTitle: (title) => {
        this.currentTitle = title
        this.emitStatus()
      },
      reportPhase: (phase) => { this.phase = phase; this.emitStatus() },
      requestCaptcha: (scene, message, kind) => this.requestCaptcha(scene, message, kind)
    }
  }

  // ------------------------------------------------------------------ 记账

  /**
   * 每日进度记账。**与转录无关** —— v1 只在转录成功时才写 course_progress，
   * 导致不开转录时「从上次进度继续」完全失效（docs/V1_BASELINE.md §7.1）。
   */
  private reportVideoWatched(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return
    this.watchedSeconds += seconds
    this.pendingSeconds += seconds
    this.flushPending()
    this.emitProgress()
  }

  private reportVideoCompleted(title: string): void {
    this.completedCount += 1
    if (this.snapshot?.accountId && title) this.accounts?.saveProgress(this.snapshot.accountId, this.snapshot.course.id, title)
    this.emitStatus()
  }

  /** 把攒下的秒数写进 daily_progress。 */
  private flushPending(): void {
    const whole = Math.floor(this.pendingSeconds)
    if (whole <= 0) return
    this.pendingSeconds -= whole
    this.db.addDailyProgress(todayString(), whole)
  }

  private emitProgress(): void {
    const date = todayString()
    const settings = this.snapshot?.settings ?? this.settings.getAll()
    this.bus.emit('event:progress', {
      today: { date, watchedSeconds: this.db.getDailyProgress(date) },
      sessionSeconds: Math.floor(this.watchedSeconds),
      targetMinutes: settings.autoMode ? settings.autoLimitMinutes : settings.timeLimitMinutes
    })
  }

  // ---------------------------------------------------------------- 人工介入

  private async requestCaptcha(scene: CaptchaRequiredEvent['scene'], message: string, kind: InterventionRequest['kind'] = 'captcha'): Promise<boolean> {
    if (this.stopRequested) return false

    const event: InterventionRequest = { id: randomUUID(), kind, message: redactSecrets(message), scene, at: Date.now() }
    const previousPhase = this.phase
    this.phase = 'waiting'
    this.intervention = event
    this.setStatus('running', `⚠ ${message}`, 'danger')
    logger.warn(`需要人工处理（${kind}/${scene}）: ${message}`)

    const confirmed = await new Promise<boolean>((resolve) => {
      this.interventionPending = { resolve }
    })

    this.interventionPending = null
    this.intervention = null
    this.phase = this.stopRequested ? 'stopping' : previousPhase
    this.emitStatus()
    if (confirmed) {
      this.setStatus('running', `正在${TASK_MODE_LABEL[this.mode ?? 'classic']}`, 'success')
    }
    return confirmed
  }

  /** Renderer 点「已完成验证/登录，继续」 */
  confirmIntervention(): void {
    this.interventionPending?.resolve(true)
  }

  // ------------------------------------------------------------------ 退出

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.stop('user')
    this.flushPending()
  }
}
