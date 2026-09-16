/** 数字石大机构登录：CAS 标准表单 → 智慧树 OAuth → 课程页。 */

import type { LoginMethod } from '@shared/types'
import type { LoginContext, LoginProvider, LoginResult } from './provider'
import { checkCourseSession, isLoginUrl } from './session-check'
import { buildUpcInstitutionCasUrl, submitCasForm } from './upc-cas'

export interface UpcInstitutionLoginOptions {
  casLoginUrl?: string
}

export class UpcInstitutionLogin implements LoginProvider {
  readonly method: LoginMethod = 'upc-institution'

  constructor(private readonly options: UpcInstitutionLoginOptions = {}) {}

  async login(ctx: LoginContext): Promise<LoginResult> {
    const current = await checkCourseSession(ctx)
    if (current.loggedIn) {
      ctx.log.info(`复用现有登录会话：${current.detail}`)
      return { ok: true, alreadyLoggedIn: true, message: '已登录（复用现有会话）' }
    }

    const loginUrl = this.options.casLoginUrl ?? buildUpcInstitutionCasUrl()
    ctx.log.info('直接提交机构 CAS 标准表单（跳过机构搜索与 iframe）')
    const result = await submitCasForm(
      ctx.session.playwrightPage,
      loginUrl,
      ctx.credentials.username,
      ctx.credentials.password
    )

    if (!result.ok) {
      ctx.log.warn(`机构 SSO 表单登录失败：${result.detail}`)
      const handled = await ctx.captcha.requestManualHelp(
        'login',
        '机构登录需要人工处理（密码错误或出现验证码），请登录后继续'
      )
      return {
        ok: handled,
        alreadyLoggedIn: false,
        message: handled ? '已通过人工完成机构登录' : `机构登录失败：${result.detail}`
      }
    }

    ctx.log.info(`机构 SSO 重定向链完成：${result.finalUrl}`)
    const target = ctx.settings.videoUrl.trim() || result.finalUrl
    await ctx.session.navigate(target)
    if (isLoginUrl(ctx.session.getCurrentUrl())) {
      return {
        ok: false,
        alreadyLoggedIn: false,
        message: `OAuth 完成后仍被带回登录页：${ctx.session.getCurrentUrl()}`
      }
    }
    return { ok: true, alreadyLoggedIn: false, message: '机构 SSO 登录成功' }
  }
}
