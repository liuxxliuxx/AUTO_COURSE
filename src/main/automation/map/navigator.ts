/**
 * 图谱课导航器。移植自 v1 `src/bot/map_course.py`。
 *
 * 页面模型（handoff §9）：
 *   图谱页 → 知识项 → 学习页 → 必学资源（视频 / 非视频）
 *
 * 实测要点（v1 注释里记的坑，全部保留）：
 *  - 知识项是 id="knowledgeId-XXX"，不是 class；
 *  - 所有资源卡片容器 class 都叫 basic-info-video-card-container（PPT 也是），
 *    所以**不能**只看 class 判类型，必须看文本里的时长特征；
 *  - 取 <video> 必须限定在播放器容器内，否则会误取页面上的装饰动画 video。
 *
 * 解析类逻辑全部做成纯函数，便于用固定 HTML 做单元测试（handoff §29）。
 */

import type { Page } from 'playwright-core'
import { SLEEP, TIMEOUT } from '../constants'
import { isVisible } from '../locators'
import type { Logger } from '../../services/logger'

// ============================================================================
// 常量
// ============================================================================

export const MAP_ITEM_CSS = "[id*='knowledgeId-']"
export const RESOURCE_SECTION_CSS = '.resources-section'
export const RESOURCE_TITLE_CSS = '.resources-detail-title'
export const RESOURCE_CARD_CSS =
  ".basic-info-video-card-container, .resources-list > *, .resources-list [class*='item']"

/** 卡片上的「已完成」标记文案 */
export const DONE_TEXT = '已完成'

/** 播放器容器；取 video 必须限定在里面 */
export const VIDEO_PLAYER_CONTAINER_SELECTORS = [
  '#vjs_videoContStudy',
  '.vjs-video-player',
  '.video-js'
]

/** 非视频资源停留时长（秒） */
export const NON_VIDEO_HOLD_SECONDS = 5

/** 视频监控轮询间隔 */
export const VIDEO_CHECK_INTERVAL_MS = 3_000

/** 单视频最长监控：3 小时 */
export const VIDEO_MAX_WAIT_MS = 3 * 60 * 60 * 1000

/** 连续 N 次找不到 video 元素就退出（兜底防卡死） */
export const NO_VIDEO_MAX_STREAK = 20
/** 连续 N 次 duration<=0 就退出 */
export const ZERO_DURATION_MAX_STREAK = 20

// ============================================================================
// 纯解析函数
// ============================================================================

/** 从 `knowledgeId-12345` 里取出数字 ID。 */
export function extractKnowledgeId(elementId: string): string {
  const match = /knowledgeId-(\d+)/.exec(elementId ?? '')
  return match ? match[1] : ''
}

/** 取学习进度百分比；没有则 0。 */
export function extractProgress(text: string): number {
  const match = /(\d{1,3})\s*%/.exec(text ?? '')
  if (!match) return 0
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? Math.min(value, 100) : 0
}

/**
 * 从知识项文本里剥离「学习进度 X%」得到标题。
 * 与 v1 `_extract_title` 等价。
 */
