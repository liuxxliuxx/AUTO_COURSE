/**
 * 传统课程 Runner。移植自 v1 `src/bot/bot_core.py::run`（非图谱分支）。
 *
 * 流程：
 *   登录 → 进课程页 → 找到第一个待处理视频 → 循环 { 点击 → 监控 → 记账 → 找下一个 }
 *
 * 相对 v1 的行为修正（handoff §28「Classic Course 回环」）：
 *   v1 的循环结束条件依赖 `get_next_video_after` 返回 None；在
 *   skip_completed=false 时列表里每一项都"可播放"，于是看完最后一个会
 *   环形回到第一个，无限刷下去，直到撞上时长上限。
 *   v2 显式记录本次运行已处理过的**列表下标**：一旦下一个候选已经处理过，
 *   立即判定为「本轮已跑完」并结束。终止条件不再依赖 DOM 的偶然变化。
 */

import type { TaskMode, AppSettings } from '@shared/types'
import type { CourseRunner, RunOutcome, RunnerContext } from '../runner'
import { ClassicCourseNavigator, type NextVideoResult } from './navigator'
import { VideoController } from './video-controller'
import { CaptchaService } from '../captcha'
import { QuizService } from '../quiz'
import { createLoginProvider, type LoginProvider } from '../login/provider'
import { isLoginUrl } from '../login/session-check'
import {
  CLICK_VIDEO_MAX_RETRIES,
  INTERVAL,
  SLEEP,
  TIMEOUT
} from '../constants'

export class ClassicCourseRunner implements CourseRunner {
  readonly mode: TaskMode = 'classic'

  /**
   * 登录提供方可注入 —— 集成测试要绕过真实站点登录，
   * 但又必须让主循环（点击 → 监控 → 终止判定）真实跑起来。
   */
  constructor(
    private readonly createLogin: (method: 'zhihuishu' | 'upc') => LoginProvider = createLoginProvider
  ) {}

