/**
 * CourseRunner 契约 —— 传统课程、图谱课程和掌握度课程各自实现，互不混写。
 *
 * handoff §9 明确要求不要出现 `if (mapMode) {...} else {...}` 塞进一个巨大 Bot 类。
 * BotService 只认这个接口，按 TaskMode 挑实现。
 */

import type { AppSettings, Credentials, StopReason, TaskMode, RunPhase, RunError, InterventionRequest } from '@shared/types'
import type { BrowserSession } from './browser-session'
import type { EventBus } from '../services/event-bus'
import type { Logger } from '../services/logger'
import type { CourseDiagnosticPort } from '../services/course-diagnostics'
import type { MasteryQuestionBank } from './mastery/question-bank'

export interface RunOutcome {
  error?: RunError
  /** 本次运行完成的视频/知识项数量 */
  completedCount: number
  /** 本次实际观看秒数（用于每日进度） */
  watchedSeconds: number
  /** 结束原因。BotService 据此决定停止文案与后续动作。 */
  reason: StopReason
}

/**
 * 媒体/转录端口。
 *
 * Phase 6 接入真实转录服务前，Runner 只认这个接口，
 * 从而保证「刷课 + 转录」与「仅转录」两条链路都能挂在同一个 Runner 上
 * （handoff §22、§28「Map + Transcription」）。
 * 未启用转录时 ctx.media 为 null。
 */
export interface MediaPort {
  /** True only while a page-bound real-time recorder is active. */
  hasActiveRecording(): boolean
  /** 视频即将开始播放（实时录音模式在这里开始录制） */
  onVideoBegin(session: BrowserSession, title: string): Promise<void>
  /**
   * 视频播放结束。
   * 实时录音模式在这里停止录制并把音频入队；
   * 仅转录模式不走这里 —— 它由 Runner 直接调 transcribeOnly()。
   */
  onVideoEnd(title: string): Promise<void>
  /** 仅转录模式：下载直链提取音轨并转写，不播放视频 */
  transcribeOnly(session: BrowserSession, title: string): Promise<boolean>
}

export interface RunnerContext {
  readonly settings: AppSettings
  readonly credentials: Credentials
  readonly bus: EventBus
  readonly session: BrowserSession
  readonly log: Logger
  /** 未启用转录时为 null */
  readonly media: MediaPort | null
  readonly diagnostics?: CourseDiagnosticPort
  /** 掌握度课持久题库；其他课程策略忽略。 */
  readonly masteryQuestionBank?: MasteryQuestionBank

  /**
   * 「从上次进度继续」的起点标题，来自 course_progress。
   * 未启用该选项或没有记录时为空串。
   */
  readonly lastVideoTitle: string

  /** 外部是否已请求停止。Runner 必须在其长循环里定期检查。 */
  shouldStop(): boolean

  /** 本次运行累计观看秒数，用于判断单次时长上限 */
  sessionWatchedSeconds(): number

  /**
   * 报告「某个视频实际观看了多少秒」。
   * 使用监控循环的真实耗时，而不是 video DOM 的 duration ——
   * 用户拖动进度条不会让时长虚增（v1 `_accumulate_duration` 的同样理由）。
   */
  reportVideoWatched(seconds: number): void

  /** 报告某个视频/知识项已完成，用于写 course_progress */
  reportVideoCompleted(title: string): void

  /** 当前处理的标题，用于 UI 展示 */
  reportCurrentTitle(title: string): void

  /**
   * 请求人工处理验证码。
   * 返回 true 表示用户已确认并继续；false 表示期间收到停止请求。
   */
  reportPhase?(phase: RunPhase): void
  requestCaptcha(scene: 'login' | 'course' | 'video', message: string, kind?: InterventionRequest['kind']): Promise<boolean>
}

export interface CourseRunner {
  readonly mode: TaskMode
  run(ctx: RunnerContext): Promise<RunOutcome>
}

/** 供 Runner 主动中止自身时抛出（例如课程池耗尽）。 */
export class RunnerAbort extends Error {
  constructor(
    readonly reason: StopReason,
    message: string
  ) {
    super(message)
    this.name = 'RunnerAbort'
  }
}
