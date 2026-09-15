/**
 * v1 → v2 数据库导入。
 *
 * handoff §17：
 *   第一次启动 v2 → 检测 v1 DB → 复制 → 写入 v2 userData → 此后只用 v2 database
 *
 * 原则：
 *  - **只读**打开 v1 数据库，绝不修改（v1 冻结在 tag v1-pyside-final，要保持可回退）。
 *  - 只在 v2 库为空时导入一次；已有数据绝不覆盖。
 *  - 旧 UI 专用、v2 已废弃的键（bg_blur_radius / chrome_binary / chromedriver_binary）不导入。
 */

import BetterSqlite3 from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Database } from '../database'
import type { MigrationReport } from '@shared/types'
import { createLogger } from '../../services/logger'

const logger = createLogger('migrate:v1')

/** v1 的数据库目录名（config.py::_get_db_path） */
const V1_APP_DIRNAME = 'zhihuishu_auto_course'
const V1_DB_FILENAME = 'course_progress.db'

/** 按平台还原 v1 的数据目录。 */
export function findLegacyDatabase(): string | null {
  let base: string
  if (process.platform === 'darwin') {
    base = join(homedir(), 'Library', 'Application Support')
  } else if (process.platform === 'win32') {
    base = process.env['APPDATA'] ?? homedir()
  } else {
    base = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share')
  }
  const candidate = join(base, V1_APP_DIRNAME, V1_DB_FILENAME)
  return existsSync(candidate) ? candidate : null
}

/**
 * v1 settings 键 → v2 键 的映射。
 * 值为 undefined 表示该键在 v2 中已废弃，不导入。
 */
const SETTING_MAP: Record<string, string | undefined> = {
  login_method: 'loginMethod',
  video_url: 'videoUrl',
  course_note: 'courseNote',
  logged_url: 'loggedUrl',
  brush_enabled: 'brushEnabled',
  map_mode: 'mapMode',
  skip_completed: 'skipCompleted',
  from_last_progress: 'fromLastProgress',
  time_limit: 'timeLimitMinutes',
  transcribe_enabled: 'transcribeEnabled',
  transcribe_base_dir: 'transcribeBaseDir',
  auto_mode: 'autoMode',
  auto_start_time: 'autoStartTime',
  auto_end_time: 'autoEndTime',
  auto_allday: 'autoAllDay',
  auto_limit: 'autoLimitMinutes',
  // v2 已废弃
  bg_blur_radius: undefined,
  chrome_binary: undefined,
  chromedriver_binary: undefined
}

interface V1Row {
  [key: string]: unknown
}

function readLegacySettings(legacy: BetterSqlite3.Database): Map<string, string> {
  const rows = legacy.prepare('SELECT key, value FROM settings').all() as V1Row[]
  const map = new Map<string, string>()
  for (const row of rows) {
    map.set(String(row.key), String(row.value ?? ''))
  }
  return map
}

function tableExists(legacy: BetterSqlite3.Database, name: string): boolean {
  const row = legacy
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name)
  return !!row
}

/**
 * 执行导入。
 * `db` 必须是已建表、且**为空**的 v2 数据库。
 */
