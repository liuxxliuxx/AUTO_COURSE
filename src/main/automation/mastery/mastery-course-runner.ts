import type { Locator, Page } from 'playwright-core'
import type { LoginMethod, TaskMode } from '@shared/types'
import { RunnerAbort, type CourseRunner, type RunOutcome, type RunnerContext } from '../runner'
import { createLoginProvider, type LoginProvider } from '../login/provider'
import { CaptchaService } from '../captcha'
import { SLEEP } from '../constants'
import { clickImproveMastery, readMasteryPoints, readMasteryRate, scrollMasteryPanel } from './dom'
import type { MasteryQuestionBank, MasteryQuestionType } from './question-bank'

interface ExamQuestionView {
  content: string
  type: MasteryQuestionType
  optionTexts: string[]
}
interface AttemptedQuestion extends ExamQuestionView {
  questionId: string
  hadKnownAnswer: boolean
}
interface AnalysisResult {
  wrong: string[]
  correct: Array<ExamQuestionView & { correctIndices: number[] }>
}

/** 掌握度课执行器：题库 + 试错 + 解析学习，持续到课程所有知识点满级。 */
export class MasteryCourseRunner implements CourseRunner {
  readonly mode: TaskMode = 'mastery'

  constructor(
    private readonly createLogin: (method: LoginMethod) => LoginProvider = createLoginProvider
  ) {}

  async run(ctx: RunnerContext): Promise<RunOutcome> {
    const { session, settings, credentials, log } = ctx
    const page = session.playwrightPage
    const bank = ctx.masteryQuestionBank
    if (!bank) {
      return { completedCount: 0, watchedSeconds: 0, reason: 'error', error: { stage: 'preparing', code: 'execution', message: '掌握度题库未初始化' } }
    }
    let lastTick = 0
    let paused = false
    let counting = false
    const original = ctx
    const checkpoint = (): void => {
      const now = Date.now()
      if (counting && lastTick && !paused) {
        const seconds = (now - lastTick) / 1000
        watchedSeconds += seconds
        original.reportVideoWatched(seconds)
      }
      lastTick = counting ? now : 0
      if (original.shouldStop()) throw new RunnerAbort('user', '已停止')
      if (settings.timeLimitMinutes > 0 && watchedSeconds >= settings.timeLimitMinutes * 60) throw new RunnerAbort('time-limit', '已达到单次时长上限')
    }
    ctx = { ...ctx, shouldStop: () => { checkpoint(); return false } }

    let completedCount = 0
    let watchedSeconds = 0

    const captcha = new CaptchaService({ session, log, shouldStop: ctx.shouldStop,
      requestCaptcha: async (...args) => {
        checkpoint(); paused = true
        try { return await original.requestCaptcha(...args) }
        finally { paused = false; lastTick = lastTick ? Date.now() : 0 }
      }
    })
    try {
      ctx.reportPhase?.('login')
      const login = await this.createLogin(settings.loginMethod).login({ session, settings, credentials, captcha, shouldStop: ctx.shouldStop, log })
      if (!login.ok || ctx.shouldStop()) {
        return { completedCount, watchedSeconds, reason: ctx.shouldStop() ? 'user' : 'error', error: { stage: 'login', code: 'login', message: login.message } }
      }

      ctx.reportPhase?.('loading-course')
      await session.navigate(settings.videoUrl)
      await page.waitForTimeout(SLEEP.extraLong)
      await captcha.checkAndHandle('course', '掌握度课程页面出现验证码，请完成验证')
      await scrollMasteryPanel(page)
      if (!(await readMasteryPoints(page)).length) {
        return { completedCount: 0, watchedSeconds: 0, reason: 'error', error: { stage: 'loading-course', code: 'course', message: '未加载到掌握度知识点，请检查登录状态及课程地址' } }
      }

      counting = true
      lastTick = Date.now()
      ctx.reportPhase?.('executing')
      for (;;) {
        if (ctx.shouldStop()) return { completedCount, watchedSeconds, reason: 'user' }
        await session.navigate(settings.videoUrl)
        await page.waitForTimeout(SLEEP.long)
        await scrollMasteryPanel(page)
        const points = await readMasteryPoints(page)
        if (!points.length) throw new Error('掌握度目录未加载，不能判定课程完成')
        const pending = points.filter(point => !(point.rate !== null ? point.rate >= 100 : /\b(?:green|blue)\b/i.test(point.status)))
        if (!pending.length) return { completedCount, watchedSeconds, reason: completedCount ? 'completed' : 'pool-exhausted' }

        for (const point of pending) {
          if (ctx.shouldStop()) return { completedCount, watchedSeconds, reason: 'user' }
          ctx.reportCurrentTitle(point.name)
          log.info(`掌握度练习开始: ${point.name}${point.rate === null ? '' : ` (${point.rate}%)`}`)
          const result = await this.practiceUntilFull(ctx, captcha, bank, point.name)
          checkpoint()
          if (!result.ok) return { completedCount, watchedSeconds, reason: ctx.shouldStop() ? 'user' : 'error', error: result.error }
          completedCount += 1
          ctx.reportVideoCompleted(point.name)
          log.info(`掌握度已刷满: ${point.name}`)
          if (this.timeLimitReached(settings.timeLimitMinutes, ctx.sessionWatchedSeconds())) return { completedCount, watchedSeconds, reason: 'time-limit' }
        }
      }
    } catch (error) {
      if (error instanceof RunnerAbort) return { completedCount, watchedSeconds, reason: error.reason }
      throw error
    }
  }

