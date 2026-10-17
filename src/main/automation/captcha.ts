/**
 * 验证码检测：易盾单点题优先离线处理，连续失败五次后沿用人工介入。
 *
 * 检测逻辑与 v1 `src/bot/captcha.py` 等价，三条路径按可靠性降序：
 *   1. 验证码 iframe（src 命中关键字）—— 最可靠
 *   2. 可见弹窗（yidun 滑块等）
 *   3. 登录页图片验证码输入框
 * 刻意跳过永久隐藏的容器（如 #captchaYidun），避免误报。
 */

import type { BrowserSession } from './browser-session'
import { GlyphCaptchaSolver, type GlyphCaptchaOptions } from './glyph-captcha'
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
  requestCaptcha: (scene: CaptchaScene, message: string, kind?: 'captcha' | 'manual-login') => Promise<boolean>
  shouldStop: () => boolean
  log: Logger
  /** Model factory/timeouts can be injected by local browser regressions. */
  glyph?: GlyphCaptchaOptions
}

export class CaptchaService {
  private readonly automatic: GlyphCaptchaSolver
  private manualOnly = false
  constructor(private readonly deps: CaptchaServiceDeps) {
    this.automatic = new GlyphCaptchaSolver(deps.session.playwrightPage, deps.log, deps.glyph)
  }

  /**
   * 在页面里跑一次检测，返回命中项或 null。
   *
   * 同时把「命中了关键字但被判定为不可见」的候选记进日志。
   * 误报排查时这是唯一有用的信息 —— 用户看到的是"有验证码"，
   * 但屏幕上什么都没有，必须知道到底是哪个元素被判成了可见。
   */
  async detect(): Promise<CaptchaDetection | null> {
    try {
      const result = await this.deps.session.playwrightPage.evaluate(
        ([keywords, popups, imageInputId]) => {
          const rejected: string[] = []

          const label = (el: Element): string => {
            const id = (el as HTMLElement).id
            return `${el.tagName.toLowerCase()}${id ? `#${id}` : ''}`
          }

          /**
           * 「元素是否真的显示给用户」——**对齐 Selenium 的 `is_displayed()`**。
           *
           * 不能只看 getBoundingClientRect()：目标站点会长期在 DOM 里挂一个
           * 休眠的验证码容器（v1 注释里写的 `#captchaYidun`），它通常用
           * `visibility:hidden` / `opacity:0` / 被祖先 overflow 裁掉 的方式藏起来 ——
           * 这几种情况下 bounding rect **依然是正常尺寸**，
           * 只看 rect 会把休眠容器当成"弹出的验证码"，误报给用户。
           *
           * 返回 null 表示可见；返回字符串表示不可见，字符串就是原因。
           * 用「返回原因」而不是「返回布尔」是为了让日志能直接说清楚
           * 到底是哪个祖先、以什么方式把它藏起来的 —— 这是误报排查唯一有用的信息。
           */
          const hiddenReason = (el: Element, minWidth = 0): string | null => {
            // 1. 自身与所有祖先的 display / visibility / opacity
            for (
              let node: Element | null = el;
              node && node.nodeType === 1;
              node = node.parentElement
            ) {
              const style = getComputedStyle(node)
              const where = node === el ? '自身' : `祖先 ${label(node)}`
              if (style.display === 'none') return `${where} display:none`
              if (style.visibility === 'hidden' || style.visibility === 'collapse') {
                return `${where} visibility:${style.visibility}`
              }
              if (Number(style.opacity) === 0) return `${where} opacity:0`
            }

            // 2. 尺寸
            const rect = el.getBoundingClientRect()
            if (rect.width <= minWidth || rect.height <= 0) {
              return `尺寸过小 ${Math.round(rect.width)}x${Math.round(rect.height)}`
            }

            // 3. 是否被祖先的 overflow:hidden 完全裁掉
            for (
              let node: Element | null = el.parentElement;
              node && node.nodeType === 1;
              node = node.parentElement
            ) {
              const style = getComputedStyle(node)
              if (style.overflow !== 'hidden' && style.overflow !== 'clip') continue
              const outer = node.getBoundingClientRect()
              if (
                rect.right <= outer.left ||
                rect.left >= outer.right ||
                rect.bottom <= outer.top ||
                rect.top >= outer.bottom
              ) {
                return `被祖先 ${label(node)} 的 overflow 完全裁掉`
              }
            }

            // 4. 完全在视口之外。
            //    站点也常用 left:-9999px 这种方式停放休眠的验证码容器。
            //    而且从产品语义上讲：用户**根本看不到**的东西，
            //    就不该弹提示让他去处理。只在完全不重叠时才判为不可见，
            //    部分露出（例如需要滚动）仍然算可见。
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight
            if (
              rect.right <= 0 ||
              rect.left >= viewportWidth ||
              rect.bottom <= 0 ||
              rect.top >= viewportHeight
            ) {
              return '完全在视口之外'
            }

            return null
          }

          const isDisplayed = (el: Element, minWidth = 0): boolean =>
            hiddenReason(el, minWidth) === null

          const describe = (el: Element, what: string, minWidth = 0): void => {
            const why = hiddenReason(el, minWidth) ?? '（判为可见）'
            const rect = el.getBoundingClientRect()
            rejected.push(
              `${what} — ${why} · rect=${Math.round(rect.width)}x${Math.round(rect.height)}`
            )
          }

          // 1. 验证码 iframe（对应 v1 的 iframe.is_displayed()）
          for (const frame of Array.from(document.querySelectorAll('iframe'))) {
            const src = (frame.getAttribute('src') ?? '').toLowerCase()
            if (!src) continue
            if (!keywords.some((k) => src.includes(k))) continue
            if (isDisplayed(frame)) return { hit: { kind: 'iframe' as const, detail: src }, rejected }
            describe(frame, `iframe[${src.slice(0, 120)}] 命中关键字但不可见`)
          }

          // 2. 弹窗式验证码（对应 v1 的 e.size.width > 10）
          for (const selector of popups) {
            for (const el of Array.from(document.querySelectorAll(selector))) {
              if (isDisplayed(el, 10)) return { hit: { kind: 'popup' as const, detail: selector }, rejected }
              describe(el, `${selector} 存在但不可见`, 10)
            }
          }

          // 3. 登录页图片验证码输入框
          const input = document.getElementById(imageInputId)
          if (input) {
            if (isDisplayed(input)) {
              return { hit: { kind: 'image-input' as const, detail: `#${imageInputId}` }, rejected }
            }
            describe(input, `#${imageInputId} 存在但不可见`)
          }

          return { hit: null, rejected }
        },
        [
          CAPTCHA_IFRAME_KEYWORDS as unknown as string[],
          CAPTCHA_POPUP_SELECTORS as unknown as string[],
          CAPTCHA_IMAGE_INPUT_ID
        ] as const
      )

      if (result.hit) {
        // 命中时把「命中了什么」和「同时排除了什么」都打到 info ——
        // 界面上看得见。误报排查全靠这两行：
        // 命中行说明是谁触发的，排除行说明其它候选为什么没被算进去。
        this.deps.log.info(`验证码命中：${result.hit.kind} → ${result.hit.detail}`)
        if (result.rejected.length) {
          this.deps.log.info(`同时排除了 ${result.rejected.length} 个候选：`)
          for (const line of result.rejected) this.deps.log.info(`  · ${line}`)
        }
      } else if (result.rejected.length) {
        // 没命中时这些只是噪音（视频监控每 30 秒都会跑一次检测），降到 debug
        for (const line of result.rejected) this.deps.log.debug(`验证码候选已排除 · ${line}`)
      }

      return result.hit
    } catch (error) {
      this.deps.log.debug(`验证码检测跳过: ${String(error)}`)
      return null
    }
  }

