/**
 * 调度器时间段判定。
 *
 * 这是 v1 `gui/bridge.py::_time_in_range` 的等价实现，
 * 跨午夜是 v1 就支持的行为，必须保持。
 */

import { describe, expect, it } from 'vitest'
import { isTimeInRange } from '../../src/main/services/scheduler-service'

const at = (h: number, m = 0): Date => new Date(2026, 8, 15, h, m, 0)

describe('isTimeInRange', () => {
  it('普通时间段：区间内为 true', () => {
    expect(isTimeInRange(at(6), '06:00', '23:00')).toBe(true)
    expect(isTimeInRange(at(12, 30), '06:00', '23:00')).toBe(true)
    expect(isTimeInRange(at(23), '06:00', '23:00')).toBe(true)
  })

  it('普通时间段：区间外为 false', () => {
    expect(isTimeInRange(at(5, 59), '06:00', '23:00')).toBe(false)
    expect(isTimeInRange(at(23, 1), '06:00', '23:00')).toBe(false)
    expect(isTimeInRange(at(0), '06:00', '23:00')).toBe(false)
  })

  it('跨午夜：start > end 时两侧都算区间内', () => {
    expect(isTimeInRange(at(22), '22:00', '06:00')).toBe(true)
    expect(isTimeInRange(at(23, 59), '22:00', '06:00')).toBe(true)
    expect(isTimeInRange(at(0), '22:00', '06:00')).toBe(true)
    expect(isTimeInRange(at(5, 59), '22:00', '06:00')).toBe(true)
    expect(isTimeInRange(at(6), '22:00', '06:00')).toBe(true)
  })

  it('跨午夜：中间时段为 false', () => {
    expect(isTimeInRange(at(12), '22:00', '06:00')).toBe(false)
    expect(isTimeInRange(at(21, 59), '22:00', '06:00')).toBe(false)
    expect(isTimeInRange(at(6, 1), '22:00', '06:00')).toBe(false)
  })

  it('起止相同视为只在那一分钟', () => {
    expect(isTimeInRange(at(9), '09:00', '09:00')).toBe(true)
    expect(isTimeInRange(at(9, 1), '09:00', '09:00')).toBe(false)
  })

  it('格式非法时放行（与 v1 一致：宁可不拦）', () => {
    expect(isTimeInRange(at(3), '', '23:00')).toBe(true)
    expect(isTimeInRange(at(3), 'abc', '23:00')).toBe(true)
    expect(isTimeInRange(at(3), '25:00', '23:00')).toBe(true)
    expect(isTimeInRange(at(3), '06:60', '23:00')).toBe(true)
  })
})