  private async practiceUntilFull(ctx: RunnerContext, captcha: CaptchaService, bank: MasteryQuestionBank, name: string): Promise<{ ok: true } | { ok: false; error: RunOutcome['error'] }> {
    const page = ctx.session.playwrightPage
    for (;;) {
      if (ctx.shouldStop()) return { ok: false, error: { stage: 'executing', code: 'execution', message: '用户停止运行' } }
      await ctx.session.navigate(ctx.settings.videoUrl)
      await page.waitForTimeout(SLEEP.long)
      await scrollMasteryPanel(page)
      const rateBefore = await readMasteryRate(page, name)
      if (rateBefore !== null && rateBefore >= 100) return { ok: true }
      if (!(await clickImproveMastery(page, name))) return { ok: false, error: { stage: 'executing', code: 'course', message: `未找到知识点“${name}”的提升掌握度入口` } }
      await page.waitForTimeout(SLEEP.long)
      await captcha.checkAndHandle('course', '掌握度练习出现验证码，请完成验证')

      const exam = await this.answerExamUntilCorrect(ctx, captcha, bank)
      if (!exam.ok) return exam
      await ctx.session.navigate(ctx.settings.videoUrl)
      await page.waitForTimeout(SLEEP.long)
      await scrollMasteryPanel(page)
      const rateAfter = await readMasteryRate(page, name)
      const pointAfter = (await readMasteryPoints(page)).find((point) => point.name === name)
      if (rateAfter !== null && rateAfter >= 100) return { ok: true }
      if (rateAfter === null && pointAfter && /\b(?:green|blue)\b/i.test(pointAfter.status)) return { ok: true }
      if (rateAfter === null) return { ok: false, error: { stage: 'executing', code: 'course', message: `无法确认知识点“${name}”是否已刷满` } }
      ctx.log.info(`知识点“${name}”当前掌握度 ${rateAfter}%，继续下一轮练习`)
    }
  }