export function importLegacyDatabase(db: Database, legacyPath: string): MigrationReport {
  const counts: Record<string, number> = {}
  const legacy = new BetterSqlite3(legacyPath, { readonly: true, fileMustExist: true })

  try {
    db.transaction(() => {
      // ---------------- settings ----------------
      const legacySettings = readLegacySettings(legacy)
      let settingsCount = 0

      for (const [oldKey, newKey] of Object.entries(SETTING_MAP)) {
        if (!newKey) continue
        const value = legacySettings.get(oldKey)
        if (value === undefined || value === '') continue
        db.setSetting(newKey, value)
        settingsCount += 1
      }

      // v1 的 auto_limit 缺省时会退回 time_limit（bridge.py:79-82）。
      // 这里只在 v2 还没写入 autoLimitMinutes 时补上同样的回退语义。
      if (!legacySettings.get('auto_limit') && legacySettings.get('time_limit')) {
        db.setSetting('autoLimitMinutes', legacySettings.get('time_limit') as string)
      }
      counts.settings = settingsCount

      // ---------------- url_history ----------------
      if (tableExists(legacy, 'url_history')) {
        const rows = legacy
          .prepare('SELECT url_type, url, note, used_at FROM url_history')
          .all() as V1Row[]
        for (const row of rows) {
          const urlType = String(row.url_type ?? '')
          const url = String(row.url ?? '')
          if (!urlType || !url) continue
          db.raw()
            .prepare(
              'INSERT OR REPLACE INTO url_history (url_type, url, note, used_at) ' +
                'VALUES (?, ?, ?, ?)'
            )
            .run(urlType, url, String(row.note ?? ''), String(row.used_at ?? 'CURRENT_TIMESTAMP'))
        }
        counts.url_history = rows.length
      }

      // ---------------- daily_progress ----------------
      if (tableExists(legacy, 'daily_progress')) {
        const rows = legacy.prepare('SELECT date, watched_seconds FROM daily_progress').all() as V1Row[]
        for (const row of rows) {
          db.raw()
            .prepare('INSERT OR REPLACE INTO daily_progress (date, watched_seconds) VALUES (?, ?)')
            .run(String(row.date ?? ''), Number(row.watched_seconds ?? 0))
        }
        counts.daily_progress = rows.length
      }

      // ---------------- course_progress ----------------
      if (tableExists(legacy, 'course_progress')) {
        const rows = legacy
          .prepare('SELECT course_note, last_video_title, updated_at FROM course_progress')
          .all() as V1Row[]
        for (const row of rows) {
          db.raw()
            .prepare(
              'INSERT OR REPLACE INTO course_progress (course_note, last_video_title, updated_at) ' +
                'VALUES (?, ?, ?)'
            )
            .run(
              String(row.course_note ?? ''),
              String(row.last_video_title ?? ''),
              String(row.updated_at ?? '')
            )
        }
        counts.course_progress = rows.length
      }
    })

    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    logger.info(`已从 v1 数据库导入 ${total} 行: ${JSON.stringify(counts)}`)

    return {
      imported: true,
      schemaVersion: db.userVersion,
      importedRows: counts,
      sourcePath: legacyPath,
      message: `已从旧版本导入 ${total} 行数据`
    }
  } finally {
    legacy.close()
  }
}

export interface ImportOptions {
  /**
   * 显式指定 v1 数据库路径。
   * 省略（undefined）= 按平台自动探测；传 null = 强制视为不存在（测试用）。
   */
  legacyPath?: string | null
}

/**
 * 决定是否需要导入，需要时执行。
 * 任何异常都不应阻止应用启动 —— 导入失败就当作全新安装。
 */
export function maybeImportLegacy(db: Database, options: ImportOptions = {}): MigrationReport {
  const base: MigrationReport = {
    imported: false,
    schemaVersion: db.userVersion,
    importedRows: {},
    sourcePath: null,
    message: '全新安装，无需导入'
  }

  let legacyPath: string | null
  if (options.legacyPath !== undefined) {
    legacyPath = options.legacyPath
  } else {
    try {
      legacyPath = findLegacyDatabase()
    } catch (error) {
      logger.exception('查找 v1 数据库失败', error)
      return base
    }
  }

  if (!legacyPath) return base

  if (!db.isEmpty()) {
    return {
      ...base,
      sourcePath: legacyPath,
      message: 'v2 数据库中已有数据，跳过导入'
    }
  }

  try {
    return importLegacyDatabase(db, legacyPath)
  } catch (error) {
    logger.exception('导入 v1 数据失败，按全新安装继续', error)
    return {
      ...base,
      sourcePath: legacyPath,
      message: '旧数据导入失败，已按全新安装启动'
    }
  }
}