export function extractKnowledgeTitle(text: string): string {
  return (text ?? '')
    .replace(/学习进度/g, '')
    .replace(/\d{1,3}\s*%/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 文本里是否含时长特征（mm:ss 或 h:mm:ss）。 */
export function hasDurationText(text: string): boolean {
  return /\d{1,2}:\d{2}(:\d{2})?/.test(text ?? '')
}

/**
 * 判定资源类型。
 *
 * 与 v1 `_detect_resource_type` 等价。
 * 注意：所有卡片的 class 都是 `basic-info-video-card-container`，
 * 所以 class 只能作为最后的兜底判据。
 */
export function classifyResource(text: string, className: string): 'video' | 'other' {
  // 1. 文本含时长 → 视频
  if (hasDurationText(text)) return 'video'
  // 2. 文本含「页」或「完成」→ PPT / 教材片段
  if (text.includes('页') || text.includes(DONE_TEXT)) return 'other'
  // 3. 兜底看 class，但要排除通用卡片样式
  const cls = (className ?? '').toLowerCase()
  if (cls.includes('video') && !cls.includes('basic-info')) return 'video'
  return 'other'
}

/** 判断某个分区标题是不是「必学」分区 */
export function isMustLearnSection(sectionTitle: string): boolean {
  return (sectionTitle ?? '').includes('必学')
}

// ============================================================================
// 类型
// ============================================================================

export interface KnowledgeItem {
  title: string
  knowledgeId: string
  progress: number
}

export interface ResourceItem {
  title: string
  type: 'video' | 'other'
  done: boolean
  /** 在 `RESOURCE_CARD_CSS` 匹配结果中的下标，供定位 */
  index: number
}

export interface MapVideoInfo {
  found: boolean
  current: number
  duration: number
  paused: boolean
  ended: boolean
}

// ============================================================================
// 导航器
// ============================================================================

export class MapCourseNavigator {
  constructor(
    private readonly page: Page,
    private readonly log: Logger
  ) {}

  // -------------------------------------------------------------- 图谱页

  /** 解析当前图谱页的所有知识项。 */
  async getKnowledgeItems(): Promise<KnowledgeItem[]> {
    try {
      const raw = await this.page.locator(MAP_ITEM_CSS).evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: (node as HTMLElement).id ?? '',
          text: ((node as HTMLElement).innerText ?? node.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
        }))
      )

      const items: KnowledgeItem[] = []
      for (const entry of raw) {
        const knowledgeId = extractKnowledgeId(entry.id)
        const title = extractKnowledgeTitle(entry.text)
        if (!title || !knowledgeId) continue
        const item = { title, knowledgeId, progress: extractProgress(entry.text) }
        items.push(item)
        this.log.info(`知识项: ${item.title} | ${item.knowledgeId} | ${item.progress}%`)
      }
      return items
    } catch (error) {
      this.log.warn(`图谱页未找到知识项容器: ${String(error)}`)
      return []
    }
  }

  // -------------------------------------------------------------- 学习页

  /**
   * 解析当前学习页「必学」分区里的资源。
   *
   * 关键：`index` 必须是**整个页面上** `RESOURCE_CARD_CSS` 匹配结果里的下标，
   * 因为 `openResource()` 是用 `locator(...).nth(index)` 去点的。
   * 只按必学分区内部计数的话，选学资源夹在中间时就会点错卡片。
   */
  async getMustLearnResources(): Promise<ResourceItem[]> {
    try {
      const cards = await this.page.locator(RESOURCE_CARD_CSS).evaluateAll(
        (nodes, selectors) => {
          const [sectionSel, titleSel] = selectors
          return nodes.map((card, index) => {
            const section = card.closest(sectionSel)
            const sectionTitle = (
              (section?.querySelector(titleSel) as HTMLElement | null)?.innerText ?? ''
            ).trim()
            return {
              index,
              sectionTitle,
              text: ((card as HTMLElement).innerText ?? card.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim(),
              className: card.getAttribute('class') ?? ''
            }
          })
        },
        [RESOURCE_SECTION_CSS, RESOURCE_TITLE_CSS] as const
      )

      const resources: ResourceItem[] = []
      for (const card of cards) {
        if (!isMustLearnSection(card.sectionTitle)) continue
        if (!card.text) continue

        const resource: ResourceItem = {
          title: card.text,
          type: classifyResource(card.text, card.className),
          done: card.text.includes(DONE_TEXT),
          index: card.index
        }
        resources.push(resource)
        this.log.info(
          `必学资源: ${resource.title} | type=${resource.type} | done=${resource.done}`
        )
      }
      return resources
    } catch (error) {
      this.log.warn(`解析必学资源失败: ${String(error)}`)
      return []
    }
  }

  /** 打开一个资源卡片。 */
  async openResource(resource: ResourceItem): Promise<boolean> {
    const card = this.page.locator(RESOURCE_CARD_CSS).nth(resource.index)
    try {
      await card.scrollIntoViewIfNeeded({ timeout: TIMEOUT.short }).catch(() => undefined)
      await card.click({ timeout: TIMEOUT.medium })
      await this.page.waitForTimeout(SLEEP.extraLong)
      return true
    } catch {
      const ok = await card
        .evaluate((el) => ((el as HTMLElement).click(), true))
        .catch(() => false)
      await this.page.waitForTimeout(SLEEP.extraLong)
      return ok
    }
  }

  /** 非视频资源：停留若干秒即可。 */
  async holdNonVideo(resource: ResourceItem): Promise<void> {
    this.log.info(`非视频资源停留 ${NON_VIDEO_HOLD_SECONDS}s: ${resource.title}`)
    await this.page.waitForTimeout(NON_VIDEO_HOLD_SECONDS * 1000)
  }

  // ------------------------------------------------------------ 播放器

  /** 读取播放器容器内的视频状态（不限定容器会误取装饰动画）。 */
  async getVideoInfo(): Promise<MapVideoInfo> {
    try {
      return await this.page.evaluate((selectors) => {
        let host: Element | null = null
        for (const selector of selectors) {
          host = document.querySelector(selector)
          if (host) break
        }
        const scoped = host?.querySelector('video') ?? document.querySelector('video')
        if (!scoped) return { found: false, current: 0, duration: 0, paused: true, ended: false }
        const v = scoped as HTMLVideoElement
        return {
          found: true,
          current: Number.isFinite(v.currentTime) ? v.currentTime : 0,
          duration: Number.isFinite(v.duration) ? v.duration : 0,
          paused: v.paused,
          ended: !!v.ended
        }
      }, VIDEO_PLAYER_CONTAINER_SELECTORS)
    } catch {
      return { found: false, current: 0, duration: 0, paused: true, ended: false }
    }
  }

  /** 尝试恢复播放（优先播放器容器内的按钮）。 */
  async resumeVideo(): Promise<boolean> {
    const selectors = [
      '#vjs_videoContStudy .vjs-big-play-button',
      '#vjs_videoContStudy .vjs-play-control',
      '#vjs_videoContStudy video',
      '.vjs-big-play-button',
      '.vjs-play-control'
    ]

    for (const selector of selectors) {
      const target = this.page.locator(selector).first()
      if (!(await isVisible(target))) continue
      await target.click({ timeout: 2_000 }).catch(() => undefined)
      await this.page.waitForTimeout(SLEEP.medium)
      const info = await this.getVideoInfo()
      if (info.found && !info.paused) return true
    }

    // 兜底：直接调 play()
    const played = await this.page
      .evaluate((sels) => {
        let host: Element | null = null
        for (const selector of sels) {
          host = document.querySelector(selector)
          if (host) break
        }
        const v = (host ?? document).querySelector('video') as HTMLVideoElement | null
        if (!v) return false
        void v.play().catch(() => undefined)
        return true
      }, VIDEO_PLAYER_CONTAINER_SELECTORS)
      .catch(() => false)

    return played
  }
}
