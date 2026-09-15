/**
 * 验证码检测与人工介入（handoff §12）。
 *
 * 保持 v1 的「自动检测 + 用户人工处理 + 程序继续」，**不增加自动破解**。
 *
 * 检测逻辑与 v1 `src/bot/captcha.py` 等价，三条路径按可靠性降序：
 *   1. 验证码 iframe（src 命中关键字）—— 最可靠
 *   2. 可见弹窗（yidun 滑块等）
 *   3. 登录页图片验证码输入框
 * 刻意跳过永久隐藏的容器（如 #captchaYidun），避免误报。
 */

import type { BrowserSession } from './browser-session'
import {
  CAPTCHA_IFRAME_KEYWORDS,
  CAPTCHA_IMAGE_INPUT_ID,
  CAPTCHA_POPUP_SELECTORS
} from './constants'
import type { Logger } from '../services/logger'

export type CaptchaScene = 'login' | 'course' | 'video'

export interface CaptchaDetection {
  kind: 'iframe' | 'popup' | 'image-input'
  detail: string
}

export interface CaptchaServiceDeps {
  session: BrowserSession
  /** 通知 UI 并等待用户确认；返回 false 表示期间收到停止请求 */
  requestCaptcha: (scene: CaptchaScene, message: string) => Promise<boolean>
  shouldStop: () => boolean
  log: Logger
}

export class CaptchaService {
  constructor(private readonly deps: CaptchaServiceDeps) {}

  /** 在页面里跑一次检测，返回命中项或 null。 */
  async detect(): Promise<CaptchaDetection | null> {
    try {
      return await this.deps.session.playwrightPage.evaluate(
        ([keywords, popups, imageInputId]) => {
          const visible = (el: Element): boolean => {
            const rect = el.getBoundingClientRect()
            return rect.width > 10 && rect.height > 0
          }

          // 1. 验证码 iframe
          for (const frame of Array.from(document.querySelectorAll('iframe'))) {
            const src = (frame.getAttribute('src') ?? '').toLowerCase()
            if (!src) continue
            if (keywords.some((k) => src.includes(k)) && visible(frame)) {
              return { kind: 'iframe' as const, detail: src }
            }
          }

          // 2. 可见弹窗
          for (const selector of popups) {
            for (const el of Array.from(document.querySelectorAll(selector))) {
              if (visible(el)) return { kind: 'popup' as const, detail: selector }
            }
          }

          // 3. 登录页图片验证码输入框
          const input = document.getElementById(imageInputId)
          if (input && visible(input)) {
            return { kind: 'image-input' as const, detail: `#${imageInputId}` }
          }

          return null
        },
        [
          CAPTCHA_IFRAME_KEYWORDS as unknown as string[],
          CAPTCHA_POPUP_SELECTORS as unknown as string[],
          CAPTCHA_IMAGE_INPUT_ID
        ] as const
      )
    } catch (error) {
      this.deps.log.debug(`验证码检测跳过: ${String(error)}`)
      return null
    }
  }

  /**
   * 检测并在需要时阻塞等待用户处理。
   * 返回 true 表示"出现过验证码且用户已确认"；false 表示没有验证码。
   */
  async checkAndHandle(scene: CaptchaScene, message: string): Promise<boolean> {
    const hit = await this.detect()
    if (!hit) return false

    this.deps.log.warn(`检测到验证码（${hit.kind}: ${hit.detail}）`)
    const confirmed = await this.deps.requestCaptcha(scene, message)
    if (!confirmed) {
      this.deps.log.info('收到停止请求，放弃等待验证码')
      return false
    }

    this.deps.log.info('用户确认验证码已处理，继续运行')
    return true
  }
}
