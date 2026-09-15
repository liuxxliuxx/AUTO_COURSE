/**
 * 智慧树手机号 + 密码直接登录。移植自 v1 `src/bot/login/zhihuishu.py`。
 *
 * 流程（每轮）：进登录中心 → 切到「账号登录」→ 填账号 → 填密码 → 点登录
 *            →（滑块验证码人工处理）→ 等离开登录页
 *
 * 2026-09 站点改版后的两点修正：
 *  1. 登录入口换成新的「登录中心」`login.zhihuishu.com`（见 constants.ts）。
 *     旧入口上表单藏在弹窗里、不可见，选择器永远命中不到 —— 表现就是
 *     "被弹到登录页然后登不进去，直接停住"。
 *  2. **失败会重来**：以前一轮没找到输入框就只剩"请手动登录"的提示，
 *     整轮就此停住。现在最多尝试 `LOGIN_MAX_ATTEMPTS` 轮，每轮重新进入登录页；
 *     全自动都失败才退回人工确认。
 */

import type { LoginContext, LoginProvider, LoginResult } from './provider'
import type { LoginMethod } from '@shared/types'
import {
  LOGIN_BTN_CSS,
  LOGIN_BTN_XPATH,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_PASSWORD_CSS,
  LOGIN_TAB_CSS,
  LOGIN_TAB_XPATH,
  LOGIN_USERNAME_CSS,
  SLEEP,
  TIMEOUT,
  ZHIHUISHU_LOGIN_URL
} from '../constants'
import { firstVisible, firstVisibleXPath, isVisible, safeClick } from '../locators'
import { checkCourseSession, isLoginUrl } from './session-check'

export interface ZhihuishuLoginOptions {
  /** 登录入口；默认打真实登录中心，测试里可换成夹具页 */
  loginUrl?: string
  /** 最多尝试几轮（默认 3） */
  maxAttempts?: number
  /** 单轮"等离开登录页"的上限 */
  attemptTimeoutMs?: number
}

export class ZhihuishuLogin implements LoginProvider {
  readonly method: LoginMethod = 'zhihuishu'

  /**
   * 登录入口与尝试次数都可注入：默认打真实登录中心，
   * 测试里换成夹具页，用来钉住"改版后的表单还能被找到""失败会重来"这两件事。
   */
  constructor(private readonly options: ZhihuishuLoginOptions = {}) {}

  private get loginUrl(): string {
    return this.options.loginUrl ?? ZHIHUISHU_LOGIN_URL
  }

  private get maxAttempts(): number {
    return this.options.maxAttempts ?? LOGIN_MAX_ATTEMPTS
  }

  async login(ctx: LoginContext): Promise<LoginResult> {
    const { captcha, log } = ctx

    // 1. 课程页会话还能用 → 完全跳过登录
    const courseSession = await checkCourseSession(ctx)
    if (courseSession.loggedIn) {
      log.info(`复用现有登录会话：${courseSession.detail}`)
      return { ok: true, alreadyLoggedIn: true, message: '已登录（复用现有会话）' }
    }
    log.info(`需要登录：${courseSession.detail}`)

    // 2. 账号密码登录，失败就重来（而不是停在登录页不动）
    let lastMessage = '登录未成功'
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (ctx.shouldStop()) return { ok: false, alreadyLoggedIn: false, message: '已停止' }

      log.info(`账号密码登录 第 ${attempt}/${this.maxAttempts} 次`)
      const result = await this.attemptLogin(ctx, attempt)
      if (result.ok) return result

      lastMessage = result.message
      log.warn(`第 ${attempt} 次登录未成功：${result.message}`)
      if (attempt < this.maxAttempts) await ctx.session.playwrightPage.waitForTimeout(SLEEP.long)
    }

