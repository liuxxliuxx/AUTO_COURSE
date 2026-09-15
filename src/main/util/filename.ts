/**
 * 文件名净化。逐字移植 v1 `src/transcriber/transcription_manager.py::sanitize_filename`，
 * 保证转录输出目录与 v1 完全一致（用户已有的「课程录音」目录不会重复建一份）。
 */

/** 课程备注为空时的默认课程名（v1 constants.TRANSCRIPTION_DEFAULT_COURSE_NAME） */
export const DEFAULT_COURSE_NAME = '未命名课程'

export function sanitizeFilename(name: string, maxLength = 100): string {
  if (!name) return DEFAULT_COURSE_NAME

  let result = name.replace(/[<>:"/\\|?*]/g, '_')
  // 连续的下划线/空格折叠成一个下划线
  result = result.replace(/[_ ]{2,}/g, '_')
  result = result.replace(/^[. ]+|[. ]+$/g, '')

  if (result.length > maxLength) result = result.slice(0, maxLength)
  return result || DEFAULT_COURSE_NAME
}

/**
 * course_progress 的兼容查找键。
 *
 * v1 写入时用 sanitize 过的课程名、读取时用原始名（docs/V1_BASELINE.md §7.2）。
 * v2 统一用原始名，但为了能命中从 v1 导入的行，读取时再试一次净化后的名字。
 */
export function sanitizeCourseNote(note: string): string {
  return sanitizeFilename(note)
}
