/**
 * 调度器的决策逻辑。
 *
 * v1 的 `_auto_scheduler_evaluate` 每 30 秒跑一次，v2 等价。
 * 这里用假的 controller 把「什么时候自动开始 / 自动停止」钉死。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from '../../src/main/storage/database'
import { SettingsService } from '../../src/main/services/settings-service'
import { EventBus } from '../../src/main/services/event-bus'
import { SchedulerService, isTimeInRange } from '../../src/main/services/scheduler-service'
import type { StopReason } from '../../src/shared/types'

let dir: string
let db: Database
let settings: SettingsService
let bus: EventBus
let scheduler: SchedulerService

interface FakeController {
  running: boolean
  starts: number
  stops: StopReason[]
  isRunning: () => boolean
  startForSchedule: () => Promise<void>
  stopForSchedule: (reason: StopReason) => Promise<void>
}

function makeController(running = false): FakeController {
  const controller: FakeController = {
    running,
    starts: 0,
    stops: [],
    isRunning: () => controller.running,
    startForSchedule: async () => {
      controller.starts += 1
      controller.running = true
    },
    stopForSchedule: async (reason) => {
      controller.stops.push(reason)
      controller.running = false
    }
  }
  return controller
}

/** 用固定日期，避免测试受真实时间影响 */
const TODAY = '2026-09-15'
const at = (h: number, m = 0): Date => new Date(2026, 8, 15, h, m, 0)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ac-sched-'))
  db = new Database(join(dir, 'test.db'))
  db.setSetting('schedulerCourseId', 'fixture-course')
  settings = new SettingsService(db)
  bus = new EventBus()
})

afterEach(() => {
  scheduler?.stop()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('自动调度：未启用时什么都不做', () => {
  it('不启动也不停止', async () => {
    const controller = makeController(false)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(10))
    expect(controller.starts).toBe(0)
    expect(controller.stops).toHaveLength(0)
  })
})

describe('自动调度：自动启动', () => {
  beforeEach(() => {
    settings.update({ autoMode: true, autoLimitMinutes: 120, autoStartTime: '06:00', autoEndTime: '23:00' })
  })

  it('在允许时段内且未达标时自动开始', async () => {
    const controller = makeController(false)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(10))
    expect(controller.starts).toBe(1)
  })

  it('不在允许时段内时不开始', async () => {
    const controller = makeController(false)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(3))
    expect(controller.starts).toBe(0)
  })

  it('全天允许时忽略时间段', async () => {
    settings.update({ autoAllDay: true, autoStartTime: '06:00', autoEndTime: '07:00' })
    const controller = makeController(false)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(3))
    expect(controller.starts).toBe(1)
  })

  it('今日已达标时不再开始', async () => {
    db.addDailyProgress(TODAY, 120 * 60)
    const controller = makeController(false)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(10))
    expect(controller.starts).toBe(0)
  })

  it('目标为 0 表示不限时长，在允许时段启动', async () => {
    settings.update({ autoLimitMinutes: 0 })
    const controller = makeController(false)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(10))
    expect(controller.starts).toBe(1)
  })

  it('已经在运行时不会重复启动', async () => {
    const controller = makeController(true)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(10))
    expect(controller.starts).toBe(0)
  })
})

describe('自动调度：自动停止', () => {
  beforeEach(() => {
    settings.update({
      autoMode: true,
      autoLimitMinutes: 120,
      autoStartTime: '06:00',
      autoEndTime: '23:00',
      brushEnabled: true
    })
  })

  it('超出允许时段时停止（不关闭 auto_mode，便于第二天继续）', async () => {
    const controller = makeController(true)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(23, 30))

    expect(controller.stops).toEqual(['out-of-schedule'])
    // 用户勾的自动模式必须保留 —— 这是 v1 `_stop_bot(auto_uncheck=False)` 的语义
    expect(settings.getAll().autoMode).toBe(true)
  })

  it('今日达标时停止', async () => {
    db.addDailyProgress(TODAY, 120 * 60)
    const controller = makeController(true)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(10))

    expect(controller.stops).toEqual(['target-reached'])
    expect(settings.getAll().autoMode).toBe(true)
  })

  it('运行中且一切正常时不动作', async () => {
    const controller = makeController(true)
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(10))
    expect(controller.stops).toHaveLength(0)
  })
})

