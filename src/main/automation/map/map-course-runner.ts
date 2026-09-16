/**
 * 图谱课 Runner。移植自 v1 `src/bot/map_course.py::MapCourseBot`。
 *
 * 与经典课程是**两套独立业务**，不共用循环（handoff §9）。
 *
 * 相对 v1 的修正：
 *  - 生命周期只收尾一次。v1 的 `_run_map_mode` 在 try / except 里各调一次
 *    `on_bot_stop()`，finally 又关一次 driver（docs/V1_BASELINE.md §7.4）。
 *    v2 的收尾全部由 BotService 统一负责，Runner 只管返回结果（handoff §28）。
 *  - URL 解析换成结构化解析，失败时给出可操作的提示（`map/url.ts`）。
 *  - 支持「图谱课 + 转录」组合：视频资源经 ctx.media 上报开始/结束
 *    （handoff §28「Map + Transcription」）。
 */

import type { LoginMethod, TaskMode } from '@shared/types'
import type { CourseRunner, RunOutcome, RunnerContext } from '../runner'
import {
  MapCourseNavigator,
  NO_VIDEO_MAX_STREAK,
  VIDEO_CHECK_INTERVAL_MS,
  VIDEO_MAX_WAIT_MS,
  ZERO_DURATION_MAX_STREAK,
  type KnowledgeItem,
  type ResourceItem
} from './navigator'
import { MapUrlError, knowledgeStudyUrl, learnPageUrl, parseMapCourseUrl } from './url'
import { createLoginProvider, type LoginProvider } from '../login/provider'
import { CaptchaService } from '../captcha'
import { SLEEP } from '../constants'

export class MapCourseRunner implements CourseRunner {
  readonly mode: TaskMode = 'map'

  /** 同 ClassicCourseRunner：登录提供方可注入，便于集成测试 */
  constructor(
    private readonly createLogin: (method: LoginMethod) => LoginProvider = createLoginProvider
  ) {}

  async run(ctx: RunnerContext): Promise<RunOutcome> {
    const { log, session, settings, credentials } = ctx
    const page = session.playwrightPage

    let completedCount = 0
    let watchedSeconds = 0

    const captcha = new CaptchaService({
      session,
      requestCaptcha: ctx.requestCaptcha,
      shouldStop: ctx.shouldStop,
      log
    })
    const navigator = new MapCourseNavigator(page, log)

    // ------------------------------------------------------------ 1. 解析 URL
    let ref
    try {
      ref = parseMapCourseUrl(settings.videoUrl)
    } catch (error) {
      if (error instanceof MapUrlError) {
        log.error(error.message)
        return { completedCount: 0, watchedSeconds: 0, reason: 'error' }
      }
      throw error
    }
    log.info(`图谱课: courseId=${ref.courseId} mapId=${ref.mapId} mapUid=${ref.mapUid || '(无)'}`)

    // ------------------------------------------------------------ 2. 登录
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

    // -------------------------------------------------------- 3. 进图谱页
    if (!ref.mapId) {
      // abilityAgent 只是入口页，拿不到 mapId 就没法枚举知识项
      log.error(
        '当前地址是图谱课入口页（abilityAgent），缺少图谱 ID。\n' +
          '请从浏览器里打开某个知识项后再复制地址，形如：\n' +
          '  .../singleCourse/knowledgeStudy/{课程ID}/{图谱ID}?mapUid=xxx'
      )
      return { completedCount: 0, watchedSeconds: 0, reason: 'error' }
    }

    await session.navigate(knowledgeStudyUrl(ref))
    await page.waitForTimeout(SLEEP.extraLong)
    await captcha.checkAndHandle('course', '打开图谱页时出现验证码，请完成验证')

    const items = await navigator.getKnowledgeItems()
    if (items.length === 0) {
      log.warn('未解析到知识项，请检查页面结构')
      return { completedCount: 0, watchedSeconds: 0, reason: 'pool-exhausted' }
    }

    const total = items.length
    let skipped = 0
    let index = 0

    // ---------------------------------------------------------- 4. 遍历知识项
    for (const item of items) {
      index += 1
      if (ctx.shouldStop()) {
        log.info('收到停止信号，图谱刷课停止')
        return { completedCount, watchedSeconds, reason: 'user' }
      }

      if (settings.skipCompleted && item.progress >= 100) {
        log.info(`跳过已完成: ${item.title} (${item.progress}%)`)
        skipped += 1
        completedCount += 1
        continue
      }

      log.info(`==== [${index}/${total}] 处理知识项: ${item.title} (进度 ${item.progress}%) ====`)
      ctx.reportCurrentTitle(item.title)

      try {
        const result = await this.processKnowledgeItem(ctx, navigator, ref, item, captcha)
        watchedSeconds += result.watchedSeconds
        if (result.ok) completedCount += 1
      } catch (error) {
        log.error(`处理知识项失败「${item.title}」: ${String(error)}`)
      }

      if (this.timeLimitReached(settings.timeLimitMinutes, ctx.sessionWatchedSeconds())) {
        log.info('已达到单次时长上限，图谱刷课停止')
        return { completedCount, watchedSeconds, reason: 'time-limit' }
      }
    }

    log.info(`图谱刷课结束: 完成 ${completedCount}/${total}（跳过 ${skipped}）`)

    const reason: RunOutcome['reason'] = skipped === total ? 'pool-exhausted' : 'completed'
    return { completedCount, watchedSeconds, reason }
  }

  // ---------------------------------------------------------------- 单个知识项

