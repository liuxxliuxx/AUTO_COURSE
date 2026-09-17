import type { AppSettings, Course, CourseRunOptions } from './types'
import { parseMapCourseUrl, MAP_COURSE_ORIGIN } from './map-url'

export const DEFAULT_COURSE_OPTIONS: CourseRunOptions = {
  action: 'learn', startPosition: 'beginning', skipCompleted: true, timeLimitMinutes: 0
}
export const ACTION_LABELS = { learn: '学习', 'learn-transcribe': '学习并转录', transcribe: '仅转录' } as const
export const KIND_LABELS = { classic: '传统课', map: '图谱课', unknown: '待确认类型' } as const

export function identifyCourse(raw: string): { kind: 'classic' | 'map'; identity: string; url: string } {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('请输入完整的课程学习页地址（https://…）') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('课程地址必须使用 HTTP 或 HTTPS')
  if (url.username || url.password) throw new Error('课程地址不能包含账号密码')
  if (url.hostname === 'studyvideoh5.zhihuishu.com' && url.pathname === '/stuStudy') {
    const id = url.searchParams.get('recruitAndCourseId')
    if (!id) throw new Error('传统课地址缺少 recruitAndCourseId，请复制课程学习页地址')
    return { kind: 'classic', identity: `classic:${id}`, url: url.toString() }
  }
  if (url.origin === MAP_COURSE_ORIGIN) {
    const ref = parseMapCourseUrl(url.toString())
    if (!ref.mapId) throw new Error('请进入图谱知识项后复制链接；课程入口地址缺少图谱 ID')
    return { kind: 'map', identity: `map:${ref.courseId}:${ref.mapId}:${ref.mapUid}`, url: url.toString() }
  }
  throw new Error('无法识别课程。请使用智慧树传统课 stuStudy 或图谱课 knowledgeStudy / learnPage 学习页链接')
}
export function validateRunOptions(options: CourseRunOptions, kind?: Course['kind']): void {
  if (!options || !['learn', 'learn-transcribe', 'transcribe'].includes(options.action)) throw new Error('请选择有效的运行方式')
  if (!['beginning', 'resume'].includes(options.startPosition)) throw new Error('请选择有效的起始位置')
  if (typeof options.skipCompleted !== 'boolean') throw new Error('跳过已完成设置无效')
  if (!Number.isFinite(options.timeLimitMinutes) || options.timeLimitMinutes < 0 || !Number.isInteger(options.timeLimitMinutes)) throw new Error('时长必须为非负整数分钟')
  if (kind === 'map' && options.action === 'transcribe') throw new Error('图谱课暂不支持仅转录，请选择学习或学习并转录')
}
export function optionsFromLegacy(s: AppSettings): CourseRunOptions {
  return { action: !s.brushEnabled && !s.mapMode ? 'transcribe' : s.transcribeEnabled ? 'learn-transcribe' : 'learn',
    startPosition: s.fromLastProgress ? 'resume' : 'beginning', skipCompleted: s.skipCompleted,
    timeLimitMinutes: Math.max(0, Math.floor(s.timeLimitMinutes)) }
}
/** Sole compatibility boundary for existing runners. No runtime writes back to global settings. */
export function settingsForCourse(s: AppSettings, course: Course): AppSettings {
  return { ...s, videoUrl: course.url, courseNote: course.name, mapMode: course.kind === 'map',
    brushEnabled: course.options.action !== 'transcribe', transcribeEnabled: course.options.action !== 'learn',
    fromLastProgress: course.options.startPosition === 'resume', skipCompleted: course.options.skipCompleted,
    timeLimitMinutes: course.options.timeLimitMinutes }
}
