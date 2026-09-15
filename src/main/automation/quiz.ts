/**
 * 弹题处理。移植自 v1 `src/bot/quiz.py`，行为保持一致。
 *
 * handoff §13：本次**不增加** AI 答题 / OCR / 联网搜题 / 题库，
 * 只迁移现有能力。
 *
 * 相对 v1 的唯一行为修正（handoff §28「Quiz Random Strategy」）：
 *   v1 在"验证选中失败"时会再调一次 select_option()，等于**换了一个选项**，
 *   单题结果不确定。v2 把选择结果固定下来：整道题只选一次，
 *   后续重试只重复点击同一个目标。
 */

import type { Locator, Page } from 'playwright-core'
import {
  QUIZ_CLOSE_BTN_XPATH,
  QUIZ_CLOSE_CSS,
  QUIZ_DIALOG_CSS,
  QUIZ_DIALOG_FALLBACK_CSS,
  QUIZ_FOOTER_BTN_XPATH,
  QUIZ_NEXT_BTN_CSS,
  QUIZ_OPTION_ACTIVE_CSS,
  QUIZ_OPTION_CSS,
  SLEEP
} from './constants'
import { isVisible, safeClick, textOf } from './locators'
import type { Logger } from '../services/logger'

// ============================================================================
// 答题策略
// ============================================================================

export interface AnswerStrategy {
  readonly name: string
  /** 从选项数量中选一个下标。 */
  selectIndex(optionCount: number): number
}

export class RandomAnswerStrategy implements AnswerStrategy {
  readonly name = 'random'
  selectIndex(optionCount: number): number {
    return Math.floor(Math.random() * optionCount)
  }
}

export class FirstAnswerStrategy implements AnswerStrategy {
  readonly name = 'first'
  selectIndex(): number {
    return 0
  }
}

/** 供测试注入固定选择 */
export class FixedAnswerStrategy implements AnswerStrategy {
  readonly name = 'fixed'
  constructor(private readonly index: number) {}
  selectIndex(optionCount: number): number {
    return Math.max(0, Math.min(this.index, optionCount - 1))
  }
}

// ============================================================================
// 弹题处理器
// ============================================================================

export class QuizService {
  constructor(
    private readonly page: Page,
    private readonly log: Logger,
    private readonly strategy: AnswerStrategy = new RandomAnswerStrategy()
  ) {}

  /** 页面里是否有可见的弹题对话框。 */
  async findDialog(): Promise<Locator | null> {
    // 首选：带"弹题"字样的 el-dialog
    const primary = this.page.locator(QUIZ_DIALOG_CSS)
    const count = await primary.count().catch(() => 0)
    for (let i = 0; i < count; i += 1) {
      const candidate = primary.nth(i)
      if (await isVisible(candidate)) return candidate
    }

    // 兜底：遍历所有可见 el-dialog，检查 aria-label
    const fallback = this.page.locator(QUIZ_DIALOG_FALLBACK_CSS)
    const fallbackCount = await fallback.count().catch(() => 0)
    for (let i = 0; i < fallbackCount; i += 1) {
      const candidate = fallback.nth(i)
      if (!(await isVisible(candidate))) continue
      const label = (await candidate.getAttribute('aria-label')) ?? ''
      if (label.includes('弹题') || label.includes('测验') || label.includes('答题')) {
        return candidate
      }
    }

    return null
  }

  /**
   * 处理一道或多道题，然后关闭对话框。
   *
   * 注意最后一题：站点上「下一题」按钮在最后一题会变成「提交」，
   * 点下去对话框自己就消失了。v1 在这种情况下仍然去调 `_close()`，
   * 找不到关闭按钮就返回 False —— 明明答完了却报失败。
   * 这里把「对话框已经不在了」直接视为成功。
   */
  async handle(dialog: Locator): Promise<boolean> {
    try {
      let questionIndex = 0
      // 上限只是防御性的：正常流程由"没有下一题"或对话框消失自然结束
      while (questionIndex < 50) {
        questionIndex += 1
        this.log.info(`处理弹题第 ${questionIndex} 题`)

        const answered = await this.answerCurrent(dialog)
        await this.page.waitForTimeout(SLEEP.short)

        if (await this.isGone(dialog)) {
          this.log.info('弹题对话框已消失（最后一题提交后自动关闭）')
          return true
        }
        if (!answered) {
          this.log.warn('本题未能作答，停止继续作答')
          break
        }

        const nextBtn = dialog.locator(QUIZ_NEXT_BTN_CSS).first()
        if (await isVisible(nextBtn)) {
          const enabled = await nextBtn.isEnabled().catch(() => false)
          if (enabled) {
            this.log.info('点击右箭头进入下一题')
            await nextBtn.click().catch(() => undefined)
            await this.page.waitForTimeout(SLEEP.medium)
            if (await this.isGone(dialog)) {
              this.log.info('点击后弹题对话框已关闭')
              return true
            }
            continue
          }
        }
        break
      }

      if (await this.isGone(dialog)) return true
      return await this.close(dialog)
    } catch (error) {
      this.log.error(`处理弹题时出错: ${String(error)}`)
      return false
    }
  }

