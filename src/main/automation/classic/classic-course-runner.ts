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

import type { Locator } from 'playwright-core'
import type { TaskMode, AppSettings, LoginMethod } from '@shared/types'
import type { CourseRunner, RunOutcome, RunnerContext } from '../runner'
import { ClassicCourseNavigator, type NextVideoResult } from './navigator'
import { ClassicPageInteractions } from './page-interactions'
import { VideoController } from './video-controller'
import { CaptchaService } from '../captcha'
import { QuizService } from '../quiz'
import { createLoginProvider, type LoginProvider } from '../login/provider'
import { isLoginUrl } from '../login/session-check'
import {
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
    private readonly createLogin: (method: LoginMethod) => LoginProvider = createLoginProvider
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
    const interactions = new ClassicPageInteractions(page, log, quiz, ctx.shouldStop, ctx.diagnostics, () => ctx.media?.hasActiveRecording() ?? false)
    const navigator = new ClassicCourseNavigator(page, log, captcha, quiz, settings.skipCompleted, interactions)

    // ------------------------------------------------------------ 1. 登录
    ctx.reportPhase?.('login')
    const provider = this.createLogin(settings.loginMethod)
    const loginResult = await provider.login({
      session,
      settings,
      credentials,
      captcha,
      shouldStop: ctx.shouldStop,
      log
    })
    if (!loginResult.ok || ctx.shouldStop()) {
      log.error(`登录未完成，停止运行：${loginResult.message}`)
      return { completedCount: 0, watchedSeconds: 0, reason: ctx.shouldStop() ? 'user' : 'error', error: { stage: 'login', code: 'login', message: loginResult.message } }
    }
    log.info(`登录结果: ${loginResult.message}`)
    ctx.reportPhase?.('loading-course')

    // -------------------------------------------------------- 2. 进课程页
    const initial = settings.videoUrl ? await navigator.navigate(settings.videoUrl) : await navigator.settle(undefined, ctx.shouldStop)
    if (initial.state === 'stopped' || ctx.shouldStop()) return { completedCount, watchedSeconds, reason: 'user' }
    if (initial.state === 'failed') return { completedCount, watchedSeconds, reason: 'error', error: { stage: 'loading-course', code: 'course', message: initial.message } }

    // ------------------------------------------------------ 3. 定位起点
    let next = settings.fromLastProgress && settings.courseNote
      ? await this.startFromLastProgress(ctx, navigator)
      : await navigator.firstPlayable()

    if (!next) {
      if (initial.state === 'recover') {
        const failure = await interactions.failure(`无法定位课程以恢复进度提交异常：${initial.message}`)
        return {completedCount,watchedSeconds,reason:'error',error:{stage:'loading-course',code:'course',message:failure.message}}
      }
      // 停在登录页说明"登录没成功"，比"没有待处理的视频"有用得多
      if (isLoginUrl(page.url())) {
        log.error(`没有待处理的视频：当前停在登录页（${page.url()}），登录可能没有成功`)
      } else {
        log.info('没有待处理的视频')
      }
      return { completedCount: 0, watchedSeconds: 0, reason: isLoginUrl(page.url()) ? 'error' : 'pool-exhausted', ...(isLoginUrl(page.url()) ? { error: { stage: 'loading-course' as const, code: 'course' as const, message: '课程鉴权失败，请重新登录' } } : {}) }
    }

    const label = settings.skipCompleted ? '未完成' : '全部'
    log.info(`开始依次处理${label}课程视频`)

    // ---------------------------------------------------------- 4. 主循环
    ctx.reportPhase?.('executing')
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
        const message = navigator.lastClickError ?? `课程目录持续被遮挡或不可点击「${next.title}」，请关闭遮挡浮层后重新运行`
        log.error(message)
        return { completedCount, watchedSeconds, reason: 'error', error: { stage: 'executing', code: 'course', message } }
      }

      // ---- 仅转录模式：下载音轨转写，不播放视频 ----
      if (ctx.media && this.isTranscribeOnly(settings)) {
        const ok = await ctx.media.transcribeOnly(session, next.title)
        const settled = await this.ready(ctx, navigator, next.locator, next.title)
        if (settled.stopped) { reason='user'; break }
        if (settled.error) return {completedCount,watchedSeconds,reason:'error',error:{stage:'executing',code:'course',message:settled.error}}
        completedCount += ok ? 1 : 0
        if (!ok) log.warn(`转录失败: ${next.title}`)
        processed.add(next.index)
      } else {
        // ---- 常规刷课：播放并监控 ----
        if (ctx.media) {
          await ctx.media.onVideoBegin(session, next.title)
        }

        const monitor = await this.monitorVideo(ctx, video, next.title, navigator, next.locator)

        if (monitor.stopped) {
          reason = 'user'
          watchedSeconds += monitor.elapsedSeconds
          ctx.reportVideoWatched(monitor.elapsedSeconds)
          break
        }

        watchedSeconds += monitor.elapsedSeconds
        ctx.reportVideoWatched(monitor.elapsedSeconds)

        if (monitor.error) {
          return { completedCount, watchedSeconds, reason: 'error', error: { stage: 'executing', code: 'course', message: monitor.error } }
        }

        completedCount += 1
        ctx.reportVideoCompleted(next.title)
        processed.add(next.index)

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
    return navigator.clickVideoWithRetry(locator, title, ctx.shouldStop)
  }

  private async ready(ctx:RunnerContext,navigator:ClassicCourseNavigator,target:Locator,title:string):Promise<{stopped?:boolean;error?:string;recovered?:boolean}>{
    const result=await navigator.settle(target,ctx.shouldStop)
    if(ctx.shouldStop()||result.state==='stopped')return {stopped:true}
    if(result.state==='failed')return {error:result.message}
    if(result.state==='recover'){
      const restored=await navigator.clickVideoWithRetry(target,title,ctx.shouldStop)
      if(ctx.shouldStop())return {stopped:true}
      if(!restored)return {error:navigator.lastClickError??'课程页面恢复失败'}
      return {recovered:true}
    }
    return {}
  }

  private async monitorVideo(
    ctx:RunnerContext,video:VideoController,title:string,navigator:ClassicCourseNavigator,currentLesson:Locator
  ):Promise<{ended:boolean;stopped:boolean;elapsedSeconds:number;error?:string}>{
    const page=ctx.session.playwrightPage
    let elapsed=0,lastProgressLog=0,lastAutoplayGuard=0
    const outcome=(error?:string,stopped=false)=>({ended:false,stopped,elapsedSeconds:elapsed/1000,error})
    const initial=await this.ready(ctx,navigator,currentLesson,title)
    if(initial.stopped||initial.error)return outcome(initial.error,initial.stopped)
    if(!await video.isPlaying()){
      await video.play()
      await page.waitForTimeout(SLEEP.long)
    }
    while(elapsed<TIMEOUT.videoMonitorMax){
      if(ctx.shouldStop())return outcome(undefined,true)
      const ready=await this.ready(ctx,navigator,currentLesson,title)
      if(ready.stopped||ready.error)return outcome(ready.error,ready.stopped)
      if(ready.recovered&&!await video.isPlaying())await video.play()
      const state=await video.readState()
      if(state.ended||(state.durationSeconds>0&&state.currentSeconds>=state.durationSeconds-1)){
        // A popup arriving on the last frame must be resolved before continuation is persisted.
        const final=await this.ready(ctx,navigator,currentLesson,title)
        if(final.stopped||final.error)return outcome(final.error,final.stopped)
        if(final.recovered)continue
        const verified=await video.readState()
        if(verified.ended||(verified.durationSeconds>0&&verified.currentSeconds>=verified.durationSeconds-1)){
          ctx.log.info(`视频播放完毕: ${title}`)
          return {ended:true,stopped:false,elapsedSeconds:elapsed/1000}
        }
      }
      if(elapsed-lastAutoplayGuard>=INTERVAL.autoplayGuard){
        lastAutoplayGuard=elapsed
        if(state.exists&&state.paused&&!state.ended)await video.play()
      }
      if(elapsed-lastProgressLog>=INTERVAL.progressLog){
        lastProgressLog=elapsed
        ctx.log.info(`进度: ${state.currentSeconds.toFixed(0)}/${state.durationSeconds.toFixed(0)}s`)
      }
      await page.waitForTimeout(INTERVAL.videoMonitor)
      elapsed+=INTERVAL.videoMonitor
    }
    if(ctx.shouldStop())return outcome(undefined,true)
    const failure=await navigator.interactions.failure(`视频监控超时，当前视频不计入完成：${title}`)
    return outcome(failure.message)
  }
}
