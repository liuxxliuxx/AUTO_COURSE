/**
 * 数字石大（UPC）SSO 统一认证登录。移植自 v1 `src/bot/login/upc.py`。
 *
 * 流程：进 CAS 页 → 在 iframe 里注入凭据到 Vue 组件并调用 passwordLogin()
 *      → 跳转课程中心 →（验证码）→ 等最终跳转
 *
 * 说明：UPC 的登录表单是 Vant/Vue 组件，直接写 app.username / app.password
 * 再调用组件的 passwordLogin() 比模拟键盘输入可靠得多（v1 实测结论）。
 */

import type { LoginContext, LoginProvider, LoginResult } from './provider'
import type { LoginMethod } from '@shared/types'
import { SLEEP, TIMEOUT, UPC_BASE_URL, UPC_FORWARD_URL, UPC_LOGIN_IFRAME_CSS } from '../constants'
import { firstVisible } from '../locators'
import { checkCourseSession, isLoginUrl, isUpcPortalSessionAlive } from './session-check'

export class UpcLogin implements LoginProvider {
  readonly method: LoginMethod = 'upc'

  async login(ctx: LoginContext): Promise<LoginResult> {
    const { session, credentials, settings, captcha, log } = ctx
    const loggedUrl = settings.loggedUrl

    // 1. 课程页会话还能用 → 完全跳过登录（一步都不多做）
    const courseSession = await checkCourseSession(ctx)
    if (courseSession.loggedIn) {
      log.info(`复用现有登录会话：${courseSession.detail}`)
      return { ok: true, alreadyLoggedIn: true, message: '已登录（复用现有会话）' }
    }
    log.info(`需要登录：${courseSession.detail}`)

    // 2. 门户会话还有效 → 不用再注入账号密码（CAS 表单不会出现）
    if (await isUpcPortalSessionAlive(session, log)) {
      log.info('数字石大门户会话仍有效，跳过账号密码注入')
    } else {
      await session.navigate(UPC_BASE_URL)
      await session.playwrightPage.waitForTimeout(SLEEP.extraLong)
      log.info(`CAS 页面 URL: ${session.getCurrentUrl()}`)

      const injected = await this.injectCredentials(
        ctx,
        credentials.username,
        credentials.password
      )
      if (!injected) {
        // 注入失败时不抛错：退回人工登录，与 v1「找不到表单就走人工」的兜底一致。
        // 必须用 requestManualHelp（而不是 checkAndHandle）：后者只在屏幕上
        // 真有验证码时才提示，没有验证码就直接返回 false —— 等于不提示也不等，
        // 用户看到的就是"停在登录页不动了"。
        log.error('CAS 登录表单注入失败')
        const ok = await captcha.requestManualHelp('login', '请在浏览器中手动完成登录')
        if (!ok) return { ok: false, alreadyLoggedIn: false, message: 'CAS 登录表单不可用' }
      }

      await session.playwrightPage.waitForTimeout(SLEEP.medium)
    }

    // 跳转到课程中心应用
    log.info('正在跳转到应用页面...')
    await session.navigate(UPC_FORWARD_URL)
    await session.playwrightPage.waitForTimeout(SLEEP.medium)

    await captcha.checkAndHandle('login', '登录时出现验证码，请完成验证')

    const ok = await this.waitForRedirect(ctx, loggedUrl)
    if (isLoginUrl(session.getCurrentUrl())) {
      // 说清楚，否则后面只会看到"没有待处理的视频"，很难判断是登录没成功
      log.warn(`登录流程结束后仍停在登录页：${session.getCurrentUrl()}`)
    }
    return { ok, alreadyLoggedIn: false, message: ok ? '登录成功' : '登录后未检测到目标地址，继续执行' }
  }

  /** 在 CAS iframe 内注入凭据并触发登录。 */
  private async injectCredentials(ctx: LoginContext, username: string, password: string): Promise<boolean> {
    const { session, log } = ctx

    const frame = await firstVisible(session.playwrightPage, [UPC_LOGIN_IFRAME_CSS], TIMEOUT.default)
    if (!frame) {
      log.error(`未找到 CAS 登录 iframe（${UPC_LOGIN_IFRAME_CSS}）`)
      return false
    }

    await session.playwrightPage.waitForTimeout(SLEEP.long)

    try {
      const state = await session
        .frameLocator(UPC_LOGIN_IFRAME_CSS)
        .locator('body')
        .evaluate(
          (_body, creds) => {
            // 真实站点：#app.__vue__ 是 Vue 组件实例
            const host = document.querySelector('#app') as
              | (Element & { __vue__?: Record<string, unknown> })
              | null
            const vm = host?.__vue__
            if (!vm) return 'no-vue-instance'

            vm.username = creds.username
            vm.password = creds.password
            if (typeof vm.passwordLogin !== 'function') return 'no-password-login'
            ;(vm.passwordLogin as () => void)()
            return 'ok'
          },
          { username, password }
        )

      if (state === 'ok') {
        log.info('已通过 JS 注入凭据并触发登录，等待跳转...')
        return true
      }
      log.error(`CAS 表单注入失败: ${state}`)
      return false
    } catch (error) {
      log.error(`CAS 表单注入异常: ${String(error)}`)
      return false
    }
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
