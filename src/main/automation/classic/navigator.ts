/**
 * 传统课程导航器。移植自 v1 `src/bot/course.py`。
 *
 * 负责：进课程页 → 处理初始弹窗 → 解析视频列表 → 定位下一个待处理视频 → 点击
 *
 * handoff §28「Classic Course 回环」：v1 在 skip_completed=false 时会环形回到
 * 列表头部，终止条件依赖 DOM 偶然变化。v2 在这里**显式**返回"是否已回到起点"，
 * 由 Runner 决定终止，不靠巧合。
 */

import type { Locator, Page } from 'playwright-core'
import {
  INITIAL_DIALOG_MAX_ATTEMPTS,
  LEARNING_PROGRESS_POPUP_CSS,
  LEARNING_PROGRESS_POPUP_KEYWORDS,
  PRESCHOOL_CLOSE_CSS,
  PRESCHOOL_DIALOG_CSS,
  SLEEP,
  TIMEOUT,
  VIDEO_CURRENT_PLAY_CSS,
  VIDEO_FINISHED_MARK_CSS,
  VIDEO_LIST_ITEM_CSS,
  VIDEO_SMALL_LESSON_CSS,
  VIDEO_TITLE_CSS
} from '../constants'
import { firstVisible, isVisible, safeClick } from '../locators'
import type { CaptchaService } from '../captcha'
import type { QuizService } from '../quiz'
import type { Logger } from '../../services/logger'

export interface VideoEntry {
  title: string
  /** 在列表中的下标 */
  index: number
  finished: boolean
  /** 侧边栏里标着 current_play */
  current: boolean
}

export interface NextVideoResult {
  title: string
  locator: Locator
  index: number
  /** 从末尾绕回了列表头部 */
  wrapped: boolean
}

export class ClassicCourseNavigator {
  constructor(
    private readonly page: Page,
    private readonly log: Logger,
    private readonly captcha: CaptchaService,
    private readonly quiz: QuizService,
    private readonly skipCompleted: boolean
  ) {}

  // ---------------------------------------------------------------- 导航