    // 3. 自动登录全部失败 → 退回人工（v1 的兜底语义）
    log.error(`自动登录 ${this.maxAttempts} 次都没成功：${lastMessage}`)
    const handled = await captcha.requestManualHelp(
      'login',
      '自动登录未成功，请在浏览器里手动登录；登录完成后点「已完成验证，继续」'
    )
    return {
      ok: handled,
      alreadyLoggedIn: false,
      message: handled ? '已通过人工登录' : `登录失败：${lastMessage}`
    }
  }

  /** 单轮登录：进登录页 → 填表 → 提交 → 等离开登录页。 */
  private async attemptLogin(ctx: LoginContext, attempt: number): Promise<LoginResult> {
    const { session, credentials, captcha, log } = ctx
    const page = session.playwrightPage

    await session.navigate(this.loginUrl)
    await page.waitForTimeout(SLEEP.long)

    // 切到「账号登录」（新版默认就在这个标签，点一下是幂等的）
    const tab =
      (await firstVisibleXPath(page, LOGIN_TAB_XPATH, TIMEOUT.short)) ??
      (await firstVisible(page, LOGIN_TAB_CSS, TIMEOUT.short))
    if (await isVisible(tab)) {
      await safeClick(tab as NonNullable<typeof tab>)
      log.info('已切换到账号登录')
    }
    await page.waitForTimeout(SLEEP.medium)

    // 填账号
    const usernameInput = await firstVisible(page, LOGIN_USERNAME_CSS, TIMEOUT.short)
    if (usernameInput) {
      await usernameInput.fill(credentials.username)
      log.info('已填入账号')
    } else {
      return { ok: false, alreadyLoggedIn: false, message: '未找到手机号输入框' }
    }

    // 填密码
    const passwordInput = await firstVisible(page, LOGIN_PASSWORD_CSS, TIMEOUT.short)
    if (passwordInput) {
      await passwordInput.fill(credentials.password)
      log.info('已填入密码')
    } else {
      return { ok: false, alreadyLoggedIn: false, message: '未找到密码输入框' }
    }

    // 点登录（页面可能有遮罩，safeClick 走可信点击）
    await page.waitForTimeout(SLEEP.medium)
    const loginBtn =
      (await firstVisible(page, LOGIN_BTN_CSS, TIMEOUT.short)) ??
      (await firstVisibleXPath(page, LOGIN_BTN_XPATH, TIMEOUT.short))

    if (await isVisible(loginBtn)) {
      await safeClick(loginBtn as NonNullable<typeof loginBtn>)
      log.info('已点击登录按钮，等待滑块验证码出现...')
    } else {
      return { ok: false, alreadyLoggedIn: false, message: '未找到登录按钮' }
    }

    // 滑块验证码：只在最后一轮才请用户介入，前几轮自己重试
    await page.waitForTimeout(SLEEP.extraLong)
    if (attempt >= this.maxAttempts) {
      const handled = await captcha.checkAndHandle(
        'login',
        '登录时出现滑块验证码，请在浏览器中完成滑动验证'
      )
      if (!handled && ctx.shouldStop()) {
        return { ok: false, alreadyLoggedIn: false, message: '已停止' }
      }
    }

    // 判定成功：离开登录页即视为登录成功
    // （不再拿 settings.loggedUrl 去比 —— 那是数字石大工作台，智慧树登录不会跳过去）
    const left = await this.waitForLeaveLogin(ctx, this.options.attemptTimeoutMs)
    return {
      ok: left,
      alreadyLoggedIn: false,
      message: left ? '登录成功' : `仍停留在登录页：${session.getCurrentUrl()}`
    }
  }

  /**
   * 等"离开登录页"。登录成功时登录中心会跳到学堂/课程页；
   * 停在登录页（密码错、验证码没过）就返回 false，交给上层重试。
   */
  private async waitForLeaveLogin(ctx: LoginContext, overrideMs?: number): Promise<boolean> {
    const deadline = Date.now() + (overrideMs ?? TIMEOUT.long)
    for (;;) {
      if (ctx.shouldStop()) return false
      if (!isLoginUrl(ctx.session.getCurrentUrl())) {
        ctx.log.info(`已离开登录页：${ctx.session.getCurrentUrl()}`)
        return true
      }
      if (Date.now() >= deadline) return false
      await ctx.session.playwrightPage.waitForTimeout(500)
    }
  }
}
