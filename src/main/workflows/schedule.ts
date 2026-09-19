import type { WorkflowSchedule } from '@shared/workflows'

function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const value = (type: string): string => parts.find(p => p.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
/** Resolve a wall-clock minute. DST gaps use the first later minute; overlaps fire once. */
function dayInstant(day: string, time: string, timeZone: string): number {
  const center = Date.parse(`${day}T${time}:00Z`)
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  let later = Infinity
  for (let at = center - 15 * 3600000; at <= center + 15 * 3600000; at += 60000) {
    const parts = format.formatToParts(at)
    const v = (t: string): string => parts.find(p => p.type === t)!.value
    const date = `${v('year')}-${v('month')}-${v('day')}`, clock = `${v('hour')}:${v('minute')}`
    if (date !== day) continue
    if (clock === time) return at
    if (clock > time) later = Math.min(later, at)
  }
  if (!Number.isFinite(later)) throw new Error('无法计算定时时间')
  return later
}
function shift(day: string, days: number): string { return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10) }
export function dailyOccurrence(schedule: WorkflowSchedule, now: number, next: boolean): string {
  const day = localDate(new Date(now), schedule.timeZone)
  let at = dayInstant(day, schedule.time, schedule.timeZone)
  if (next ? at <= now : at > now) at = dayInstant(shift(day, next ? 1 : -1), schedule.time, schedule.timeZone)
  return new Date(at).toISOString()
}
export function prepareSchedule(input: WorkflowSchedule | null, now = Date.now()): WorkflowSchedule | null {
  if (!input) return null
  new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format(now)
  if (input.kind !== 'once' && input.kind !== 'daily') throw new Error('不支持的定时类型')
  if (input.kind === 'daily' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('请输入 HH:mm 时间')
  if (input.kind === 'once' && !Number.isFinite(Date.parse(input.time))) throw new Error('请输入有效的日期时间')
  if (input.kind === 'once' && input.enabled && Date.parse(input.time) <= now) throw new Error('单次定时必须晚于当前时间')
  return { ...input, nextAt: input.enabled ? input.kind === 'once' ? new Date(input.time).toISOString() : dailyOccurrence(input, now, true) : null }
}