  /**
   * 检测并在需要时阻塞等待用户处理。
   * 返回 true 表示站点确认自动通过或用户人工确认；false 表示未检测到或已停止。
   */
  async checkAndHandle(scene: CaptchaScene, message: string): Promise<boolean> {
    const hit = await this.detect()
    if (!hit) { this.manualOnly = false; return false }

    this.deps.log.warn(`检测到验证码（${hit.kind}: ${hit.detail}）`)
    if (!this.manualOnly) {
      const result = await this.automatic.solve(this.deps.shouldStop)
      if (result === 'solved') return true
      if (result === 'stopped') return false
      this.manualOnly = true
    }
    const confirmed = await this.requestManualHelp(scene, message, 'captcha')
    // A resolved challenge releases the circuit breaker for the next independent one.
    if (confirmed && !await this.detect()) this.manualOnly = false
    return confirmed
  }

  /**
   * 直接请求人工介入，**不检测验证码**。
   *
   * 用于"自动登录失败，请手动登录"这类兜底。以前这里用的是 `checkAndHandle`，
   * 而它在屏幕上没有验证码时立刻返回 false —— 于是既不弹提示也不等待，
   * 用户看到的就是"被扔在登录页，然后不动了"。
   */
  async requestManualHelp(scene: CaptchaScene, message: string, kind: 'captcha' | 'manual-login' = 'manual-login'): Promise<boolean> {
    if (this.deps.shouldStop()) return false

    const confirmed = await this.deps.requestCaptcha(scene, message, kind)
    if (!confirmed) {
      this.deps.log.info('收到停止请求，放弃等待验证码')
      return false
    }

    this.deps.log.info('用户确认人工处理已完成，继续运行')
    return true
  }
}
