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
  CLICK_VIDEO_MAX_RETRIES,
  COURSE_CLICK_PROBE_MS,
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
import { firstVisibleWithin, isVisible } from '../locators'
import type { CaptchaService } from '../captcha'
import type { QuizService } from '../quiz'
import { CourseOverlays } from './course-overlays'
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
  private readonly overlays: CourseOverlays
  lastClickError: string | null = null
  constructor(
    private readonly page: Page,
    private readonly log: Logger,
    private readonly captcha: CaptchaService,
    private readonly quiz: QuizService,
    private readonly skipCompleted: boolean
  ) { this.overlays = new CourseOverlays(page, log) }

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

      if (await this.closeLearningProgressPopup()) {
        foundAny = true
        this.log.info(`已关闭课程信息浮层（第 ${attempt + 1} 次尝试）`)
        await this.page.waitForTimeout(SLEEP.medium)
      }

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

      if (!foundAny) {
        this.log.debug(`初始弹窗已全部处理完毕（经过 ${attempt + 1} 次检查）`)
        return
      }
    }
    this.log.warn('初始弹窗处理循环达到上限，继续执行')
  }

  private async closePreschoolDialog(): Promise<boolean> {
    const dialog = this.page.locator(`${PRESCHOOL_DIALOG_CSS}:visible`).first()
    if (!(await isVisible(dialog))) return false

    const closeBtn = await firstVisibleWithin(this.page, PRESCHOOL_CLOSE_CSS, 700)
    if (closeBtn) {
      await closeBtn.click({ timeout: 700 }).catch(() => {})
      await dialog.waitFor({ state: 'hidden', timeout: 500 }).catch(() => {})
    }
    if (await isVisible(dialog)) await dialog.evaluate(el => el.remove()).catch(() => {})
    const closed = !(await isVisible(dialog))
    if (closed) this.log.info('已关闭「学前必读」弹窗')
    else this.log.warn('「学前必读」弹窗仍未关闭')
    return closed
  }

  async dismissCourseOverlays(): Promise<number> {
    return this.overlays.dismiss()
  }

  private async closeLearningProgressPopup(): Promise<boolean> {
    return (await this.dismissCourseOverlays()) > 0
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
      await this.dismissCourseOverlays()
      const obstruction = await this.overlays.obstruction(video)
      if (obstruction) {
        this.log.warn(`课程目录被遮挡「${title}」: ${obstruction}`)
        return false
      }
      await video.click({ timeout: COURSE_CLICK_PROBE_MS })
      await this.page.waitForTimeout(SLEEP.extraLong)

      await this.captcha.checkAndHandle('course', `切换课程「${title}」时出现验证码，请完成验证`)
      return true
    } catch (error) {
      this.log.error(`点击课程失败「${title}」: ${String(error)}`)
      return false
    }
  }

  /** Resolve real blockers, recover broken page state, and bound retries by observed progress. */
  async clickVideoWithRetry(
    video: Locator,
    title: string,
    shouldStop: () => boolean
  ): Promise<boolean> {
    this.lastClickError = null
    const courseUrl = this.page.url()
    const originalEntries = await this.listVideos()
    let retry = 0
    let reloads = 0
    let previousBlocker: string | null = null
    let unchanged = 0
    const fail = (message: string): false => {
      this.lastClickError = message
      this.log.error(message)
      return false
    }
    while (!shouldStop()) {
      if (await this.clickVideo(video, title)) return true
      if (shouldStop()) return false
      await this.handleInitialDialogs()
      await this.captcha.checkAndHandle('course', `课程目录被遮挡「${title}」，请完成验证`)
      if (shouldStop()) return false
      const blocker = await this.overlays.inspect(video)
      if (blocker?.reloadRequired) {
        if (reloads >= 2) return fail(`课程页面恢复失败「${title}」：${blocker.description}（已重载 2 次，请检查网络后重新运行）`)
        if (!/^https?:/.test(courseUrl)) return fail(`课程页面无法重载「${title}」：${blocker.description}`)
        reloads++
        this.log.warn(`检测到课程连接/进度提交异常，重载课程页后恢复「${title}」（${reloads}/2）: ${blocker.description}`)
        try {
          if (shouldStop()) return false
          await this.page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT.extraLong })
          await this.page.locator(VIDEO_LIST_ITEM_CSS).first().waitFor({ state: 'visible', timeout: TIMEOUT.extraLong })
          if (shouldStop()) return false
          await this.handleInitialDialogs()
          await this.captcha.checkAndHandle('course', '恢复课程页面时出现验证码，请完成验证')
          if (shouldStop()) return false
          const entries = await this.listVideos()
          // Runner tracks completed indices: reject a changed catalogue rather than repeat/skip lessons.
          if (entries.length !== originalEntries.length || entries.some((entry, i) => entry.title !== originalEntries[i].title)) {
            return fail(`课程目录在恢复后发生变化，停止以避免重复或跳过课程「${title}」，请重新运行`)
          }
          const matches = entries.filter(entry => entry.title === title)
          if (matches.length !== 1) return fail(`恢复后无法唯一定位课程「${title}」，请检查课程目录后重新运行`)
          video = this.page.locator(VIDEO_LIST_ITEM_CSS).nth(matches[0].index)
          previousBlocker = null
          unchanged = 0
          continue
        } catch (error) {
          if (shouldStop()) return false
          return fail(`恢复课程页面失败「${title}」：${String(error)}`)
        }
      }
      if (blocker) {
        unchanged = blocker.signature === previousBlocker ? unchanged + 1 : 1
        previousBlocker = blocker.signature
        if (unchanged >= 2) return fail(`课程目录持续被同一浮层遮挡「${title}」：${blocker.description}，请关闭遮挡浮层后重新运行`)
        if (blocker.closeId && !shouldStop()) {
          this.log.info(`尝试关闭遮挡课程目录的提示: ${blocker.description}`)
          await this.overlays.closeBlocker(blocker.closeId)
        }
      } else {
        previousBlocker = null
        unchanged = 0
      }
      retry += 1
      if (retry > CLICK_VIDEO_MAX_RETRIES) {
        return fail(`课程目录持续被遮挡或不可点击「${title}」，请关闭遮挡浮层后重新运行`)
      }
      this.log.warn(`点击课程失败（第 ${retry} 次重试），交叉检测弹窗: ${title}`)
      await this.page.waitForTimeout(SLEEP.medium)
    }
    return false
  }
}