  /** 对话框是否已经从页面上消失。 */
  private async isGone(dialog: Locator): Promise<boolean> {
    try {
      if ((await dialog.count()) === 0) return true
      return !(await dialog.isVisible())
    } catch {
      return true
    }
  }

  /**
   * 回答当前这道题。
   *
   * 关键点：选项下标只取一次。若第一次点击没能让选项进入 active 状态，
   * 后续重试**重复点击同一项**，而不是重新随机 —— 否则同一道题的答案
   * 会在重试之间来回跳（v1 的缺陷）。
   */
  private async answerCurrent(dialog: Locator): Promise<boolean> {
    let options = dialog.locator(QUIZ_OPTION_CSS)
    if ((await options.count().catch(() => 0)) === 0) {
      options = dialog.locator("xpath=.//li[contains(@class,'topic-item')]")
    }

    const optionCount = await options.count().catch(() => 0)
    if (optionCount === 0) {
      this.log.info('未找到弹题选项')
      return false
    }

    const index = this.strategy.selectIndex(optionCount)
    const choice = options.nth(index)
    this.log.info(`本题选择第 ${index + 1}/${optionCount} 项（策略: ${this.strategy.name}）`)

    // 点击目标依次退化：选项本体 → 内部 .item-topic → span → div
    const targets = [
      choice,
      choice.locator('.item-topic').first(),
      choice.locator('span').first(),
      choice.locator('div').first()
    ]

    // 只发可信点击：合成点击（element.click()）会被学习页的防脚本守卫抓到，
    // 见 docs/MIGRATION.md 与 locators.ts::safeClick。
    const clickChoice = async (): Promise<boolean> => {
      for (const target of targets) {
        if (await safeClick(target, 2_000)) return true
      }
      return false
    }

    if (!(await clickChoice())) {
      this.log.warn('无法点击弹题选项')
      return false
    }

    // 验证选中；失败时只重复点击**同一个**选项
    await this.page.waitForTimeout(SLEEP.short)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (await this.hasActiveOption(dialog)) {
        this.log.info('确认选项已被选中')
        return true
      }
      await clickChoice()
      await this.page.waitForTimeout(SLEEP.short)
    }

    this.log.warn('未检测到选项被选中')
    return false
  }

  private async hasActiveOption(dialog: Locator): Promise<boolean> {
    for (const selector of QUIZ_OPTION_ACTIVE_CSS) {
      const count = await dialog.locator(selector).count().catch(() => 0)
      if (count > 0) return true
    }
    return false
  }

  /** 关闭弹题对话框，依次尝试多条路径。 */
  async close(dialog: Locator): Promise<boolean> {
    for (const selector of QUIZ_CLOSE_CSS) {
      const btn = dialog.locator(selector).first()
      if (await isVisible(btn)) {
        await btn.click().catch(() => undefined)
        this.log.info('已关闭弹题对话框')
        await this.page.waitForTimeout(SLEEP.medium)
        return true
      }
    }

    for (const [xpath, label] of [
      [QUIZ_FOOTER_BTN_XPATH, "底部按钮"],
      [QUIZ_CLOSE_BTN_XPATH, "底部'关闭'按钮"]
    ] as const) {
      const btn = dialog.locator(`xpath=${xpath}`).first()
      if (await isVisible(btn)) {
        await btn.click().catch(() => undefined)
        this.log.info(`已通过${label}关闭弹题`)
        await this.page.waitForTimeout(SLEEP.medium)
        return true
      }
    }

    this.log.warn('未能关闭弹题对话框')
    return false
  }

  /** 读取题干（仅用于日志，不参与决策） */
  async readQuestion(dialog: Locator): Promise<string> {
    return textOf(dialog.locator('p').first())
  }
}
