import { describe, expect, it } from 'vitest'
import { parseMasteryRateText } from '../../src/main/automation/mastery/dom'

describe('掌握度 DOM 文本解析', () => {
  it('解析百分比并限制范围', () => {
    expect(parseMasteryRateText('掌握度：80%')).toBe(80)
    expect(parseMasteryRateText('掌握度：120%')).toBe(100)
    expect(parseMasteryRateText('掌握度：-1%')).toBe(1)
  })
  it('没有百分比时返回 null', () => { expect(parseMasteryRateText('掌握度：未知')).toBeNull() })
})
