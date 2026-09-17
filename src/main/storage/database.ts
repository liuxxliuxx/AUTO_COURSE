/**
 * SQLite 持久化。只做 CRUD，不含业务默认值（与 v1 database.py 的分工一致）。
 *
 * 表结构与 v1 保持兼容，便于一次性导入 v1 数据库；
 * v2 自己的 schema 版本记在 PRAGMA user_version 里。
 */

import BetterSqlite3 from 'better-sqlite3'
import { createLogger } from '../services/logger'
import type { CourseItem, DailyProgress, LogEntry } from '@shared/types'

const logger = createLogger('database')

/** v2 schema 版本。每次改表结构都要 +1 并补一条迁移。 */
export const SCHEMA_VERSION = 2

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS url_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_type TEXT NOT NULL,
    url TEXT NOT NULL,
    note TEXT DEFAULT '',
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(url_type, url)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_url_history_type_url
    ON url_history(url_type, url);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_progress (
    date TEXT PRIMARY KEY,
    watched_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS course_progress (
    course_note TEXT PRIMARY KEY,
    last_video_title TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);
`

export interface CourseProgressRow {
  courseNote: string
  lastVideoTitle: string
  updatedAt: string
}

export class Database {
  private db: BetterSqlite3.Database

  constructor(readonly file: string) {
    this.db = new BetterSqlite3(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.ensureSchema()
  }

  // ------------------------------------------------------------------ schema

  private ensureSchema(): void {
    this.db.transaction(() => {
      this.db.exec(SCHEMA_SQL)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS courses (
          id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, name TEXT NOT NULL, url TEXT NOT NULL,
          kind TEXT NOT NULL, options TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          last_run_at TEXT, deleted_at TEXT, progress_warning TEXT
        );
        CREATE TABLE IF NOT EXISTS course_progress_v2 (
          course_id TEXT PRIMARY KEY REFERENCES courses(id), last_video_title TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `)
      const current = this.userVersion
      if (current < SCHEMA_VERSION) {
        this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
        logger.info(`数据库 schema 版本 ${current} → ${SCHEMA_VERSION}`)
      }
    })()

  }

  get userVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number
  }

  /** 是否是一张空库（用于判断要不要做 v1 导入） */
  isEmpty(): boolean {
    const row = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM settings) +
           (SELECT COUNT(*) FROM url_history) +
           (SELECT COUNT(*) FROM daily_progress) +
           (SELECT COUNT(*) FROM course_progress) AS total`
      )
      .get() as { total: number }
    return row.total === 0
  }

  // ----------------------------------------------------------------- helpers

  /** 供 v1 导入使用的原始连接（批量写入包在一个事务里） */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  raw(): BetterSqlite3.Database {
    return this.db
  }

  // ---------------------------------------------------------------- settings

  getSetting(key: string, fallback = ''): string {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? row.value : fallback
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, value)
  }

  allSettings(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string
      value: string
    }>
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }

  // ------------------------------------------------------------- url_history

  saveUrlHistory(urlType: string, url: string, note = ''): void {
    if (!url) return
    this.db
      .prepare(
        'INSERT OR REPLACE INTO url_history (url_type, url, note, used_at) ' +
          'VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
      )
      .run(urlType, url, note)
  }

  getUrlHistory(urlType: string, limit = 20): Array<{ url: string; note: string }> {
    const rows = this.db
      .prepare(
        'SELECT url, note FROM url_history WHERE url_type = ? ' +
          'GROUP BY url ORDER BY MAX(used_at) DESC LIMIT ?'
      )
      .all(urlType, limit) as Array<{ url: string; note: string | null }>
    return rows.map((r) => ({ url: r.url, note: r.note ?? '' }))
  }

  getNoteForUrl(url: string): string {
    if (!url) return ''
    const row = this.db
      .prepare("SELECT note FROM url_history WHERE url_type = 'video' AND url = ?")
      .get(url) as { note: string | null } | undefined
    return row?.note ?? ''
  }

  // ---------------------------------------------------------- daily_progress

  getDailyProgress(date: string): number {
    const row = this.db.prepare('SELECT watched_seconds FROM daily_progress WHERE date = ?').get(date) as
      | { watched_seconds: number }
      | undefined
    return row?.watched_seconds ?? 0
  }

  addDailyProgress(date: string, secondsDelta: number): void {
    if (!secondsDelta) return
    this.db
      .prepare(
        'INSERT INTO daily_progress (date, watched_seconds) VALUES (?, ?) ' +
          'ON CONFLICT(date) DO UPDATE SET watched_seconds = watched_seconds + ?'
      )
      .run(date, secondsDelta, secondsDelta)
  }

  getDailyProgressRange(days: number): DailyProgress[] {
    const rows = this.db
      .prepare('SELECT date, watched_seconds FROM daily_progress ORDER BY date DESC LIMIT ?')
      .all(days) as Array<{ date: string; watched_seconds: number }>
    return rows.map((r) => ({ date: r.date, watchedSeconds: r.watched_seconds }))
  }

  // --------------------------------------------------------- course_progress

  /**
   * 读取课程进度。
   *
   * v2 统一使用**原始** course_note 作为键（v1 写入用 sanitize 后的名字、
   * 读取用原始名字，是一个已确认的缺陷，见 docs/V1_BASELINE.md §7.2）。
   * 为了兼容从 v1 导入的数据，找不到时再退回试一次 sanitize 后的形式。
   */
  getCourseProgress(courseNote: string, legacyKey?: string): CourseProgressRow | null {
    if (!courseNote) return null
    const select = this.db.prepare(
      'SELECT course_note, last_video_title, updated_at FROM course_progress WHERE course_note = ?'
    )
    const read = (key: string): CourseProgressRow | null => {
      const row = select.get(key) as
        | { course_note: string; last_video_title: string; updated_at: string }
        | undefined
      return row
        ? { courseNote: row.course_note, lastVideoTitle: row.last_video_title, updatedAt: row.updated_at }
        : null
    }
    const direct = read(courseNote)
    if (direct) return direct
    if (legacyKey && legacyKey !== courseNote) return read(legacyKey)
    return null
  }

  saveCourseProgress(courseNote: string, videoTitle: string): void {
    if (!courseNote || !videoTitle) return
    this.db
      .prepare(
        'INSERT OR REPLACE INTO course_progress (course_note, last_video_title, updated_at) ' +
          "VALUES (?, ?, datetime('now'))"
      )
      .run(courseNote, videoTitle)
  }

  // ---------------------------------------------------------------- 课程列表

  /** 课程下拉列表：当前课程置顶，其余按最近使用排序。 */
  listCourses(currentUrl: string, currentNote: string): CourseItem[] {
    const items: CourseItem[] = []
    const seen = new Set<string>()

    const push = (url: string, note: string): void => {
      if (!url || seen.has(url)) return
      seen.add(url)
      const trimmed = (note ?? '').trim()
      items.push({
        url,
        note: trimmed,
        display: trimmed ? `${trimmed} — ${url}` : url
      })
    }

    if (currentUrl) push(currentUrl, currentNote)
    for (const row of this.getUrlHistory('video')) push(row.url, row.note)
    return items
  }

  // ------------------------------------------------------------------ 日志表
  // v2 暂不把日志写库（v1 也没有）。保留一个空实现占位，Phase 7 视需要再加。

  close(): void {
    try {
      this.db.close()
    } catch (error) {
      logger.exception('关闭数据库失败', error)
    }
  }
}

export type { LogEntry }
