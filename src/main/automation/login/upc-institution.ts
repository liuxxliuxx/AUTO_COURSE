/** 数字石大机构登录：CAS 标准表单 → 智慧树 OAuth → 课程页。 */

import type { LoginMethod } from '@shared/types'
import type { LoginContext, LoginProvider, LoginResult } from './provider'
import { checkCourseSession } from './session-check'
import { buildUpcInstitutionCasUrl, submitCasForm } from './upc-cas'

export interface UpcInstitutionLoginOptions {
  casLoginUrl?: string
  timeoutMs?: number
  accepts?: (url: URL) => boolean
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
      ctx.credentials.password,
      this.options.timeoutMs,
      { shouldStop: ctx.shouldStop, accepts: this.options.accepts }
    )

    if (!result.ok) {
      ctx.log.warn(`机构 SSO 表单登录失败：${result.detail}`)
      const handled = await ctx.captcha.checkAndHandle('login', '机构登录出现验证码，请完成验证')
      return {
        ok: false,
        alreadyLoggedIn: false,
        message: handled ? '验证码处理完成，请重新开始登录' : `机构登录失败：${result.detail}`
      }
    }

    ctx.log.info(`机构 SSO 重定向链完成：${result.finalUrl}`)
    // hub 工作台只是授权落地页。继续访问调用方要求的课程页/课程中心并验证页面。
    ctx.log.info('机构授权完成，正在跳转到目标课程页面')
    const course = await checkCourseSession(ctx, { afterAuthentication: true })
    if (!course.loggedIn) {
      return { ok: false, alreadyLoggedIn: false, message: `机构授权后课程鉴权未通过：${course.detail}` }
    }
    return { ok: true, alreadyLoggedIn: false, message: '机构 SSO 登录成功' }
  }
}
