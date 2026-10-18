import type { CourseLibrary } from './types'
import { Solar } from 'lunar-typescript'

export interface DiscoveredCourse { name: string; url: string; kind: 'classic' | 'map' }
export interface CourseDiscoveryStatus {
  phase: 'idle' | 'running' | 'waiting' | 'stopping' | 'done' | 'failed' | 'cancelled'
  accountId: string | null
  message: string
  term: string
  scanned: number
  added: number
  existing: number
  completed: number
  unsupported: number
  warnings: string[]
}
export interface CourseDiscoveryResult { status: CourseDiscoveryStatus; library: CourseLibrary }
export const emptyDiscoveryStatus = (): CourseDiscoveryStatus => ({
  phase: 'idle', accountId: null, message: '', term: '', scanned: 0, added: 0,
  existing: 0, completed: 0, unsupported: 0, warnings: []
})

/** 北京时间：9 月 1 日起为第一学期，春节（正月初一）当天起为第二学期。 */
export function currentCourseTerm(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now)
  const year = Number(parts.find(p => p.type === 'year')!.value)
  const month = Number(parts.find(p => p.type === 'month')!.value)
  const day = Number(parts.find(p => p.type === 'day')!.value)
  // 使用公历日期转农历年，不以立春划分，也不依赖操作系统的农历 Intl 数据。
  const beforeNewYear = Solar.fromYmd(year, month, day).getLunar().getYear() < year
  const start = month >= 9 ? year : year - 1
  return `${start}-${start + 1}学年${month >= 9 || beforeNewYear ? '第一' : '第二'}学期`
}

/** 将学年学期映射为主页实际使用的名称；不把历史学期或“全部学期”作为兜底。 */
export function courseTermLabels(term: string): string[] {
  const match = /^(\d{4})-(\d{4})学年第([一二])学期$/.exec(term)
  if (!match) return [term]
  const [, start, end, semester] = match
  const number = semester === '一' ? 1 : 2
  return [term, `${start}-${end}第${semester}学期`, `${start}-${end}学年第${number}学期`,
    `${semester === '一' ? start : end}年${semester === '一' ? '秋冬' : '春夏'}学期`]
}
