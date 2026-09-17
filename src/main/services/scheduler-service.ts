/**
 * 自动调度服务（handoff §19）。
 *
 * 完全独立于 UI：Renderer 关闭或切页都不影响调度状态。
 * 逻辑移植自 v1 `gui/bridge.py::_auto_scheduler_evaluate`，保持行为等价，
 * 但把「自然结束」的判定从「线程是否存活」换成 BotService 明确给出的停止原因。
 */

import type { SchedulerConfig, SchedulerStatus, StopReason } from '@shared/types'
import type { SettingsService } from './settings-service'
import type { Database } from '../storage/database'
import { createLogger } from './logger'
import type { EventBus } from './event-bus'

const logger = createLogger('scheduler')

/** 与 v1 一致：30 秒一次 */
const TICK_MS = 30_000

export interface SchedulerController {
  isRunning(): boolean
  isScheduledRun?(): boolean
  /** 由调度器发起的启动 */
  startForSchedule(courseId: string): Promise<void>
  /** 由调度器发起的停止（不会取消 autoMode） */
  stopForSchedule(reason: StopReason): Promise<void>
}

function todayString(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 判断当前时刻是否落在允许时间段内。
 * start > end 表示跨午夜（例如 22:00 → 06:00）。
 * 解析失败时返回 true —— 与 v1 一致，宁可不拦。
 */
export function isTimeInRange(now: Date, startStr: string, endStr: string): boolean {
  const parse = (s: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim())
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) return null
    return h * 60 + min
  }

  const start = parse(startStr)
  const end = parse(endStr)
  if (start === null || end === null) return true

  const current = now.getHours() * 60 + now.getMinutes()
  if (start <= end) return current >= start && current <= end
  return current >= start || current <= end
}

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null
  private unsubscribe: (() => void) | null = null
  private stopped = false

  constructor(
    private readonly settings: SettingsService,
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly controller: SchedulerController
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), TICK_MS)
    // 调度器不应阻止进程退出
    this.timer.unref?.()

    // 课程池耗尽 → 关掉自动模式，避免每 30 秒空转重启一次
    this.unsubscribe = this.bus.on('event:bot-status', (status) => {
      if (status.state !== 'idle') return
      if (status.stoppedReason === 'error' && this.getConfig().enabled) { this.pause(status.message); return }
      if (status.stoppedReason === 'pool-exhausted' && this.getConfig().enabled) {
        logger.info('课程池已耗尽，自动关闭自动调度')
        this.settings.update({ autoMode: false })
        this.emitStatus()
      }
    })

    logger.info('自动调度已启动')
    this.emitStatus()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  pause(reason: string): void {
    this.db.setSetting('schedulerPausedReason', reason)
    this.emitStatus()
  }
  resume(): void { this.db.setSetting('schedulerPausedReason', ''); this.emitStatus() }

  // ------------------------------------------------------------------ status

  getConfig(): SchedulerConfig {
    const s = this.settings.getAll()
    return {
      enabled: s.autoMode,
      courseId: this.db.getSetting('schedulerCourseId') || null,
      startTime: s.autoStartTime,
      endTime: s.autoEndTime,
      allDay: s.autoAllDay,
      dailyLimitMinutes: s.autoLimitMinutes
    }
  }

  getStatus(): SchedulerStatus {
    const config = this.getConfig()
    if (!config.enabled) {
      return {
        pausedReason: this.db.getSetting('schedulerPausedReason') || null,
        config,
        inRange: true,
        targetReached: false,
        nextTickAt: Date.now() + TICK_MS
      }
    }

    const now = new Date()
    const watched = this.db.getDailyProgress(todayString(now))
    const targetSeconds = config.dailyLimitMinutes * 60

    return {
      pausedReason: this.db.getSetting('schedulerPausedReason') || null,
      config,
      inRange: config.allDay || isTimeInRange(now, config.startTime, config.endTime),
      targetReached: targetSeconds > 0 && watched >= targetSeconds,
      nextTickAt: Date.now() + TICK_MS
    }
  }

  private emitStatus(): void {
    this.bus.emit('event:scheduler-status', this.getStatus())
  }

  // -------------------------------------------------------------------- tick

  /** 供测试直接驱动；生产由定时器调用。 */
  async tick(now = new Date()): Promise<void> {
    if (this.stopped) return

    const config = this.getConfig()
    const watched = this.db.getDailyProgress(todayString(now))
    const running = this.controller.isRunning()

    if (!config.enabled || this.db.getSetting('schedulerPausedReason')) {
      this.emitStatus()
      return
    }

    const inRange = config.allDay || isTimeInRange(now, config.startTime, config.endTime)
    const targetSeconds = config.dailyLimitMinutes * 60

    if (running) {
      if (this.controller.isScheduledRun && !this.controller.isScheduledRun()) return
      if (!inRange) {
        logger.info('已超出允许运行时间段，停止本次运行')
        await this.controller.stopForSchedule('out-of-schedule')
      } else if (targetSeconds > 0 && watched >= targetSeconds) {
        logger.info(`今日已刷 ${watched}s，达到目标 ${targetSeconds}s，停止本次运行`)
        await this.controller.stopForSchedule('target-reached')
      }
      this.emitStatus()
      return
    }

    // 未在运行：判断要不要自动开始
    if (!inRange) {
      this.emitStatus()
      return
    }
    if (targetSeconds > 0 && watched >= targetSeconds) {
      this.emitStatus()
      return
    }

    if (!config.courseId) { this.pause('请为自动调度选择一门课程'); return }
    logger.info('满足自动启动条件，开始刷课')
    try {
      await this.controller.startForSchedule(config.courseId)
    } catch (error) {
      logger.exception('自动启动失败', error)
      this.pause(error instanceof Error ? error.message : '自动启动失败')
    }
    this.emitStatus()
  }
}
