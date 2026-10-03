import type { Course } from '@shared/types'
import { identifyCourse } from '@shared/courses'

export function unavailableCourse(course?: Course): string {
  if (!course) return '课程已移除'
  try {
    identifyCourse(course.url)
    return course.kind === 'unknown' ? '课程类型不可识别' : ''
  } catch { return '课程地址不可识别' }
}
