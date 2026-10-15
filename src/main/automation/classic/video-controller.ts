/**
 * 视频播放控制。移植自 v1 `src/bot/video.py`。
 *
 * v1 的 play() 有 4 级策略，v2 保留同样的思路：
 *   1. 大播放按钮（ActionChains 点击 → Playwright 的 click 本身就带可交互性检查）
 *   2. 控制栏播放按钮
 *   3. 点击 <video> 本体
 *   4. 直接调 video.play()
 *
 * 另外加了一步**原生恢复**（放在最前面）：视频已经播过一段（`currentTime > 0`）
 * 又被暂停时，直接调 `video.play()` 是毫秒级、且不产生任何点击事件 ——
 * "暂停后恢复"（刚开始/刚关掉弹题）走这条路，不再去点按钮。
 *
 * **所有点击都必须是可信事件**：v1 的四个策略全是真实的 WebDriver 点击
 * （ActionChains / element.click），而学习页在 `#container` 上装了防脚本守卫，
 * 收到 `isTrusted === false` 的点击就弹「检测到异常脚本…」并在 3 秒后跳回学堂
 * 首页。v2 早期版本在这里兜底用了 `element.click()`，正是刷课跑几秒就跳首页的
 * 原因（详见 docs/MIGRATION.md）。现在只使用正常 Playwright 点击，
 * 不强制穿透遮挡，也不派发合成点击。
 *
 * 等待策略：可见性探测与播放态判定都改成**预算内轮询**（`firstVisibleWithin` /
 * `waitForPlaying`），命中即返回。旧实现里"每个候选各等一个超时 + 每级策略后固定
 * 睡 1 秒"，实测让"恢复播放"要 18 秒；现在同样的路径是毫秒级。
 */

import type { Locator, Page } from 'playwright-core'
import {
  PLAY_BTN_CSS,
  PLAY_CONTROL_BTN_CSS,
  PLAY_PROBE,
  VIDEO_ELEMENT_CSS,
  VIDEO_SRC_EXTRACTION_JS
} from '../constants'
import { firstVisibleWithin, isVisible } from '../locators'
import type { Logger } from '../../services/logger'

export interface VideoProgress {
  current: string
  duration: string
  currentSeconds: number
  durationSeconds: number
  paused: boolean
  ended: boolean
}

export class VideoController {
  constructor(
    private readonly page: Page,
    private readonly log: Logger
  ) {}

  private get video(): Locator {
    return this.page.locator(VIDEO_ELEMENT_CSS).first()
  }

  /**
   * 尝试开始播放。返回是否成功进入播放状态。
   * 每级策略后都读一次真实播放状态，不做"点了就算成功"的假设。
   */
  async play(): Promise<boolean> {
    if (await this.isPlaying()) return true

    // 策略 0：暂停后恢复 —— 原生 play() 最快，且完全不产生点击事件
    if (await this.tryNativeResume()) return true

    // 策略 1：大播放按钮
    const bigPlay = await firstVisibleWithin(this.page, PLAY_BTN_CSS, PLAY_PROBE.bigButton)
    if (bigPlay && (await this.tryClick(bigPlay)) && (await this.waitForPlaying())) {
      this.log.info('已通过大播放按钮开始播放')
      return true
    }

    // 策略 2：控制栏播放按钮
    const ctrl = await firstVisibleWithin(this.page, [PLAY_CONTROL_BTN_CSS], PLAY_PROBE.control)
    if (ctrl && (await this.tryClick(ctrl)) && (await this.waitForPlaying())) {
      this.log.info('已通过控制栏播放按钮开始播放')
      return true
    }

    // 策略 3：点击 video 本体
    if ((await this.tryClick(this.video)) && (await this.waitForPlaying())) {
      this.log.info('已通过点击 video 元素开始播放')
      return true
    }

    // 策略 4：直接调 play()
    try {
      await this.video.evaluate((el) => (el as HTMLVideoElement).play())
      if (await this.waitForPlaying()) {
        this.log.info('已通过 video.play() 开始播放')
        return true
      }
    } catch {
      /* 忽略，走失败分支 */
    }

    this.log.warn('未能开始播放')
    return false
  }

  private async tryClick(locator: Locator | null): Promise<boolean> {
    if (!(await isVisible(locator))) return false
    try {
      await (locator as Locator).click({ timeout: PLAY_PROBE.click })
      return true
    } catch { return false }
  }

