/**
 * 智慧树手机号 + 密码直接登录。移植自 v1 `src/bot/login/zhihuishu.py`。
 *
 * 流程：切到手机号 Tab → 填账号 → 填密码 → 点登录 →（滑块验证码人工处理）→ 等跳转
 */

import type { LoginContext, LoginProvider, LoginResult } from './provider'
import type { LoginMethod } from '@shared/types'
import { ZHIHUISHU_BASE_URL } from '../constants'
import {
  LOGIN_BTN_CSS,
  LOGIN_BTN_XPATH,
  LOGIN_PASSWORD_CSS,
  LOGIN_TAB_CSS,
  LOGIN_TAB_XPATH,
  LOGIN_USERNAME_CSS,
  SLEEP,
  TIMEOUT
} from '../constants'
import { firstVisible, firstVisibleXPath, isVisible, safeClick } from '../locators'

export class ZhihuishuLogin implements LoginProvider {
  readonly method: LoginMethod = 'zhihuishu'

  async login(ctx: LoginContext): Promise<LoginResult> {
    const { session, credentials, settings, captcha, log } = ctx
    const loggedUrl = settings.loggedUrl

    // 1. 已登录则跳过
    if (await this.alreadyLoggedIn(ctx)) {
      log.info('已登录，无需重新登录')
      return { ok: true, alreadyLoggedIn: true, message: '已登录' }
    }

    await session.navigate(ZHIHUISHU_BASE_URL)
    await session.playwrightPage.waitForTimeout(SLEEP.long)

    // 2. 切换到手机号 Tab
    const tab =
      (await firstVisible(session.playwrightPage, LOGIN_TAB_CSS, TIMEOUT.short)) ??
      (await firstVisibleXPath(session.playwrightPage, LOGIN_TAB_XPATH, TIMEOUT.short))
    if (await isVisible(tab)) {
      await safeClick(tab as NonNullable<typeof tab>)
      log.info('已切换到手机号登录')
    }
    await session.playwrightPage.waitForTimeout(SLEEP.medium)

    // 3. 填账号
    const usernameInput = await firstVisible(session.playwrightPage, LOGIN_USERNAME_CSS, TIMEOUT.medium)
    if (usernameInput) {
      await usernameInput.fill(credentials.username)
      log.info('已填入账号')
    } else {
      log.error('未找到手机号输入框')
      const ok = await captcha.checkAndHandle(
        'login',
        '未找到手机号输入框，请在浏览器中手动完成登录'
      )
      if (!ok) return { ok: false, alreadyLoggedIn: false, message: '未找到手机号输入框' }
    }

    // 4. 填密码
    const passwordInput = await firstVisible(session.playwrightPage, LOGIN_PASSWORD_CSS, TIMEOUT.medium)
    if (passwordInput) {
      await passwordInput.fill(credentials.password)
      log.info('已填入密码')
    } else {
      log.error('未找到密码输入框')
      const ok = await captcha.checkAndHandle(
        'login',
        '未找到密码输入框，请在浏览器中手动完成登录'
      )
      if (!ok) return { ok: false, alreadyLoggedIn: false, message: '未找到密码输入框' }
    }

    // 5. 点登录（页面可能有遮罩，safeClick 会退回 JS click）
    await session.playwrightPage.waitForTimeout(SLEEP.medium)
    const loginBtn =
      (await firstVisible(session.playwrightPage, LOGIN_BTN_CSS, TIMEOUT.medium)) ??
      (await firstVisibleXPath(session.playwrightPage, LOGIN_BTN_XPATH, TIMEOUT.short))

    if (await isVisible(loginBtn)) {
      await safeClick(loginBtn as NonNullable<typeof loginBtn>)
      log.info('已点击登录按钮，等待滑块验证码出现...')
    } else {
      log.error('未找到登录按钮')
      const ok = await captcha.checkAndHandle('login', '未找到登录按钮，请手动点击登录并完成验证')
      if (!ok) return { ok: false, alreadyLoggedIn: false, message: '未找到登录按钮' }
    }

    // 6. 处理滑块验证码
    await session.playwrightPage.waitForTimeout(SLEEP.extraLong)
    const handled = await captcha.checkAndHandle(
      'login',
      '登录时出现滑块验证码，请在浏览器中完成滑动验证'
    )
    if (!handled && ctx.shouldStop()) {
      return { ok: false, alreadyLoggedIn: false, message: '已停止' }
    }

    // 7. 等跳转（超时也算继续，与 v1 一致）
    const ok = await this.waitForRedirect(ctx, loggedUrl)
    return { ok, alreadyLoggedIn: false, message: ok ? '登录成功' : '登录后未检测到目标地址，继续执行' }
  }

  private async alreadyLoggedIn(ctx: LoginContext): Promise<boolean> {
    const { session, settings, log } = ctx
    if (!settings.loggedUrl) return false

    await session.navigate(ZHIHUISHU_BASE_URL)
    await session.playwrightPage.waitForTimeout(SLEEP.pageLoad)
    const current = session.getCurrentUrl()
    log.info(`当前 URL: ${current}`)
    return current.includes(settings.loggedUrl)
  }

  private async waitForRedirect(ctx: LoginContext, loggedUrl: string): Promise<boolean> {
    const { session, captcha, log } = ctx
    if (!loggedUrl) return true

    if (await session.waitForUrlContains(loggedUrl, TIMEOUT.extraLong)) {
      log.info('登录成功')
      return true
    }

    log.warn('等待登录跳转超时，再次检查验证码...')
    await captcha.checkAndHandle('login', '登录仍在等待验证，请完成验证码')
    if (await session.waitForUrlContains(loggedUrl, TIMEOUT.long)) {
      log.info('登录成功')
      return true
    }

    log.warn('登录后未检测到 logged_URL，但继续执行')
    return false
  }
}