describe('自动调度：课程池耗尽', () => {
  it('收到 pool-exhausted 后关闭自动模式', () => {
    settings.update({ autoMode: true })
    scheduler = new SchedulerService(settings, db, bus, makeController(false))
    scheduler.start()

    bus.emit('event:bot-status', {
      state: 'idle',
      mode: null,
      currentTitle: null,
      completedCount: 3,
      watchedSeconds: 100,
      stoppedReason: 'pool-exhausted',
      message: '课程已全部完成',
      tone: 'success'
    })

    // v1 的判断是「自然结束且本次进度 < 60s」；v2 用 BotService 明确给出的
    // pool-exhausted，更准确（handoff §28）
    expect(settings.getAll().autoMode).toBe(false)
  })

  it('用户主动停止不会关闭自动模式', () => {
    settings.update({ autoMode: true })
    scheduler = new SchedulerService(settings, db, bus, makeController(false))
    scheduler.start()

    bus.emit('event:bot-status', {
      state: 'idle',
      mode: null,
      currentTitle: null,
      completedCount: 1,
      watchedSeconds: 100,
      stoppedReason: 'user',
      message: '已停止',
      tone: 'danger'
    })

    expect(settings.getAll().autoMode).toBe(true)
  })
})

describe('调度状态', () => {
  it('未启用时 inRange 恒为 true', () => {
    scheduler = new SchedulerService(settings, db, bus, makeController(false))
    const status = scheduler.getStatus()
    expect(status.config.enabled).toBe(false)
    expect(status.inRange).toBe(true)
  })

  it('启用后如实反映时段与达标情况', () => {
    settings.update({ autoMode: true, autoLimitMinutes: 60, autoStartTime: '06:00', autoEndTime: '23:00' })
    scheduler = new SchedulerService(settings, db, bus, makeController(false))

    // 用真实当前时间取状态（getStatus 不接受注入时间）
    const status = scheduler.getStatus()
    expect(status.config.enabled).toBe(true)
    expect(status.config.dailyLimitMinutes).toBe(60)
    expect(status.inRange).toBe(isTimeInRange(new Date(), '06:00', '23:00'))
  })
})

describe('SchedulerService.start/stop', () => {
  it('start 之后 stop 会清掉定时器与订阅', () => {
    scheduler = new SchedulerService(settings, db, bus, makeController(false))
    scheduler.start()
    scheduler.start() // 幂等
    scheduler.stop()
    scheduler.stop() // 幂等
    // 停止之后再发事件不应再改动设置
    settings.update({ autoMode: true })
    bus.emit('event:bot-status', {
      state: 'idle',
      mode: null,
      currentTitle: null,
      completedCount: 0,
      watchedSeconds: 0,
      stoppedReason: 'pool-exhausted',
      message: '',
      tone: 'success'
    })
    expect(settings.getAll().autoMode).toBe(true)
  })

  it('tick 在 stop 之后不再动作', async () => {
    settings.update({ autoMode: true, autoLimitMinutes: 60 })
    const controller = makeController(false)
    scheduler = new SchedulerService(settings, db, bus, controller)
    scheduler.start()
    scheduler.stop()
    await scheduler.tick(at(10))
    expect(controller.starts).toBe(0)
  })
})

describe('跨午夜调度', () => {
  it('22:00–06:00 时段内凌晨也能自动开始', async () => {
    settings.update({
      autoMode: true,
      autoLimitMinutes: 60,
      autoStartTime: '22:00',
      autoEndTime: '06:00'
    })
    const controller = makeController(false)
    scheduler = new SchedulerService(settings, db, bus, controller)

    await scheduler.tick(new Date(2026, 8, 15, 2, 0, 0))
    expect(controller.starts).toBe(1)

    vi.restoreAllMocks()
  })
})


describe('独立调度目标与错误暂停', () => {
  it('使用固定的调度课程 ID，失败后暂停，恢复后才继续', async () => {
    const controller = makeController(false)
    const start = vi.spyOn(controller, 'startForSchedule')
    settings.update({ autoMode: true, autoAllDay: true, autoLimitMinutes: 10 })
    scheduler = new SchedulerService(settings, db, bus, controller)
    scheduler.start()
    await scheduler.tick(at(10))
    expect(start).toHaveBeenCalledWith('fixture-course')
    controller.running = false
    bus.emit('event:bot-status', { state: 'idle', mode: null, currentTitle: null, completedCount: 0, watchedSeconds: 0, stoppedReason: 'error', message: '登录失败', tone: 'danger' })
    await scheduler.tick(at(10))
    expect(controller.starts).toBe(1)
    expect(scheduler.getStatus().pausedReason).toBe('登录失败')
    scheduler.resume(); await scheduler.tick(at(10)); expect(controller.starts).toBe(2)
  })
  it('缺少调度目标时暂停，不启动其他已选择课程', async () => {
    db.setSetting('schedulerCourseId', '')
    const controller = makeController(false)
    settings.update({ autoMode: true, autoAllDay: true })
    scheduler = new SchedulerService(settings, db, bus, controller)
    await scheduler.tick(at(10))
    expect(controller.starts).toBe(0)
    expect(scheduler.getStatus().pausedReason).toContain('选择')
  })
})