  /**
   * 等"进入播放态"，命中即返回。
   * 替代原来"每次点击后固定睡 1 秒" —— 视频起播得快就立刻继续。
   */
  private async waitForPlaying(timeoutMs: number = PLAY_PROBE.playing): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (await this.isPlaying()) return true
      if (Date.now() >= deadline) return false
      await this.page.waitForTimeout(PLAY_PROBE.pollMs)
    }
  }

  /**
   * 视频播过一段（currentTime > 0）且处于暂停时，直接调原生 play()。
   *
   * 这是"暂停后恢复"最快的路径：一次 evaluate，毫秒级返回；
   * 而且不产生任何点击事件，天然绕开学习页的防脚本守卫。
   * 自动播放被拦（play() 返回 rejected promise）时返回 false，
   * 由调用方继续走点击策略。
   */
  private async tryNativeResume(): Promise<boolean> {
    const state = await this.video
      .evaluate((el) => {
        const v = el as HTMLVideoElement
        return { paused: v.paused, ended: v.ended, currentSeconds: v.currentTime }
      })
      .catch(() => null)

    if (!state || !state.paused || state.ended || state.currentSeconds <= 0) return false

    try {
      await this.video.evaluate((el) => (el as HTMLVideoElement).play())
    } catch {
      return false
    }
    if (await this.waitForPlaying(PLAY_PROBE.nativeResume)) {
      this.log.info('已恢复播放（原生 play()）')
      return true
    }
    return false
  }

  async isPlaying(): Promise<boolean> {
    return this.readFlag('playing')
  }

  async isEnded(): Promise<boolean> {
    return this.readFlag('ended')
  }

  async isPaused(): Promise<boolean> {
    return this.readFlag('paused')
  }

  async pause(): Promise<void> {
    await this.video.evaluate(el => (el as HTMLVideoElement).pause())
  }

  /** Replaying completed content must not inherit the server's position at the last frame. */
  async restartFromBeginning(): Promise<boolean> {
    try {
      await this.pause()
      await this.page.evaluate(() => {
        const player = (window as unknown as { ablePlayerX?: (id:string) => { seek(seconds:number):void } }).ablePlayerX?.('container')
        if (player) player.seek(0)
        else {
          const video = document.querySelector('video')
          if (video) video.currentTime = 0
        }
      })
      await this.page.waitForFunction(() => {
        const v = document.querySelector('video')
        return !!v && !v.seeking && v.currentTime < .5 && !v.ended
      }, undefined, {timeout:3000})
      this.log.info('已将当前视频重置到开头')
      return true
    } catch { return false }
  }

  /** 一次性读回播放状态——监控循环每 2 秒就要读一遍，减少往返次数。 */
  async readState(): Promise<{
    exists: boolean
    playing: boolean
    ended: boolean
    paused: boolean
    currentSeconds: number
    durationSeconds: number
  }> {
    try {
      return await this.video.evaluate((el) => {
        const v = el as HTMLVideoElement
        return {
          exists: true,
          playing: !v.paused && !v.ended,
          ended: v.ended,
          paused: v.paused,
          currentSeconds: Number.isFinite(v.currentTime) ? v.currentTime : 0,
          durationSeconds: Number.isFinite(v.duration) ? v.duration : 0
        }
      })
    } catch {
      return {
        exists: false,
        playing: false,
        ended: false,
        paused: true,
        currentSeconds: 0,
        durationSeconds: 0
      }
    }
  }

  private async readFlag(kind: 'playing' | 'ended' | 'paused'): Promise<boolean> {
    try {
      return await this.video.evaluate((el, k) => {
        const v = el as HTMLVideoElement
        if (k === 'playing') return !v.paused && !v.ended
        if (k === 'ended') return v.ended
        return v.paused
      }, kind)
    } catch {
      return false
    }
  }

  async getProgress(): Promise<VideoProgress> {
    try {
      const raw = await this.video.evaluate((el) => {
        const v = el as HTMLVideoElement
        const fmt = (seconds: number): string => {
          if (!Number.isFinite(seconds)) return '0:00'
          const m = Math.floor(seconds / 60)
          const s = Math.floor(seconds % 60)
          return `${m}:${s < 10 ? '0' : ''}${s}`
        }
        return {
          current: fmt(v.currentTime),
          duration: fmt(v.duration),
          currentSeconds: Number.isFinite(v.currentTime) ? v.currentTime : 0,
          durationSeconds: Number.isFinite(v.duration) ? v.duration : 0,
          paused: v.paused,
          ended: v.ended
        }
      })
      return raw
    } catch {
      return {
        current: '0:00',
        duration: '0:00',
        currentSeconds: 0,
        durationSeconds: 0,
        paused: true,
        ended: false
      }
    }
  }

  async getDurationSeconds(): Promise<number> {
    return (await this.getProgress()).durationSeconds
  }

  /**
   * 取视频直链与 Cookie。
   * blob: URL（MSE 流）无法外部下载，与 v1 一样返回空串。
   */
  async getMediaUrl(): Promise<{ url: string; cookieHeader: string }> {
    let url = ''
    try {
      url = ((await this.page.evaluate(VIDEO_SRC_EXTRACTION_JS)) as string) ?? ''
    } catch {
      return { url: '', cookieHeader: '' }
    }
    if (!url) return { url: '', cookieHeader: '' }

    const cookies = await this.page.context().cookies().catch(() => [])
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    return { url, cookieHeader }
  }
}
