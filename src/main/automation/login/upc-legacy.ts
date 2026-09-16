/** 数字石大旧门户登录。保留原流程，和机构 SSO 完全分离。 */

import type { LoginContext, LoginProvider, LoginResult } from './provider'
import type { LoginMethod } from '@shared/types'
import { SLEEP, TIMEOUT, UPC_BASE_URL, UPC_FORWARD_URL, UPC_LOGIN_IFRAME_CSS } from '../constants'
import { firstVisible } from '../locators'
import { waitForAuthDestination } from './auth-redirect'
import { checkCourseSession, isLoginUrl, isUpcPortalSessionAlive } from './session-check'

export class UpcLegacyLogin implements LoginProvider {
  readonly method: LoginMethod = 'upc'

  async login(ctx: LoginContext): Promise<LoginResult> {
    const { session, credentials, settings, captcha, log } = ctx
    const courseSession = await checkCourseSession(ctx)
    if (courseSession.loggedIn) {
      log.info(`复用现有登录会话：${courseSession.detail}`)
      return { ok: true, alreadyLoggedIn: true, message: '已登录（复用现有会话）' }
    }

    if (await isUpcPortalSessionAlive(session, log)) {
      log.info('数字石大门户会话仍有效，跳过账号密码注入')
    } else {
      await session.navigate(UPC_BASE_URL)
      await session.playwrightPage.waitForTimeout(SLEEP.extraLong)
      if (!(await this.injectCredentials(ctx, credentials.username, credentials.password))) {
        const ok = await captcha.requestManualHelp('login', '请在浏览器中手动完成旧门户登录')
        if (!ok) return { ok: false, alreadyLoggedIn: false, message: '旧门户登录表单不可用' }
      }
      log.info('等待数字石大门户认证完成后再打开工作台')
      const authenticated = await waitForAuthDestination(
        session.playwrightPage,
        (url) => url.hostname === 'i.upc.edu.cn' && url.pathname === '/dcp/index.jsp',
        { shouldStop: ctx.shouldStop }
      )
      if (!authenticated) {
        await captcha.checkAndHandle('login', '门户登录出现验证码，请完成验证')
        return { ok: false, alreadyLoggedIn: false, message: `门户认证尚未完成：${session.getCurrentUrl()}` }
      }
    }

    if (ctx.shouldStop() || session.playwrightPage.isClosed()) {
      return { ok: false, alreadyLoggedIn: false, message: '登录已停止或课程窗口已关闭' }
    }
    await session.navigate(UPC_FORWARD_URL)
    await captcha.checkAndHandle('login', '登录时出现验证码，请完成验证')
    const ok = await this.waitForRedirect(ctx, settings.loggedUrl)
    if (isLoginUrl(session.getCurrentUrl())) log.warn(`旧门户流程仍停在登录页：${session.getCurrentUrl()}`)
    return { ok, alreadyLoggedIn: false, message: ok ? '旧门户登录成功' : '旧门户未到达目标地址' }
  }

  private async injectCredentials(ctx: LoginContext, username: string, password: string): Promise<boolean> {
    const frame = await firstVisible(ctx.session.playwrightPage, [UPC_LOGIN_IFRAME_CSS], TIMEOUT.default)
    if (!frame) return false
    try {
      const state = await ctx.session.frameLocator(UPC_LOGIN_IFRAME_CSS).locator('body').evaluate(
        (_body, creds) => {
          const host = document.querySelector('#app') as (Element & { __vue__?: Record<string, unknown> }) | null
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
      if (state === 'ok') ctx.log.info('旧门户已注入凭据并提交')
      return state === 'ok'
    } catch (error) {
      ctx.log.error(`旧门户表单注入异常：${String(error)}`)
      return false
    }
  }

  private async waitForRedirect(ctx: LoginContext, target: string): Promise<boolean> {
    if (!target) return true
    if (await ctx.session.waitForUrlContains(target, TIMEOUT.extraLong)) return true
    await ctx.captcha.checkAndHandle('login', '旧门户登录仍在等待验证，请完成验证码')
    return ctx.session.waitForUrlContains(target, TIMEOUT.long)
  }
}