  private async processKnowledgeItem(
    ctx: RunnerContext,
    navigator: MapCourseNavigator,
    ref: ReturnType<typeof parseMapCourseUrl>,
    item: KnowledgeItem,
    captcha: CaptchaService
  ): Promise<{ ok: boolean; watchedSeconds: number }> {
    const { log, session } = ctx
    const page = session.playwrightPage

    const url = learnPageUrl(ref, item.knowledgeId)
    log.info(`进入学习页: ${url}`)
    await session.navigate(url)
    await page.waitForTimeout(SLEEP.extraLong)
    await captcha.checkAndHandle('course', '打开学习页时出现验证码，请完成验证')

    const resources = await navigator.getMustLearnResources()
    if (resources.length === 0) {
      log.info(`知识项「${item.title}」无必学资源`)
      return { ok: true, watchedSeconds: 0 }
    }

    let watchedSeconds = 0

    for (const resource of resources) {
      if (ctx.shouldStop()) return { ok: false, watchedSeconds }

      if (resource.done && ctx.settings.skipCompleted) {
        log.info(`跳过已完成资源: ${resource.title}`)
        continue
      }

      const result = await this.playResource(ctx, navigator, resource)
      watchedSeconds += result.watchedSeconds
    }

    ctx.reportVideoCompleted(item.title)
    return { ok: true, watchedSeconds }
  }

  private async playResource(
    ctx: RunnerContext,
    navigator: MapCourseNavigator,
    resource: ResourceItem
  ): Promise<{ watchedSeconds: number }> {
    const { log } = ctx
    log.info(`开始处理资源: ${resource.title}`)

    if (!(await navigator.openResource(resource))) {
      log.error(`打开资源失败: ${resource.title}`)
      return { watchedSeconds: 0 }
    }

    if (resource.type !== 'video') {
      await navigator.holdNonVideo(resource)
      return { watchedSeconds: 0 }
    }

    // 打开后验证：必须出现真实可播的视频（duration>0），否则按非视频处理。
    // 卡片 class 全都一样，最初的类型判定可能不准，这一步是兜底。
    await ctx.session.playwrightPage.waitForTimeout(SLEEP.long)
    const probe = await navigator.getVideoInfo()
    if (!probe.found || probe.duration <= 0) {
      log.warn(`资源未出现真实视频（可能被误判），按非视频处理: ${resource.title}`)
      await navigator.holdNonVideo(resource)
      return { watchedSeconds: 0 }
    }

    if (ctx.media) {
      await ctx.media.onVideoBegin(ctx.session, resource.title)
    }

    const monitor = await this.monitorVideo(ctx, navigator, resource.title)

    if (ctx.media) {
      await ctx.media.onVideoEnd(resource.title)
    }

    ctx.reportVideoWatched(monitor.elapsedSeconds)
    return { watchedSeconds: monitor.elapsedSeconds }
  }

  // ---------------------------------------------------------------- 视频监控

  /**
   * 监控视频播放直到结束，带兜底防卡死。
   * 三个兜底条件与 v1 一致：找不到视频、duration 恒为 0、总时长超限。
   */
  private async monitorVideo(
    ctx: RunnerContext,
    navigator: MapCourseNavigator,
    title: string
  ): Promise<{ ended: boolean; elapsedSeconds: number }> {
    const { log } = ctx
    const page = ctx.session.playwrightPage

    log.info(`视频播放监控开始: ${title}`)

    let elapsed = 0
    let lastPlaying = 0
    let lastLog = 0
    let noVideoStreak = 0
    let zeroDurationStreak = 0

    while (elapsed < VIDEO_MAX_WAIT_MS) {
      if (ctx.shouldStop()) {
        log.info(`停止信号，退出视频监控: ${title}`)
        return { ended: false, elapsedSeconds: elapsed }
      }

      const info = await navigator.getVideoInfo()

      if (info.found) {
        noVideoStreak = 0

        if (info.duration <= 0) {
          zeroDurationStreak += 1
          if (zeroDurationStreak >= ZERO_DURATION_MAX_STREAK) {
            log.warn(`视频时长异常(0s) 持续 ${zeroDurationStreak} 次，退出监控: ${title}`)
            return { ended: false, elapsedSeconds: elapsed }
          }
        } else {
          zeroDurationStreak = 0
        }

        if (info.ended || (info.duration > 0 && info.current >= info.duration - 1)) {
          log.info(`视频播放完毕: ${title} (${info.current.toFixed(0)}/${info.duration.toFixed(0)}s)`)
          return { ended: true, elapsedSeconds: elapsed }
        }

        if (info.paused) {
          if (elapsed - lastPlaying > 30_000) {
            log.info(`视频暂停 ${Math.round(elapsed / 1000)}s，尝试恢复播放: ${title}`)
            await navigator.resumeVideo()
            lastPlaying = elapsed
          }
        } else {
          lastPlaying = elapsed
        }
      } else {
        noVideoStreak += 1
        if (noVideoStreak >= NO_VIDEO_MAX_STREAK) {
          log.warn(`未找到视频元素持续 ${noVideoStreak} 次，退出监控: ${title}`)
          return { ended: false, elapsedSeconds: elapsed }
        }
        log.debug('未找到 video 元素')
      }

      if (elapsed - lastLog >= 60_000) {
        lastLog = elapsed
        log.info(`视频进度: ${info.current.toFixed(0)}/${info.duration.toFixed(0)}s (${title})`)
      }

      await page.waitForTimeout(VIDEO_CHECK_INTERVAL_MS)
      elapsed += VIDEO_CHECK_INTERVAL_MS
    }

    log.warn(`视频监控超时: ${title}`)
    return { ended: false, elapsedSeconds: elapsed }
  }

  private timeLimitReached(limitMinutes: number, sessionSeconds: number): boolean {
    return limitMinutes > 0 && sessionSeconds >= limitMinutes * 60
  }
}
