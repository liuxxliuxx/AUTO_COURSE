import { describe, expect, it } from 'vitest'
import { currentCourseTerm, courseTermLabels } from '../../src/shared/course-discovery'
import { courseCardKind } from '../../src/main/automation/course-discovery'

describe('课程发现规则', () => {
  it.each([
    ['2026-10-18T00:00:00Z', '2026-2027学年第一学期'],
    ['2027-01-10T00:00:00Z', '2026-2027学年第一学期'],
    ['2026-02-16T15:59:59Z', '2025-2026学年第一学期'],
    ['2026-02-16T16:00:00Z', '2025-2026学年第二学期'],
    ['2027-02-05T15:59:59Z', '2026-2027学年第一学期'],
    ['2027-02-05T16:00:00Z', '2026-2027学年第二学期'],
    ['2025-01-28T16:00:00Z', '2024-2025学年第二学期'],
    ['2026-08-31T15:59:59Z', '2025-2026学年第二学期'],
    ['2026-08-31T16:00:00Z', '2026-2027学年第一学期'],
    ['2026-08-01T00:00:00Z', '2025-2026学年第二学期']
  ])('北京时间 %s 自动推断为 %s', (date, expected) => {
    expect(currentCourseTerm(new Date(date))).toBe(expected)
  })
  it('匹配主页两种学期命名，不退回其他年份或全部学期', () => {
    expect(courseTermLabels('2026-2027学年第一学期')).toContain('2026年秋冬学期')
    expect(courseTermLabels('2026-2027学年第二学期')).toContain('2027年春夏学期')
    expect(courseTermLabels('2026-2027学年第一学期')).not.toContain('2027年秋冬学期')
    expect(courseTermLabels('2026-2027学年第一学期')).not.toContain('全部学期')
  })
  it('只接受共享课与图谱标签，名称含图谱不改变课程类型', () => {
    expect(courseCardKind(' 共享课 ')).toBe('classic')
    expect(courseCardKind('图谱')).toBe('map')
    expect(courseCardKind('AI智课')).toBeNull()
    expect(courseCardKind('知识图谱导论')).toBeNull()
  })
})
