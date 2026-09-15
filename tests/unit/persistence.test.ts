/**
 * 持久化与重启恢复（handoff §25 Phase 7）。
 *
 * 重点验证「关掉应用再打开，东西还在」：
 * 每日进度、课程历史、上次课程进度、全部设置。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../../src/main/storage/database'
import { SettingsService } from '../../src/main/services/settings-service'
import type { AppSettings } from '../../src/shared/types'

let dir: string
let dbFile: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ac-persist-'))
  dbFile = join(dir, 'auto_course.db')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 模拟一次「应用启动 → 操作 → 退出」 */
function withApp<T>(fn: (ctx: { db: Database; settings: SettingsService }) => T): T {
  const db = new Database(dbFile)
  try {
    return fn({ db, settings: new SettingsService(db) })
  } finally {
    db.close()
  }
}

describe('重启恢复', () => {
  it('设置在全量重启后保持不变', () => {
    const snapshot: AppSettings = {
      loginMethod: 'upc',
      videoUrl: 'https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/1/2?mapUid=u',
      courseNote: '艺术与审美',
      loggedUrl: 'https://hub.polymas.com/stu-hike',
      brushEnabled: false,
      mapMode: true,
      skipCompleted: false,
      fromLastProgress: true,
      timeLimitMinutes: 45,
      transcribeEnabled: true,
      transcribeBaseDir: '/tmp/out',
      autoMode: true,
      autoStartTime: '07:30',
      autoEndTime: '22:15',
      autoAllDay: false,
      autoLimitMinutes: 90,
      uiScale: 1.15
    }

    withApp(({ settings }) => settings.update(snapshot))

    // 重开
    const restored = withApp(({ settings }) => settings.getAll())
    expect(restored).toEqual(snapshot)
  })

  it('每日进度按天累加且跨重启保留', () => {
    withApp(({ db }) => {
      db.addDailyProgress('2026-09-14', 3600)
      db.addDailyProgress('2026-09-15', 1800)
      db.addDailyProgress('2026-09-15', 900)
    })

    const values = withApp(({ db }) => ({
      d14: db.getDailyProgress('2026-09-14'),
      d15: db.getDailyProgress('2026-09-15'),
      d16: db.getDailyProgress('2026-09-16')
    }))

    expect(values.d14).toBe(3600)
    expect(values.d15).toBe(2700)
    expect(values.d16).toBe(0)
  })

  it('课程历史跨重启保留，并保持最近使用顺序', () => {
    withApp(({ db }) => {
      db.saveUrlHistory('video', 'https://a', '课程A')
      db.saveUrlHistory('video', 'https://b', '课程B')
      db.saveUrlHistory('video', 'https://a', '课程A') // 再次使用 → 提到前面
    })

    const list = withApp(({ db }) => db.getUrlHistory('video'))
    expect(list.map((i) => i.url)).toEqual(['https://a', 'https://b'])
    expect(list[0].note).toBe('课程A')
  })

  it('上次课程进度跨重启保留（「从上次进度继续」的依据）', () => {
    withApp(({ db }) => {
      db.saveCourseProgress('艺术与审美', '2.2 雕塑与空间')
    })

    const row = withApp(({ db }) => db.getCourseProgress('艺术与审美'))
    expect(row?.lastVideoTitle).toBe('2.2 雕塑与空间')
    expect(row?.updatedAt).toBeTruthy()
  })

  it('课程进度会被新值覆盖而不是追加', () => {
    withApp(({ db }) => {
      db.saveCourseProgress('课程', '第 1 讲')
      db.saveCourseProgress('课程', '第 2 讲')
    })
    const rows = withApp(({ db }) =>
      db.raw().prepare('SELECT COUNT(*) AS c FROM course_progress').get()
    ) as { c: number }
    expect(rows.c).toBe(1)
    expect(withApp(({ db }) => db.getCourseProgress('课程'))?.lastVideoTitle).toBe('第 2 讲')
  })

  it('课程下拉列表把当前课程置顶', () => {
    withApp(({ db }) => {
      db.saveUrlHistory('video', 'https://a', 'A')
      db.saveUrlHistory('video', 'https://b', 'B')
    })
    const list = withApp(({ db }) => db.listCourses('https://b', 'B'))
    expect(list[0].url).toBe('https://b')
    expect(list).toHaveLength(2)
  })

  it('重复打开同一个库不会报错也不会丢数据', () => {
    withApp(({ settings }) => settings.update({ timeLimitMinutes: 30 }))
    // 连续开三次
    withApp(() => undefined)
    withApp(() => undefined)
    expect(withApp(({ settings }) => settings.getAll().timeLimitMinutes)).toBe(30)
  })

  it('schema 版本被记录，重复打开不会重复迁移', () => {
    const first = withApp(({ db }) => db.userVersion)
    const second = withApp(({ db }) => db.userVersion)
    expect(first).toBe(second)
    expect(first).toBeGreaterThanOrEqual(1)
  })

  it('已写入数据的库不会被 v1 导入覆盖', () => {
    withApp(({ settings }) => settings.update({ courseNote: '我的课程' }))
    // maybeImportLegacy 已在 Phase 3 覆盖；这里确认数据仍在
    expect(withApp(({ settings }) => settings.getAll().courseNote)).toBe('我的课程')
  })
})

describe('每日进度与目标的配合', () => {
  it('跨天时今日进度归零（不影响昨天）', () => {
    withApp(({ db }) => {
      db.addDailyProgress('2026-09-14', 7200)
      db.addDailyProgress('2026-09-15', 60)
    })

    const today = withApp(({ db }) => db.getDailyProgress('2026-09-15'))
    const yesterday = withApp(({ db }) => db.getDailyProgress('2026-09-14'))
    expect(today).toBe(60)
    expect(yesterday).toBe(7200)
  })

  it('getDailyProgressRange 按日期倒序返回', () => {
    withApp(({ db }) => {
      db.addDailyProgress('2026-09-13', 100)
      db.addDailyProgress('2026-09-15', 300)
      db.addDailyProgress('2026-09-14', 200)
    })
    const range = withApp(({ db }) => db.getDailyProgressRange(2))
    expect(range.map((r) => r.date)).toEqual(['2026-09-15', '2026-09-14'])
    expect(range[0].watchedSeconds).toBe(300)
  })
})
