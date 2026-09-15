/**
 * 视频播放控制。移植自 v1 `src/bot/video.py`。
 *
 * v1 的 play() 有 4 级策略，v2 保留同样的思路：
 *   1. 大播放按钮（ActionChains 点击 → Playwright 的 click 本身就带可交互性检查）
 *   2. 控制栏播放按钮
 *   3. 点击 <video> 本体
 *   4. 直接调 video.play()
 */

import type { Locator, Page } from 'playwright-core'
import { PLAY_BTN_CSS, PLAY_CONTROL_BTN_CSS, SLEEP, TIMEOUT, VIDEO_ELEMENT_CSS, VIDEO_SRC_EXTRACTION_JS } from '../constants'
import { firstVisible, isVisible } from '../locators'
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
    await this.page.waitForTimeout(SLEEP.long)

    // 策略 1：大播放按钮
    const bigPlay = await firstVisible(this.page, PLAY_BTN_CSS, TIMEOUT.medium)
    if (bigPlay && (await this.tryClick(bigPlay))) {
      if (await this.isPlaying()) {
        this.log.info('已通过大播放按钮开始播放')
        return true
      }
    }

    // 策略 2：控制栏播放按钮
    const ctrl = await firstVisible(this.page, [PLAY_CONTROL_BTN_CSS], TIMEOUT.short)
    if (ctrl && (await this.tryClick(ctrl))) {
      if (await this.isPlaying()) {
        this.log.info('已通过控制栏播放按钮开始播放')
        return true
      }
    }

    // 策略 3：点击 video 本体
    if (await this.tryClick(this.video)) {
      if (await this.isPlaying()) {
        this.log.info('已通过点击 video 元素开始播放')
        return true
      }
    }

    // 策略 4：直接调 play()
    try {
      await this.video.evaluate((el) => (el as HTMLVideoElement).play())
      await this.page.waitForTimeout(SLEEP.medium)
      if (await this.isPlaying()) {
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
    const target = locator as Locator
    try {
      await target.click({ timeout: 3_000 })
    } catch {
      // 页面常有遮罩层；退回 JS click（v1 也是这么兜底的）
      const ok = await target
        .evaluate((el) => ((el as HTMLElement).click(), true))
        .catch(() => false)
      if (!ok) return false
    }
    await this.page.waitForTimeout(SLEEP.medium)
    return true
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
