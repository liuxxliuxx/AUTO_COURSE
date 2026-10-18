/**
 * 登录提供方契约（handoff §11）。
 *
 * 不同登录方式各自实现，**不要**在 Runner 里散落 `if (loginType === ...)`。
 */

import type { AppSettings, Credentials, LoginMethod } from '@shared/types'
import type { BrowserSession } from '../browser-session'
import type { CaptchaService } from '../captcha'
import type { Logger } from '../../services/logger'
import { ZhihuishuLogin } from './zhihuishu'
import { UpcInstitutionLogin } from './upc-institution'
import { UpcLegacyLogin } from './upc-legacy'

export interface LoginContext {
  session: BrowserSession
  settings: AppSettings
  credentials: Credentials
  captcha: CaptchaService
  /** 获取课程时先走所选账号的认证入口，不提前导航目标页面检查会话。 */
  authenticateFirst?: boolean
  /** 外部停止请求 */
  shouldStop: () => boolean
  log: Logger
}

export interface LoginResult {
  ok: boolean
  /** 本来就已经登录，跳过了登录流程 */
  alreadyLoggedIn: boolean
  message: string
}

export interface LoginProvider {
  readonly method: LoginMethod
  login(ctx: LoginContext): Promise<LoginResult>
}

/** 按方式挑实现。这是唯一出现分支的地方。 */
export function createLoginProvider(method: LoginMethod): LoginProvider {
  if (method === 'upc-institution') return new UpcInstitutionLogin()
  if (method === 'upc') return new UpcLegacyLogin()
  return new ZhihuishuLogin()
}