  private async answerExamUntilCorrect(ctx: RunnerContext, captcha: CaptchaService, bank: MasteryQuestionBank): Promise<{ ok: true } | { ok: false; error: RunOutcome['error'] }> {
    const page = ctx.session.playwrightPage
    for (;;) {
      if (ctx.shouldStop()) return { ok: false, error: { stage: 'executing', code: 'execution', message: '用户停止运行' } }
      const questions = await this.readExamQuestions(page)
      if (!questions.length) return { ok: false, error: { stage: 'executing', code: 'course', message: '未读取到掌握度练习题目' } }
      const attempted: AttemptedQuestion[] = []
      for (let index = 0; index < questions.length; index += 1) {
        ctx.shouldStop()
        await this.goToQuestion(page, index)
        const current = await this.readExamQuestion(page, index) ?? questions[index]
        const question = bank.getOrCreate(current.content, current.type, current.optionTexts)
        const known = bank.knownIndices(question, current.optionTexts).length > 0
        const selected = bank.choose(question, current.optionTexts)
        await this.selectOptions(page, index, current.type, selected)
        attempted.push({ ...current, questionId: question.id, hadKnownAnswer: known })
      }
      if (!(await this.submitExam(page))) return { ok: false, error: { stage: 'executing', code: 'course', message: '未找到掌握度练习提交按钮' } }
      await page.waitForTimeout(SLEEP.long)
      await captcha.checkAndHandle('course', '掌握度结果页出现验证码，请完成验证')
      if (!(await this.openReview(page))) return { ok: false, error: { stage: 'executing', code: 'course', message: '无法进入掌握度作答解析页，无法学习题库答案' } }
      const analysis = await this.readAnalysis(page)
      if (analysis.correct.length + analysis.wrong.length !== attempted.length) throw new Error('解析页结果不完整，不能判定本轮作答成功')
      for (const item of analysis.correct) bank.saveCorrect(item.content, item.type, item.optionTexts, item.correctIndices)
      for (const wrongContent of analysis.wrong) {
        const item = attempted.find((candidate) => candidate.content === wrongContent)
        if (item) bank.markAttempt(item.questionId, item.hadKnownAnswer)
      }
      if (!analysis.wrong.length) return { ok: true }
      ctx.log.info(`掌握度解析判定 ${analysis.wrong.length} 道错题，题库试错次数已推进，继续答题`)
      if (!(await this.clickRetry(page))) return { ok: false, error: { stage: 'executing', code: 'course', message: '解析页未找到“重新答题”按钮' } }
      await page.waitForTimeout(SLEEP.long)
      await captcha.checkAndHandle('course', '重新答题时出现验证码，请完成验证')
    }
  }

  private async readExamQuestions(page: Page): Promise<ExamQuestionView[]> {
    const count = await page.locator('div.exam-item').count().catch(() => 0)
    const items: ExamQuestionView[] = []
    for (let index = 0; index < count; index += 1) {
      const item = page.locator('div.exam-item').nth(index)
      const parsed = await this.parseQuestion(item)
      if (!parsed) throw new Error(`第 ${index + 1} 道题无法识别，停止提交以避免题目错位`)
      items.push(parsed)
    }
    return items
  }

  private async readExamQuestion(page: Page, index: number): Promise<ExamQuestionView | null> {
    return this.parseQuestion(page.locator('div.exam-item').nth(index))
  }

