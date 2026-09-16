/**
 * 设置服务 —— 在 SQLite 的 string K/V 之上提供类型化的 AppSettings。
 *
 * 默认值与 v1 `gui/bridge.py::_default_setting` 保持一致，
 * 保证迁移后用户看到的行为不变（handoff §32 第 2 条）。
 */

import type { AppSettings, SettingsPatch, ValidationError } from '@shared/types'
import type { Database } from '../storage/database'
import { createLogger } from './logger'

const logger = createLogger('settings')

export const DEFAULT_SETTINGS: AppSettings = {
  loginMethod: 'zhihuishu',
  videoUrl: '',
  courseNote: '',
  loggedUrl: '',
  brushEnabled: true,
  mapMode: false,
  skipCompleted: true,
  fromLastProgress: false,
  timeLimitMinutes: 0,
  transcribeEnabled: false,
  transcribeBaseDir: '',
  autoMode: false,
  autoStartTime: '06:00',
  autoEndTime: '23:00',
  autoAllDay: false,
  autoLimitMinutes: 0,
  uiScale: 1
}

/** 键 → 解析方式。读库时要按这个表把字符串转回正确类型。 */
type Kind = 'string' | 'boolean' | 'number' | 'loginMethod'

const KINDS: Record<keyof AppSettings, Kind> = {
  loginMethod: 'loginMethod',
  videoUrl: 'string',
  courseNote: 'string',
  loggedUrl: 'string',
  brushEnabled: 'boolean',
  mapMode: 'boolean',
  skipCompleted: 'boolean',
  fromLastProgress: 'boolean',
  timeLimitMinutes: 'number',
  transcribeEnabled: 'boolean',
  transcribeBaseDir: 'string',
  autoMode: 'boolean',
  autoStartTime: 'string',
  autoEndTime: 'string',
  autoAllDay: 'boolean',
  autoLimitMinutes: 'number',
  uiScale: 'number'
}

function parse(kind: Kind, raw: string | undefined, fallback: unknown): unknown {
  if (raw === undefined) return fallback
  switch (kind) {
    case 'boolean':
      return raw === '1' || raw === 'true'
    case 'number': {
      // 不能只用 parseInt：uiScale 这类设置是小数（0.9 / 1.15 / 1.3），
      // parseInt 会把 1.15 截成 1。空串按"没有设置"处理，退回默认值。
      const trimmed = raw.trim()
      if (!trimmed) return fallback
      const n = Number(trimmed)
      return Number.isFinite(n) ? n : fallback
    }
    case 'loginMethod':
      return raw === 'upc' || raw === 'upc-institution' ? raw : 'zhihuishu'
    default:
      return raw
  }
}

function serialize(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  return String(value ?? '')
}

export class SettingsService {
  constructor(private readonly db: Database) {}

  getAll(): AppSettings {
    const stored = this.db.allSettings()
    const result = {} as AppSettings
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(result as any)[key] = parse(KINDS[key], stored[key], DEFAULT_SETTINGS[key])
    }
    return result
  }

  update(patch: SettingsPatch): AppSettings {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS)) {
        logger.warn(`忽略未知设置项: ${key}`)
        continue
      }
      if (value === undefined) continue
      this.db.setSetting(key, serialize(value))
    }
    return this.getAll()
  }

  /** 启动前的校验，规则与 v1 `bridge._validate_start` 等价。 */
  validate(): ValidationError[] {
    const s = this.getAll()
    const errors: ValidationError[] = []

    if (!s.brushEnabled && !s.transcribeEnabled && !s.mapMode) {
      errors.push({ field: 'brushEnabled', message: '请至少开启刷课或语音转文字' })
    }
    if (!s.videoUrl.trim()) {
      errors.push({ field: 'videoUrl', message: '课程地址不能为空' })
    }
    if (s.mapMode && !s.videoUrl.includes('ai-smart-course-student-pro')) {
      errors.push({
        field: 'mapMode',
        message: '图谱刷课需要填写图谱课地址（ai-smart-course-student-pro.zhihuishu.com）'
      })
    }
    if (s.loginMethod === 'upc' && !s.loggedUrl.trim()) {
      errors.push({ field: 'loggedUrl', message: '数字石大旧门户登录需要填写登录跳转 URL' })
    }
    const transcribeOnly = !s.brushEnabled && !s.mapMode
    if (transcribeOnly && !s.transcribeBaseDir.trim()) {
      errors.push({ field: 'transcribeBaseDir', message: '仅转录模式需要先设置保存路径' })
    }
    if (s.transcribeEnabled && !s.transcribeBaseDir.trim()) {
      errors.push({ field: 'transcribeBaseDir', message: '启用语音转文字需要设置保存路径' })
    }

    return errors
  }

  /** 提示词用的「当前任务模式」推导（与 v1 bridge.py:274 一致） */
  deriveTaskMode(): 'classic' | 'map' | 'transcribe-only' {
    const s = this.getAll()
    if (s.mapMode) return 'map'
    if (!s.brushEnabled) return 'transcribe-only'
    return 'classic'
  }
}
