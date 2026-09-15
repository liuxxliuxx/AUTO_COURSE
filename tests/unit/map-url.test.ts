/**
 * 图谱课 URL 解析（handoff §28「Map URL Parsing」要求有明确测试用例）。
 */

import { describe, expect, it } from 'vitest'
import {
  MapUrlError,
  knowledgeStudyUrl,
  learnPageUrl,
  parseMapCourseUrl
} from '../../src/main/automation/map/url'

const ORIGIN = 'https://ai-smart-course-student-pro.zhihuishu.com'

describe('parseMapCourseUrl', () => {
  it('解析 knowledgeStudy 形态', () => {
    const ref = parseMapCourseUrl(
      `${ORIGIN}/singleCourse/knowledgeStudy/1000006/778899?mapUid=abc-123`
    )
    expect(ref).toMatchObject({
      shape: 'knowledgeStudy',
      origin: ORIGIN,
      courseId: '1000006',
      mapId: '778899',
      mapUid: 'abc-123'
    })
  })

  it('解析 learnPage 形态（多一段 knowledgeId）', () => {
    const ref = parseMapCourseUrl(`${ORIGIN}/learnPage/1000006/55001/778899?mapUid=abc`)
    expect(ref).toMatchObject({
      shape: 'learnPage',
      courseId: '1000006',
      knowledgeId: '55001',
      mapId: '778899',
      mapUid: 'abc'
    })
  })

  it('解析 abilityAgent 形态（入口页，没有 mapId）', () => {
    const ref = parseMapCourseUrl(`${ORIGIN}/abilityAgent/1000006140?recruitId=473303`)
    expect(ref).toMatchObject({
      shape: 'abilityAgent',
      courseId: '1000006140',
      mapId: '',
      mapUid: ''
    })
  })

  it('缺少 mapUid 时仍可解析', () => {
    const ref = parseMapCourseUrl(`${ORIGIN}/singleCourse/knowledgeStudy/1/2`)
    expect(ref.mapUid).toBe('')
  })

  it('忽略多余查询参数', () => {
    const ref = parseMapCourseUrl(
      `${ORIGIN}/singleCourse/knowledgeStudy/1/2?recruitId=9&mapUid=u1&from=share`
    )
    expect(ref.mapUid).toBe('u1')
    expect(ref.mapId).toBe('2')
  })

  it('容忍结尾斜杠', () => {
    const ref = parseMapCourseUrl(`${ORIGIN}/singleCourse/knowledgeStudy/1/2/`)
    expect(ref.mapId).toBe('2')
  })

  it('非数字 ID 视为无法识别', () => {
    expect(() => parseMapCourseUrl(`${ORIGIN}/singleCourse/knowledgeStudy/abc/2`)).toThrow(MapUrlError)
  })

  it('未知形态抛出可操作的错误', () => {
    try {
      parseMapCourseUrl('https://example.com/whatever/1')
      throw new Error('应当抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(MapUrlError)
      const message = (error as MapUrlError).message
      expect(message).toContain('无法识别图谱课地址')
      expect(message).toContain('knowledgeStudy') // 提示了正确写法
    }
  })

  it('空串与非法 URL 抛出 MapUrlError', () => {
    expect(() => parseMapCourseUrl('')).toThrow(MapUrlError)
    expect(() => parseMapCourseUrl('not a url')).toThrow(MapUrlError)
  })

  it('保留原始 URL 便于报错定位', () => {
    const raw = 'https://example.com/x'
    try {
      parseMapCourseUrl(raw)
    } catch (error) {
      expect((error as MapUrlError).raw).toBe(raw)
    }
  })
})

describe('URL 构造', () => {
  it('knowledgeStudyUrl 还原', () => {
    const ref = { origin: ORIGIN, courseId: '1', mapId: '2', mapUid: 'u' }
    expect(knowledgeStudyUrl(ref)).toBe(`${ORIGIN}/singleCourse/knowledgeStudy/1/2?mapUid=u`)
  })

  it('knowledgeStudyUrl 无 mapUid 时不带问号', () => {
    expect(knowledgeStudyUrl({ origin: ORIGIN, courseId: '1', mapId: '2', mapUid: '' })).toBe(
      `${ORIGIN}/singleCourse/knowledgeStudy/1/2`
    )
  })

  it('learnPageUrl 带上 knowledgeId', () => {
    const ref = { origin: ORIGIN, courseId: '1', mapId: '2', mapUid: 'u' }
    expect(learnPageUrl(ref, '99')).toBe(`${ORIGIN}/learnPage/1/99/2?mapUid=u`)
  })

  it('构造出来的 URL 能被解析回去（往返一致）', () => {
    const built = knowledgeStudyUrl({ origin: ORIGIN, courseId: '1000006', mapId: '778899', mapUid: 'a b' })
    const parsed = parseMapCourseUrl(built)
    expect(parsed.courseId).toBe('1000006')
    expect(parsed.mapId).toBe('778899')
    expect(parsed.mapUid).toBe('a b')
  })
})
