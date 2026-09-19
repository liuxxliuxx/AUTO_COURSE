/** 设置服务：默认值、类型往返、启动校验。 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../../src/main/storage/database'
import { DEFAULT_SETTINGS, SettingsService } from '../../src/main/services/settings-service'

let dir: string
let db: Database
let settings: SettingsService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ac-settings-'))
  db = new Database(join(dir, 'test.db'))
  settings = new SettingsService(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('SettingsService', () => {
  it('空库返回 v1 一致的默认值', () => {
    expect(settings.getAll()).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.autoStartTime).toBe('06:00')
    expect(DEFAULT_SETTINGS.autoEndTime).toBe('23:00')
    expect(DEFAULT_SETTINGS.skipCompleted).toBe(true)
    expect(DEFAULT_SETTINGS.brushEnabled).toBe(true)
    expect(DEFAULT_SETTINGS.mapMode).toBe(false)
  })

  it('布尔按 1/0 往返', () => {
    settings.update({ skipCompleted: false, mapMode: true })
    expect(db.getSetting('skipCompleted')).toBe('0')
    expect(db.getSetting('mapMode')).toBe('1')
    const read = settings.getAll()
    expect(read.skipCompleted).toBe(false)
    expect(read.mapMode).toBe(true)
  })

  it('数字往返且非法值退回默认', () => {
    settings.update({ timeLimitMinutes: 90 })
    expect(db.getSetting('timeLimitMinutes')).toBe('90')
    expect(settings.getAll().timeLimitMinutes).toBe(90)

    db.setSetting('timeLimitMinutes', 'abc')
    expect(settings.getAll().timeLimitMinutes).toBe(0)
  })

  it('loginMethod 支持新旧数字石大流程，其余回落 zhihuishu', () => {
    settings.update({ loginMethod: 'upc' })
    expect(settings.getAll().loginMethod).toBe('upc')

    settings.update({ loginMethod: 'upc-institution' })
    expect(settings.getAll().loginMethod).toBe('upc-institution')

    db.setSetting('loginMethod', '数字石大')
    expect(settings.getAll().loginMethod).toBe('zhihuishu')
  })

  it('未知键被忽略且不写库', () => {
    settings.update({ notARealKey: 'x' } as never)
    expect(db.allSettings()).not.toHaveProperty('notARealKey')
  })

  // ---------------------------------------------------------------- 校验

  it('校验：课程为空时报错', () => {
    const errors = settings.validate()
    expect(errors.map((e) => e.field)).toContain('videoUrl')
  })

  it('校验：图谱模式必须配图谱课地址', () => {
    settings.update({ videoUrl: 'https://example.com/course', mapMode: true })
    const errors = settings.validate()
    expect(errors.some((e) => e.field === 'mapMode')).toBe(true)
  })

  it('校验：只有数字石大旧门户登录必须有登录跳转 URL', () => {
    settings.update({ videoUrl: 'https://x/y', loginMethod: 'upc' })
    expect(settings.validate().some((e) => e.field === 'loggedUrl')).toBe(true)

    settings.update({ loginMethod: 'upc-institution' })
    expect(settings.validate().some((e) => e.field === 'loggedUrl')).toBe(false)
  })

  it('校验：仅转录模式必须有保存路径', () => {
    settings.update({ videoUrl: 'https://x/y', brushEnabled: false, mapMode: false })
    expect(settings.validate().some((e) => e.field === 'transcribeBaseDir')).toBe(true)
  })

  it('校验：刷课/转录/图谱全关时报错（与 v1 同一条规则）', () => {
    settings.update({ videoUrl: 'https://x/y', brushEnabled: false, mapMode: false })
    expect(settings.validate().some((e) => e.field === 'brushEnabled')).toBe(true)
  })

  // ------------------------------------------------------------ 模式推导

  it('deriveTaskMode：图谱优先，其次仅转录，最后传统刷课', () => {
    expect(settings.deriveTaskMode()).toBe('classic')

    settings.update({ brushEnabled: false })
    expect(settings.deriveTaskMode()).toBe('transcribe-only')

    settings.update({ mapMode: true })
    expect(settings.deriveTaskMode()).toBe('map')
  })
})


describe('强调色设置', () => {
  it('旧数据库默认蓝色，损坏值回退蓝色', () => {
    expect(settings.getAll().accentColor).toBe('blue')
    db.setSetting('accentColor', 'unknown')
    expect(settings.getAll().accentColor).toBe('blue')
  })
  it('保存有效预设并拒绝无效值，拒绝时不部分写入', () => {
    settings.update({ accentColor: 'rose' })
    expect(settings.getAll().accentColor).toBe('rose')
    expect(() => settings.update({ uiScale: 1.2, accentColor: 'unknown' } as never)).toThrow('请选择有效的强调色')
    expect(settings.getAll().accentColor).toBe('rose')
    expect(settings.getAll().uiScale).toBe(1)
  })
})
