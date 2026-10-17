import type { CourseRunOptions } from '@shared/types'

export const UNSAVED_CONFIRM = '有未保存的修改，确定放弃吗？'
export const START_LABELS = { beginning: '课程开头', resume: '上次位置' } as const
export const COMPLETED_LABELS = { skip: '跳过已完成', all: '处理全部' } as const
export const durationLabel = (minutes: number): string => minutes ? `${minutes} 分钟` : '不限时长'
export const completedLabel = (skip: boolean): string => COMPLETED_LABELS[skip ? 'skip' : 'all']
export const courseSummary = (options: CourseRunOptions): string => `${START_LABELS[options.startPosition]} · ${durationLabel(options.timeLimitMinutes)} · ${completedLabel(options.skipCompleted)}`

/** Strip transport wrappers only. Never rewrite names or arbitrary message contents. */
export function errorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error)
  let previous: string
  do {
    previous = message
    message = message.trim().replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
  } while (message !== previous)
  return message || '未知错误'
}
export function errorText(operation: string, error: unknown): string {
  let message = errorMessage(error)
  const prefix = `${operation}失败：`
  while (message.startsWith(prefix)) message = errorMessage(message.slice(prefix.length))
  return prefix + message
}
