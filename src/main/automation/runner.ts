/**
 * CourseRunner 契约 —— 传统课程与图谱课程各自实现，互不混写。
 *
 * handoff §9 明确要求不要出现 `if (mapMode) {...} else {...}` 塞进一个巨大 Bot 类。
 * BotService 只认这个接口，按 TaskMode 挑实现。
 */

import type { AppSettings, Credentials, StopReason, TaskMode } from '@shared/types'
import type { BrowserSession } from './browser-session'
import type { EventBus } from '../services/event-bus'
import type { Logger } from '../services/logger'

export interface RunOutcome {
  /** 本次运行完成的视频/知识项数量 */
  completedCount: number
  /** 本次实际观看秒数（用于每日进度） */
  watchedSeconds: number
  /** 结束原因。BotService 据此决定停止文案与后续动作。 */
  reason: StopReason
}

export interface RunnerContext {
  readonly settings: AppSettings
  readonly credentials: Credentials
  readonly bus: EventBus
  readonly session: BrowserSession
  readonly log: Logger

  /** 外部是否已请求停止。Runner 必须在其长循环里定期检查。 */
  shouldStop(): boolean

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
  requestCaptcha(scene: 'login' | 'course' | 'video', message: string): Promise<boolean>
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