  async navigate(url: string): Promise<void> {
    if (this.page.url() === url) {
      // 登录态检查已经把我们带到课程页了，不必再刷一次
      this.log.info(`已在课程页面，跳过重复导航: ${url}`)
    } else {
      this.log.info(`正在访问课程页面: ${url}`)
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT.extraLong })
      await this.page.waitForTimeout(SLEEP.pageLoad)
    }

    await this.handleInitialDialogs()
    await this.captcha.checkAndHandle('course', '访问课程页面时出现验证码，请完成验证')
  }

  /**
   * 交叉检测并处理多种初始弹窗。
   * 学前必读与弹题可能同时出现，必须交替检查而不是处理完一种就退出。
   */
  async handleInitialDialogs(): Promise<void> {
    for (let attempt = 0; attempt < INITIAL_DIALOG_MAX_ATTEMPTS; attempt += 1) {
      let foundAny = false

      if (await this.closePreschoolDialog()) {
        foundAny = true
        this.log.info(`检测到「学前必读」弹窗（第 ${attempt + 1} 次尝试）`)
        await this.page.waitForTimeout(SLEEP.medium)
      }

      const quizDialog = await this.quiz.findDialog()
      if (quizDialog) {
        foundAny = true
        this.log.info(`检测到弹题测验（第 ${attempt + 1} 次尝试）`)
        await this.quiz.handle(quizDialog)
        await this.page.waitForTimeout(SLEEP.medium)
      }

      if (await this.closeLearningProgressPopup()) {
        foundAny = true
        this.log.info(`已关闭学习进度提醒（第 ${attempt + 1} 次尝试）`)
        await this.page.waitForTimeout(SLEEP.medium)
      }

      if (!foundAny) {
        this.log.debug(`初始弹窗已全部处理完毕（经过 ${attempt + 1} 次检查）`)
        return
      }
    }
    this.log.warn('初始弹窗处理循环达到上限，继续执行')
  }

  private async closePreschoolDialog(): Promise<boolean> {
    const dialog = this.page.locator(PRESCHOOL_DIALOG_CSS).first()
    if (!(await isVisible(dialog))) return false

    this.log.info("检测到「学前必读」弹窗，正在关闭...")
    const closeBtn = await firstVisible(this.page, PRESCHOOL_CLOSE_CSS, TIMEOUT.short)
    if (closeBtn) {
      await safeClick(closeBtn)
      this.log.info("已关闭「学前必读」弹窗")
    } else {
      // 不再用 JS 合成点击（学习页会把 isTrusted === false 的点击当成异常脚本），
      // 直接摘掉这个遮挡层节点即可 —— v1 对同类遮挡卡片也是这么兜底的。
      await this.page
        .evaluate(() => {
          const d = document.querySelector('.dialog-read')
          d?.remove()
        })
        .catch(() => undefined)
      this.log.info("已通过移除 DOM 关闭「学前必读」弹窗")
    }
    await this.page.waitForTimeout(SLEEP.long)
    return true
  }

  /**
   * 关闭/移除挡住点击的"学习进度提醒"卡片。
   * 逻辑与 v1 的注入脚本等价：找到含关键字的卡片，优先点关闭按钮，
   * 没有按钮就直接从 DOM 移除，最后才退到隐藏。
   *
   * 与 v1 的唯一差异：关闭按钮**不再用 JS 合成点击**，而是把按钮中心坐标
   * 交给 `page.mouse.click()`。卡片就压在学习页的 `#container` 上，合成点击
   * 会触发站点的防脚本守卫（弹「检测到异常脚本…」并在 3 秒后跳回首页）。
   * 没有可点的关闭按钮时，仍然直接从 DOM 移除节点（不派发任何事件）。
   */
  private async closeLearningProgressPopup(): Promise<boolean> {
    try {
      const result = await this.page.evaluate(
        ([selectors, keywords]) => {
          const seen = new Set<Element>()
          let count = 0
          const points: Array<{ x: number; y: number }> = []

          const textOf = (node: Element | null): string =>
            ((node as HTMLElement | null)?.innerText ?? node?.textContent ?? '').trim()
          const hasKeyword = (node: Element): boolean => {
            const text = textOf(node)
            return keywords.some((k) => text.includes(k))
          }
          const findPanel = (card: Element): Element => {
            for (
              let node: Element | null = card;
              node && node !== document.body;
              node = node.parentElement
            ) {
              if (
                node.classList?.contains('main') &&
                node.querySelector('.head') &&
                node.querySelector('.box') &&
                hasKeyword(node)
              ) {
                return node
              }
            }
            return card
          }

          for (const selector of selectors) {
            for (const node of Array.from(document.querySelectorAll(selector))) {
              if (seen.has(node) || !hasKeyword(node)) continue
              seen.add(node)

              const card = node.closest('.ss2077-msg-custom') ?? node
              const item = card.closest('.item')
              const panel = findPanel(card)
              const root = panel ?? item ?? card
              const closeButton = root.querySelector(
                "[class*='close'],[class*='guanbi'],.el-dialog__close,.el-dialog__headerbtn,button[aria-label='Close']"
              )

              // 关闭按钮只回报坐标，由调用方用真实鼠标点击（不可信事件会被站点拦下）
              const rect = closeButton?.getBoundingClientRect()
              if (rect && rect.width > 0 && rect.height > 0) {
                points.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
              } else if (root.parentElement) {
                root.remove()
              } else {
                const el = root as HTMLElement
                el.style.display = 'none'
                el.style.pointerEvents = 'none'
              }
              count += 1
            }
          }
          return { count, points }
        },
        [
          LEARNING_PROGRESS_POPUP_CSS as unknown as string[],
          LEARNING_PROGRESS_POPUP_KEYWORDS as unknown as string[]
        ] as const
      )

      const closed = result?.count ?? 0
      for (const point of result?.points ?? []) {
        await this.page.mouse.click(point.x, point.y).catch(() => undefined)
      }

      if (closed > 0) {
        this.log.info(`已关闭学习进度提醒（${closed} 处）`)
        await this.page.waitForTimeout(SLEEP.long)
        return true
      }
    } catch (error) {
      this.log.debug(`学习进度提醒清理跳过: ${String(error)}`)
    }
    return false
  }

  // ------------------------------------------------------------ 列表解析

  /** 解析侧边栏全部视频项（含已完成与小节标题，便于定位下标）。 */
  async listVideos(): Promise<VideoEntry[]> {
    try {
      return await this.page.locator(VIDEO_LIST_ITEM_CSS).evaluateAll(
        (nodes, selectors) => {
          const [smallLesson, titleSel, finishedMark, currentPlay] = selectors
          return nodes.map((node, index) => ({
            index,
            title:
              (node.querySelector(titleSel) as HTMLElement | null)?.innerText.trim() ?? '',
            finished: !!node.querySelector(finishedMark),
            current: node.matches(currentPlay),
            // 小章节标题的 class 常常就在 li 自身上，而不是子元素。
            // v1 用的 find_elements(By.CSS_SELECTOR, ...) 只搜后代，
            // 所以那些 li 从来没被真正排除掉，一直被当成可播放视频。
            // 这里两个位置都查，行为才符合「排除小章节」的本意。
            isSmallLesson: node.matches(smallLesson) || !!node.querySelector(smallLesson)
          }))
        },
        [
          VIDEO_SMALL_LESSON_CSS,
          VIDEO_TITLE_CSS,
          VIDEO_FINISHED_MARK_CSS,
          VIDEO_CURRENT_PLAY_CSS
        ] as const
      )
    } catch (error) {
      this.log.warn(`未找到课程列表项: ${String(error)}`)
      return []
    }
  }

  private isPlayable(entry: VideoEntry & { isSmallLesson?: boolean }): boolean {
    if (!entry.title || entry.isSmallLesson) return false
    if (this.skipCompleted && entry.finished) return false
    return true
  }

  /**
   * 从 afterTitle 之后找下一个待处理视频。
   *
   * 定位当前位置的顺序与 v1 **不同**：先按传入的标题找，找不到再退回 DOM 的
   * `current_play`。v1 是反过来的（`current_play` 优先），而站点一加载就把
   * 列表第一项标成 `current_play`，于是：
   *   - 起点会被跳过（见 `firstPlayable`）；
   *   - 「从上次进度继续」也会被它带跑 —— 明明该从上次那节之后开始，
   *     却从第一项之后开始。
   * 循环里机器人自己知道刚处理完哪一节，标题比 DOM 更可信；
   * `current_play` 保留为兜底（列表改版、标题被改写时仍然能找到位置）。
   *
   * 与 v1 的另一处差异：v1 找不到就无条件环形回到头部。这里把「绕回」显式标记出来，
   * 由 Runner 用任务终止条件决定是否接受，而不是靠 DOM 巧合结束循环。
   */
  async nextVideoAfter(afterTitle: string | null): Promise<NextVideoResult | null> {
    const entries = (await this.listVideos()) as Array<VideoEntry & { isSmallLesson?: boolean }>
    if (entries.length === 0) return null

    // 定位当前下标：先按标题，再退回 DOM 的 current_play
    let currentIndex = afterTitle ? entries.findIndex((e) => e.title === afterTitle) : -1
    if (currentIndex < 0) currentIndex = entries.findIndex((e) => e.current)

    const start = currentIndex >= 0 ? currentIndex + 1 : 0

    for (let i = start; i < entries.length; i += 1) {
      if (this.isPlayable(entries[i])) {
        return {
          title: entries[i].title,
          index: entries[i].index,
          locator: this.page.locator(VIDEO_LIST_ITEM_CSS).nth(entries[i].index),
          wrapped: false
        }
      }
    }

    // 从头找，明确标记 wrapped
    for (let i = 0; i < start; i += 1) {
      if (this.isPlayable(entries[i])) {
        return {
          title: entries[i].title,
          index: entries[i].index,
          locator: this.page.locator(VIDEO_LIST_ITEM_CSS).nth(entries[i].index),
          wrapped: true
        }
      }
    }

    return null
  }

  /**
   * 第一个待处理视频（起点）。
   *
   * **刻意不参考 DOM 的 `current_play`。** 课程页一加载，站点就会把列表里的
   * 第一项标成 `current_play`（自动选中并载入播放器），而 `nextVideoAfter()`
   * 的语义是"当前项之后的下一项" —— 用它取起点会直接跳过第一个视频，
   * 表现就是"第一个课永远刷不到，从第二个开始"。
   *
   * 起点只按列表顺序取第一个"可播放"（有标题、非小章节、按配置跳过已完成）的项。
   */
  async firstPlayable(): Promise<NextVideoResult | null> {
    const entries = (await this.listVideos()) as Array<VideoEntry & { isSmallLesson?: boolean }>

    for (const entry of entries) {
      if (!this.isPlayable(entry)) continue
      return {
        title: entry.title,
        index: entry.index,
        locator: this.page.locator(VIDEO_LIST_ITEM_CSS).nth(entry.index),
        wrapped: false
      }
    }

    return null
  }

  // ---------------------------------------------------------------- 点击

  async clickVideo(video: Locator, title: string): Promise<boolean> {
    this.log.info(`点击课程: ${title}`)
    try {
      await video.scrollIntoViewIfNeeded({ timeout: TIMEOUT.short }).catch(() => undefined)
      await this.page.waitForTimeout(SLEEP.short)
      await video.click({ timeout: TIMEOUT.medium })
      await this.page.waitForTimeout(SLEEP.extraLong)

      await this.captcha.checkAndHandle('course', `切换课程「${title}」时出现验证码，请完成验证`)
      return true
    } catch (error) {
      this.log.error(`点击课程失败「${title}」: ${String(error)}`)
      return false
    }
  }

  /** 点击失败时交叉处理弹窗后重试（v1 `_click_video_with_retry`）。 */
  async clickVideoWithRetry(
    video: Locator,
    title: string,
    shouldStop: () => boolean
  ): Promise<boolean> {
    let retry = 0
    while (!(await this.clickVideo(video, title))) {
      if (shouldStop()) return false
      retry += 1
      this.log.warn(`点击课程失败（第 ${retry} 次重试），交叉检测弹窗: ${title}`)
      await this.handleInitialDialogs()
      await this.page.waitForTimeout(SLEEP.medium)
    }
    return true
  }
}