  private async parseQuestion(item: Locator): Promise<ExamQuestionView | null> {
    const rawContent = (await item.locator('p.option-name').first().textContent().catch(() => '')) || (await item.locator('div.quest-title').first().textContent().catch(() => '')) || ''
    const content = rawContent.replace(/^\s*\d+[、.\s]+/, '').replace(/\s+/g, ' ').trim()
    if (!content) return null
    const typeText = (await item.locator('div.quest-type').first().textContent().catch(() => '')) ?? ''
    const type: MasteryQuestionType = typeText.includes('多选') ? 'multi' : typeText.includes('判断') ? 'judge' : 'single'
    const selector = type === 'multi' ? 'label.el-checkbox' : 'label.el-radio'
    const optionTexts = (await item.locator(selector).allTextContents().catch(() => [])).map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean)
    return optionTexts.length >= 2 ? { content, type, optionTexts } : null
  }

  private async goToQuestion(page: Page, index: number): Promise<void> {
    if (index === 0) return
    const nav = page.locator('div.answer-card div.list div.item').nth(index)
    if (await nav.count() && await nav.isVisible().catch(() => false)) await nav.click().catch(() => undefined)
    else await page.locator('div.next-btn').click().catch(() => undefined)
    await page.waitForTimeout(250)
  }

  private async selectOptions(page: Page, index: number, type: MasteryQuestionType, selected: number[]): Promise<void> {
    const item = page.locator('div.exam-item').nth(index)
    const labels = item.locator(type === 'multi' ? 'label.el-checkbox' : 'label.el-radio')
    for (let optionIndex = 0; optionIndex < await labels.count(); optionIndex++) {
      const label = labels.nth(optionIndex)
      const checked = (await label.getAttribute('class') ?? '').split(/\s+/).includes('is-checked')
      const wanted = selected.includes(optionIndex)
      if (checked === wanted || (type !== 'multi' && !wanted)) continue
      await label.click()
      await page.waitForTimeout(100)
    }
  }

  private async submitExam(page: Page): Promise<boolean> {
    const selectors = ['div.submit', 'div.header div.submit', 'button']
    for (const selector of selectors) {
      const buttons = page.locator(selector)
      for (let index = 0; index < await buttons.count().catch(() => 0); index += 1) {
        const button = buttons.nth(index)
        if (await button.isVisible().catch(() => false) && /提交|完成|交卷/.test((await button.textContent().catch(() => '')) ?? '')) { await button.click(); return true }
      }
    }
    return false
  }

  private async openReview(page: Page): Promise<boolean> {
    const links = page.locator('div.line1-count-link, div[class*="count-link"]')
    for (let index = 0; index < await links.count().catch(() => 0); index += 1) {
      const link = links.nth(index)
      if (await link.isVisible().catch(() => false)) { await link.click(); await page.waitForTimeout(SLEEP.long); return await page.locator('div.exam-preview').count() > 0 }
    }
    const textLink = page.getByText(/查看作答记录|解析/).first()
    if (await textLink.count() && await textLink.isVisible().catch(() => false)) { await textLink.click().catch(() => undefined); await page.waitForTimeout(SLEEP.long); return await page.locator('div.exam-preview').count() > 0 }
    return false
  }

  private async readAnalysis(page: Page): Promise<AnalysisResult> {
    const wrong: string[] = []
    const correct: Array<ExamQuestionView & { correctIndices: number[] }> = []
    const items = page.locator('div.exam-preview div.exam-item')
    for (let index = 0; index < await items.count().catch(() => 0); index += 1) {
      const item = items.nth(index); const question = await this.parseQuestion(item); if (!question) continue
      if (!await item.locator('div.question-result').count()) continue
      const isWrong = await item.locator('div.question-result.error').count() > 0
      const selector = question.type === 'multi' ? 'label.el-checkbox' : 'label.el-radio'
      const labels = item.locator(selector); const checked: number[] = []
      for (let optionIndex = 0; optionIndex < await labels.count(); optionIndex += 1) if ((await labels.nth(optionIndex).getAttribute('class').catch(() => ''))?.includes('is-checked')) checked.push(optionIndex)
      if (isWrong) wrong.push(question.content)
      else if (checked.length) correct.push({ ...question, correctIndices: checked })
    }
    return { wrong, correct }
  }

  private async clickRetry(page: Page): Promise<boolean> {
    const buttons = page.locator('div.submit, div.header div.submit, button')
    for (let index = 0; index < await buttons.count().catch(() => 0); index += 1) {
      const button = buttons.nth(index)
      if (await button.isVisible().catch(() => false) && /重新答题/.test((await button.textContent().catch(() => '')) ?? '')) { await button.click(); return true }
    }
    return false
  }

  private timeLimitReached(limitMinutes: number, seconds: number): boolean { return limitMinutes > 0 && seconds >= limitMinutes * 60 }
}