  async run(ctx: RunnerContext): Promise<RunOutcome> {
    const { log, session, settings, credentials } = ctx
    const page = session.playwrightPage

    let completedCount = 0
    let watchedSeconds = 0
    let reason: RunOutcome['reason'] = 'completed'

    // 本次运行已处理过的视频在列表中的下标
    const processed = new Set<number>()

    const captcha = new CaptchaService({
      session,
      requestCaptcha: ctx.requestCaptcha,
      shouldStop: ctx.shouldStop,
      log
    })
    const quiz = new QuizService(page, log)
    const video = new VideoController(page, log)
    const navigator = new ClassicCourseNavigator(page, log, captcha, quiz, settings.skipCompleted)

    // ------------------------------------------------------------ 1. 登录
    const provider = this.createLogin(settings.loginMethod)
    const loginResult = await provider.login({
      session,
      settings,
      credentials,
      captcha,
      shouldStop: ctx.shouldStop,
      log
    })
    if (!loginResult.ok && ctx.shouldStop()) {
      return { completedCount: 0, watchedSeconds: 0, reason: 'user' }
    }
    log.info(`登录结果: ${loginResult.message}`)

    // -------------------------------------------------------- 2. 进课程页
    if (settings.videoUrl) {
      await navigator.navigate(settings.videoUrl)
    }

    // ------------------------------------------------------ 3. 定位起点
    let next = settings.fromLastProgress && settings.courseNote
      ? await this.startFromLastProgress(ctx, navigator)
      : await navigator.firstPlayable()

    if (!next) {
      // 停在登录页说明"登录没成功"，比"没有待处理的视频"有用得多
      if (isLoginUrl(page.url())) {
        log.error(`没有待处理的视频：当前停在登录页（${page.url()}），登录可能没有成功`)
      } else {
        log.info('没有待处理的视频')
      }
      return { completedCount: 0, watchedSeconds: 0, reason: 'pool-exhausted' }
    }

    const label = settings.skipCompleted ? '未完成' : '全部'
    log.info(`开始依次处理${label}课程视频`)

    // ---------------------------------------------------------- 4. 主循环
    let sequence = 0
    while (next) {
      if (ctx.shouldStop()) {
        reason = 'user'
        break
      }

      // —— 显式终止条件：本轮已经处理过这一项，说明绕回起点了 ——
      if (processed.has(next.index)) {
        log.info('已回到本轮起点，结束刷课')
        reason = 'completed'
        break
      }

      sequence += 1
      log.info('='.repeat(40))
      log.info(`[${sequence}] 正在处理: ${next.title}`)
      ctx.reportCurrentTitle(next.title)

      const clicked = await this.clickWithRetry(ctx, navigator, next.locator, next.title)
      if (!clicked) {
        if (ctx.shouldStop()) {
          reason = 'user'
          break
        }
        log.warn(`跳过无法点击的视频: ${next.title}`)
        processed.add(next.index)
        next = await navigator.nextVideoAfter(next.title)
        continue
      }

      // ---- 仅转录模式：下载音轨转写，不播放视频 ----
      if (ctx.media && this.isTranscribeOnly(settings)) {
        await this.handleQuizAndCaptcha(ctx, quiz, captcha, video)
        const ok = await ctx.media.transcribeOnly(session, next.title)
        completedCount += ok ? 1 : 0
        if (!ok) log.warn(`转录失败: ${next.title}`)
        processed.add(next.index)
      } else {
        // ---- 常规刷课：播放并监控 ----
        if (ctx.media) {
          await ctx.media.onVideoBegin(session, next.title)
        }

        const monitor = await this.monitorVideo(ctx, video, quiz, captcha, next.title)

        if (monitor.stopped) {
          reason = 'user'
          watchedSeconds += monitor.elapsedSeconds
          ctx.reportVideoWatched(monitor.elapsedSeconds)
          break
        }

        watchedSeconds += monitor.elapsedSeconds
        ctx.reportVideoWatched(monitor.elapsedSeconds)

        completedCount += 1
        ctx.reportVideoCompleted(next.title)
        processed.add(next.index)

        if (!monitor.ended) {
          log.warn(`视频监控未正常结束（超时），仍计入完成: ${next.title}`)
        }

        if (ctx.media) {
          await ctx.media.onVideoEnd(next.title)
        }
      }

      // ---- 单次时长上限 ----
      if (this.timeLimitReached(settings, ctx.sessionWatchedSeconds())) {
        reason = 'time-limit'
        break
      }

      await page.waitForTimeout(SLEEP.extraLong)
      next = await navigator.nextVideoAfter(next.title)
    }

    log.info('='.repeat(50))
    log.info(`本次运行完成 ${completedCount} 个课程视频`)
    log.info('='.repeat(50))

    return { completedCount, watchedSeconds, reason }
  }

  // ---------------------------------------------------------------- 辅助

  private isTranscribeOnly(settings: AppSettings): boolean {
    return !settings.brushEnabled && !settings.mapMode
  }

  private timeLimitReached(settings: AppSettings, sessionSeconds: number): boolean {
    const limit = settings.timeLimitMinutes
    return limit > 0 && sessionSeconds >= limit * 60
  }

  /** 从上次进度继续：定位到上次完成的视频之后。 */
  private async startFromLastProgress(
    ctx: RunnerContext,
    navigator: ClassicCourseNavigator
  ): Promise<NextVideoResult | null> {
    const { lastVideoTitle } = ctx
    if (!lastVideoTitle) return navigator.firstPlayable()

    ctx.log.info(`从上次进度开始: 「${lastVideoTitle}」之后`)
    const next = await navigator.nextVideoAfter(lastVideoTitle)
    // 上次的标题在当前列表里找不到（课程改版/换了课程）时退回从头开始
    return next ?? navigator.firstPlayable()
  }

  private async clickWithRetry(
    ctx: RunnerContext,
    navigator: ClassicCourseNavigator,
    locator: Parameters<ClassicCourseNavigator['clickVideo']>[0],
    title: string
  ): Promise<boolean> {
    let retry = 0
    while (!(await navigator.clickVideo(locator, title))) {
      if (ctx.shouldStop()) return false
      retry += 1
      if (retry > CLICK_VIDEO_MAX_RETRIES) {
        ctx.log.error(`点击「${title}」连续失败 ${retry} 次，放弃`)
        return false
      }
      ctx.log.warn(`点击课程失败（第 ${retry} 次重试），交叉处理弹窗: ${title}`)
      await navigator.handleInitialDialogs()
      await ctx.session.playwrightPage.waitForTimeout(SLEEP.medium)
    }
    return true
  }

