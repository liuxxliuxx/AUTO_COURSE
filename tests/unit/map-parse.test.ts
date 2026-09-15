/**
 * 图谱课解析纯函数。
 *
 * 这些判据直接来自 v1 `src/bot/map_course.py` 的实测结论，
 * 是图谱刷课最容易出错的地方（class 全都一样，只能看文本特征）。
 */

import { describe, expect, it } from 'vitest'
import {
  classifyResource,
  extractKnowledgeId,
  extractKnowledgeTitle,
  extractProgress,
  hasDurationText,
  isMustLearnSection
} from '../../src/main/automation/map/navigator'

describe('extractKnowledgeId', () => {
  it('从 id 里取出数字', () => {
    expect(extractKnowledgeId('knowledgeId-1001')).toBe('1001')
    expect(extractKnowledgeId('knowledgeId-1000006140')).toBe('1000006140')
  })

  it('带前后缀也能取到', () => {
    expect(extractKnowledgeId('foo-knowledgeId-42-bar')).toBe('42')
  })

  it('不匹配时返回空串', () => {
    expect(extractKnowledgeId('')).toBe('')
    expect(extractKnowledgeId('knowledgeId-abc')).toBe('')
    expect(extractKnowledgeId('other-123')).toBe('')
  })
})

describe('extractProgress', () => {
  it('取出百分比', () => {
    expect(extractProgress('学习进度 100 %')).toBe(100)
    expect(extractProgress('学习进度 40%')).toBe(40)
    expect(extractProgress('学习进度 0 %')).toBe(0)
  })

  it('没有百分比时返回 0', () => {
    expect(extractProgress('艺术的定义')).toBe(0)
    expect(extractProgress('')).toBe(0)
  })

  it('超过 100 会被夹到 100', () => {
    expect(extractProgress('进度 999%')).toBe(100)
  })

  it('取第一个出现的百分比', () => {
    expect(extractProgress('学习进度 55 % (班级平均 80%)')).toBe(55)
  })
})

describe('extractKnowledgeTitle', () => {
  it('剥掉「学习进度 X%」', () => {
    expect(extractKnowledgeTitle('艺术的定义 学习进度 100 %')).toBe('艺术的定义')
    expect(extractKnowledgeTitle('艺术的分类学习进度40%')).toBe('艺术的分类')
  })

  it('没有进度文案时原样返回', () => {
    expect(extractKnowledgeTitle('艺术的起源')).toBe('艺术的起源')
  })

  it('折叠多余空白', () => {
    expect(extractKnowledgeTitle('  艺术   的 定义  ')).toBe('艺术 的 定义')
  })
})

describe('hasDurationText', () => {
  it('识别 mm:ss 与 h:mm:ss', () => {
    expect(hasDurationText('12:35')).toBe(true)
    expect(hasDurationText('1:02:35')).toBe(true)
    expect(hasDurationText('时长 08:20 已完成')).toBe(true)
  })

  it('不把普通数字当时长', () => {
    expect(hasDurationText('共 24 页')).toBe(false)
    expect(hasDurationText('艺术的定义')).toBe(false)
    expect(hasDurationText('3.1 章节')).toBe(false)
  })
})

describe('classifyResource', () => {
  const CARD_CLASS = 'basic-info-video-card-container'

  it('文本带时长 → 视频', () => {
    expect(classifyResource('1. 艺术是什么 12:35', CARD_CLASS)).toBe('video')
  })

  it('文本带「页」→ 非视频（PPT 卡片的 class 与视频卡完全一样）', () => {
    expect(classifyResource('2. 课件讲义 共 24 页', CARD_CLASS)).toBe('other')
  })

  it('文本带「已完成」→ 非视频', () => {
    expect(classifyResource('3. 资料 已完成', CARD_CLASS)).toBe('other')
  })

  it('时长判据优先于「已完成」', () => {
    // 已完成的视频同样是视频，只是已经学过
    expect(classifyResource('3. 拓展阅读 08:20 已完成', CARD_CLASS)).toBe('video')
  })

  it('只有 class 含 video 且不是通用卡片样式时才判为视频', () => {
    expect(classifyResource('无特征文本', 'topic-video-item')).toBe('video')
    // 通用卡片样式即使含 video 也不算数（否则 PPT 会被误判）
    expect(classifyResource('无特征文本', CARD_CLASS)).toBe('other')
  })

  it('什么特征都没有时保守判为非视频', () => {
    expect(classifyResource('', '')).toBe('other')
  })
})

describe('isMustLearnSection', () => {
  it('含「必学」才算', () => {
    expect(isMustLearnSection('必学资源')).toBe(true)
    expect(isMustLearnSection('本节必学')).toBe(true)
    expect(isMustLearnSection('选学资源')).toBe(false)
    expect(isMustLearnSection('')).toBe(false)
  })
})
