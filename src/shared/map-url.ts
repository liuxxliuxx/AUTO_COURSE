/**
 * 图谱课 URL 解析。
 *
 * handoff §28「Map URL Parsing」：v1 只用两条 `re.search`，遇到别的 URL 形态
 * 就抛一句「无法从 URL 解析课程ID」。这里改成基于 `new URL()` 的结构化解析：
 * 先按 host + path 形状分类，再逐段取参，未知形态给出**可操作**的报错。
 *
 * 已确认的形态（来自 v1 map_course.py 与真实使用记录）：
 *   1. /singleCourse/knowledgeStudy/{courseId}/{mapId}?mapUid=xxx
 *   2. /learnPage/{courseId}/{knowledgeId}/{mapId}?mapUid=xxx
 *   3. /abilityAgent/{courseId}?recruitId=xxx      （入口页，不含 mapId）
 */

/** 图谱课站点 */
export const MAP_COURSE_ORIGIN = 'https://ai-smart-course-student-pro.zhihuishu.com'

export type MapUrlShape = 'knowledgeStudy' | 'learnPage' | 'abilityAgent'

export interface MapCourseRef {
  shape: MapUrlShape
  origin: string
  courseId: string
  /** abilityAgent 形态下为空 */
  mapId: string
  mapUid: string
  /** 仅 learnPage 形态有 */
  knowledgeId?: string
}

export class MapUrlError extends Error {
  constructor(
    message: string,
    readonly raw: string
  ) {
    super(message)
    this.name = 'MapUrlError'
  }
}

/** 数字 ID 段 */
const isNumeric = (segment: string | undefined): boolean => !!segment && /^\d+$/.test(segment)

/**
 * 解析图谱课 URL。
 * 无法识别时抛 `MapUrlError`，消息里带上正确的 URL 形态示例。
 */
export function parseMapCourseUrl(raw: string): MapCourseRef {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) {
    throw new MapUrlError('图谱课地址为空', raw)
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new MapUrlError(`不是合法的 URL: ${trimmed}`, raw)
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const mapUid = url.searchParams.get('mapUid') ?? ''

  const shape = detectShape(segments)
  switch (shape) {
    case 'knowledgeStudy': {
      // 路径是 /singleCourse/knowledgeStudy/{courseId}/{mapId}
      const [, , courseId, mapId] = segments
      return { shape, origin: url.origin, courseId, mapId, mapUid }
    }
    case 'learnPage': {
      const [, courseId, knowledgeId, mapId] = segments
      return { shape, origin: url.origin, courseId, mapId, mapUid, knowledgeId }
    }
    case 'abilityAgent': {
      const [, courseId] = segments
      return { shape, origin: url.origin, courseId, mapId: '', mapUid }
    }
    default:
      throw new MapUrlError(
        '无法识别图谱课地址。支持的形式：\n' +
          '  · .../singleCourse/knowledgeStudy/{课程ID}/{图谱ID}?mapUid=xxx\n' +
          '  · .../learnPage/{课程ID}/{知识项ID}/{图谱ID}?mapUid=xxx\n' +
          `  实际收到: ${trimmed}`,
        raw
      )
  }
}

function detectShape(segments: string[]): MapUrlShape | null {
  // /singleCourse/knowledgeStudy/{courseId}/{mapId}
  if (
    segments[0] === 'singleCourse' &&
    segments[1] === 'knowledgeStudy' &&
    isNumeric(segments[2]) &&
    isNumeric(segments[3])
  ) {
    return 'knowledgeStudy'
  }
  if (segments[0] === 'learnPage' && isNumeric(segments[1]) && isNumeric(segments[2]) && isNumeric(segments[3])) {
    return 'learnPage'
  }
  if (segments[0] === 'abilityAgent' && isNumeric(segments[1])) {
    return 'abilityAgent'
  }
  return null
}

/** 图谱页 URL（列出所有知识项）。 */
export function knowledgeStudyUrl(ref: Pick<MapCourseRef, 'origin' | 'courseId' | 'mapId' | 'mapUid'>): string {
  const base = `${ref.origin}/singleCourse/knowledgeStudy/${ref.courseId}/${ref.mapId}`
  return ref.mapUid ? `${base}?mapUid=${encodeURIComponent(ref.mapUid)}` : base
}

/** 单个知识项的学习页 URL。 */
export function learnPageUrl(
  ref: Pick<MapCourseRef, 'origin' | 'courseId' | 'mapId' | 'mapUid'>,
  knowledgeId: string
): string {
  const base = `${ref.origin}/learnPage/${ref.courseId}/${knowledgeId}/${ref.mapId}`
  return ref.mapUid ? `${base}?mapUid=${encodeURIComponent(ref.mapUid)}` : base
}