  /** 进入视频后立刻处理一次弹题/验证码（点击课程后弹题常会自动弹出）。 */
  private async handleQuizAndCaptcha(
    ctx: RunnerContext,
    quiz: QuizService,
    captcha: CaptchaService,
    _video: VideoController
  ): Promise<void> {
    const dialog = await quiz.findDialog()
    if (dialog) {
      ctx.log.info('检测到弹题测验')
      await quiz.handle(dialog)
      await ctx.session.playwrightPage.waitForTimeout(SLEEP.long)
    }
    await captcha.checkAndHandle('video', '播放过程中出现验证码，请完成验证')
  }

  // ------------------------------------------------------------ 视频监控

  /**
   * 监控单个视频直到结束。
   *
   * 与 v1 `_monitor_single_video` 等价：同一循环里处理弹题、验证码、
   * 暂停恢复与结束检测；elapsed 用真实耗时累加（不信任 DOM 时长，
   * 用户拖进度条不会让时长虚增）。
   */
  private async monitorVideo(
    ctx: RunnerContext,
    video: VideoController,
    quiz: QuizService,
    captcha: CaptchaService,
    title: string
  ): Promise<{ ended: boolean; stopped: boolean; elapsedSeconds: number }> {
    const { log, session } = ctx
    const page = session.playwrightPage

    log.info(`开始监控视频播放: ${title}`)

    let elapsed = 0
    let lastCaptchaCheck = -INTERVAL.captcha
    let lastAutoplayGuard = 0
    let lastProgressLog = 0

    // 确保视频在播放
    if (!(await video.isPlaying())) {
      await video.play()
      await page.waitForTimeout(SLEEP.long)
      if (!(await video.isPlaying())) {
        await video.play()
        await page.waitForTimeout(SLEEP.extraLong)
      }
    }

    while (elapsed < TIMEOUT.videoMonitorMax) {
      if (ctx.shouldStop()) {
        log.info('收到停止信号，退出视频监控')
        return { ended: false, stopped: true, elapsedSeconds: elapsed / 1000 }
      }

      // ---- 弹题（高频）----
      const dialog = await quiz.findDialog()
      if (dialog) {
        log.info('检测到弹题测验')
        await quiz.handle(dialog)
        await page.waitForTimeout(SLEEP.medium)
        if (!(await video.isPlaying()) && !(await video.isEnded())) {
          await video.play()
        }
        elapsed += SLEEP.medium
        continue
      }

      // ---- 验证码（低频，避免误报）----
      if (elapsed - lastCaptchaCheck >= INTERVAL.captcha) {
        lastCaptchaCheck = elapsed
        const handled = await captcha.checkAndHandle('video', '视频播放过程中出现验证码，请完成验证')
        if (handled) {
          await page.waitForTimeout(SLEEP.long)
          if (!(await video.isPlaying()) && !(await video.isEnded())) {
            await video.play()
          }
          continue
        }
      }

      const state = await video.readState()

      // ---- 结束检测 ----
      if (state.ended || (state.durationSeconds > 0 && state.currentSeconds >= state.durationSeconds - 1)) {
        log.info(
          `视频播放完毕: ${title} (${state.currentSeconds.toFixed(0)}/${state.durationSeconds.toFixed(0)}s)`
        )
        return { ended: true, stopped: false, elapsedSeconds: elapsed / 1000 }
      }

      // ---- 防止自动暂停 ----
      if (elapsed - lastAutoplayGuard >= INTERVAL.autoplayGuard) {
        lastAutoplayGuard = elapsed
        if (state.exists && state.paused && !state.ended) {
          log.debug('视频已暂停，尝试恢复播放')
          await video.play()
        }
      }

      // ---- 定期进度日志 ----
      if (elapsed - lastProgressLog >= INTERVAL.progressLog) {
        lastProgressLog = elapsed
        log.info(
          `进度: ${state.currentSeconds.toFixed(0)}/${state.durationSeconds.toFixed(0)}s (已监控 ${elapsed / 1000}s)`
        )
      }

      await page.waitForTimeout(INTERVAL.videoMonitor)
      elapsed += INTERVAL.videoMonitor
    }

    log.warn(`视频监控超时: ${title}`)
    return { ended: false, stopped: false, elapsedSeconds: elapsed / 1000 }
  }
}
