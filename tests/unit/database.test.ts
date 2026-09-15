/** 数据库 CRUD，重点覆盖 v1 缺陷 #2（课程进度键不一致）在 v2 的兼容处理。 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database, SCHEMA_VERSION } from '../../src/main/storage/database'

let dir: string
let db: Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ac-db-'))
  db = new Database(join(dir, 'test.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Database', () => {
  it('建表并写入 schema 版本', () => {
    expect(db.userVersion).toBe(SCHEMA_VERSION)
    const tables = db
      .raw()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).toContain('settings')
    expect(names).toContain('url_history')
    expect(names).toContain('daily_progress')
    expect(names).toContain('course_progress')
  })

  it('新库为空', () => {
    expect(db.isEmpty()).toBe(true)
  })

  it('settings 读写与默认值', () => {
    expect(db.getSetting('nope', 'fallback')).toBe('fallback')
    db.setSetting('a', '1')
    expect(db.getSetting('a')).toBe('1')
    db.setSetting('a', '2')
    expect(db.getSetting('a')).toBe('2')
  })

  // ------------------------------------------------------------ 每日进度

  it('每日进度 UPSERT 累加', () => {
    expect(db.getDailyProgress('2026-09-15')).toBe(0)
    db.addDailyProgress('2026-09-15', 60)
    db.addDailyProgress('2026-09-15', 30)
    expect(db.getDailyProgress('2026-09-15')).toBe(90)
    expect(db.getDailyProgress('2026-09-16')).toBe(0)
  })

  it('每日进度忽略 0 增量', () => {
    db.addDailyProgress('2026-09-15', 0)
    const rows = db.raw().prepare('SELECT COUNT(*) AS c FROM daily_progress').get() as { c: number }
    expect(rows.c).toBe(0)
  })

  // ------------------------------------------------------------ URL 历史

  it('URL 历史按最近使用排序且同 URL 去重', () => {
    db.saveUrlHistory('video', 'https://a', '课程A')
    db.saveUrlHistory('video', 'https://b', '课程B')
    db.saveUrlHistory('video', 'https://a', '课程A改')

    const list = db.getUrlHistory('video')
    expect(list).toHaveLength(2)
    // 再次写入 a 会刷新 used_at，因此 a 应排在最前
    expect(list[0].url).toBe('https://a')
    expect(list[0].note).toBe('课程A改')
  })

  it('空 URL 不写入', () => {
    db.saveUrlHistory('video', '')
    expect(db.getUrlHistory('video')).toHaveLength(0)
  })

  it('getNoteForUrl 只查 video 类型', () => {
    db.saveUrlHistory('video', 'https://a', '备注')
    db.saveUrlHistory('logged', 'https://a', '登录')
    expect(db.getNoteForUrl('https://a')).toBe('备注')
  })

  // ------------------------------------------------------------ 课程进度

  it('课程进度读写', () => {
    db.saveCourseProgress('艺术与审美', '1.2 艺术的起源')
    const row = db.getCourseProgress('艺术与审美')
    expect(row?.lastVideoTitle).toBe('1.2 艺术的起源')
  })

  it('课程进度：空键或空标题不写入', () => {
    db.saveCourseProgress('', 'x')
    db.saveCourseProgress('x', '')
    expect(db.getCourseProgress('x')).toBeNull()
  })

  /**
   * v1 缺陷 #2：写 course_progress 时用的是 sanitize 过的课程名，
   * 读的时候用原始 course_note。v2 统一用原始键，同时为导入数据保留
   * 「再试一次 sanitize 键」的兼容回退。
   */
  it('课程进度：兼容 v1 用 sanitize 键写入的行', () => {
    // 模拟从 v1 导入：键是 sanitize 之后的
    db.saveCourseProgress('艺术与审美', '2.1 绘画语言')
    const row = db.getCourseProgress('艺术与审美: 2024', '艺术与审美')
    expect(row?.lastVideoTitle).toBe('2.1 绘画语言')
  })

  it('课程进度：原始键优先于兼容键', () => {
    db.saveCourseProgress('艺术与审美', '原始键的值')
    db.saveCourseProgress('艺术_与审美', '兼容键的值')
    const row = db.getCourseProgress('艺术与审美', '艺术_与审美')
    expect(row?.lastVideoTitle).toBe('原始键的值')
  })

  // ------------------------------------------------------------ 课程列表

  it('课程列表：当前课程置顶且不重复', () => {
    db.saveUrlHistory('video', 'https://a', '课程A')
    db.saveUrlHistory('video', 'https://b', '课程B')

    const list = db.listCourses('https://b', '课程B')
    expect(list[0].url).toBe('https://b')
    expect(list.filter((i) => i.url === 'https://b')).toHaveLength(1)
  })

  it('课程列表：有备注时 display 带上备注', () => {
    const list = db.listCourses('https://a', '艺术与审美')
    expect(list[0].display).toContain('艺术与审美')
    expect(list[0].display).toContain('https://a')
  })
})
