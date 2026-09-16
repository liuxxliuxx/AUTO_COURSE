/**
 * 登录态检查 —— 「能复用就复用」。
 *
 * 背景：v1/v2 早期都是「先导航到登录页，再填一次账号密码」。
 * 结果就是明明已经登录、课程窗口里还挂着课，一点开始又跳回登录页重来一遍。
 *
 * 这里只用浏览器自己的能力：
 *  - `page.request`（Playwright 的 APIRequestContext，与页面共享 cookie）发请求；
 *  - 需要看前端跳转的场合（智慧树学习页是 SPA）就导航一次，看最终落在哪个 URL。
 *
 * 判断一律**偏保守**：拿不准就返回"没登录"，让调用方照常走登录流程 ——
 * 多登一次的代价远小于"以为登录了其实没有"。
 */

import type { LoginContext } from './provider'
import type { BrowserSession } from '../browser-session'
import { SLEEP, UPC_BASE_URL, VIDEO_LIST_ITEM_CSS } from '../constants'
import type { Logger } from '../../services/logger'

/**
 * 这个 URL 看起来是不是登录/认证页。
 *
 * 覆盖两类目标站点：
 *  - 智慧树：`login.zhihuishu.com` / `passport.zhihuishu.com`
 *  - 数字石大 CAS：`cas.upc.edu.cn/cas/login`
 */
export function isLoginUrl(url: string): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.toLowerCase()

  if (host.startsWith('login.') || host.startsWith('passport.')) return true
  if (host === 'cas.upc.edu.cn') return true
  if (/(^|\.)sso\./.test(host)) return true
  if (path.includes('/login') || path.includes('/cas/') || path.includes('/passport')) return true
  return false
}

/** 会话里有没有这个站点的 cookie（一个都没有 ⇒ 一定是全新会话）。 */
export async function hasCookiesFor(session: BrowserSession, target: string): Promise<boolean> {
  try {
    const host = new URL(target).hostname.replace(/^www\./, '')
    const cookies = await session.getCookies()
    return cookies.some((cookie) => {
      const domain = cookie.domain.replace(/^\./, '')
      return host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`)
    })
  } catch {
    return false
  }
}

export interface CourseSessionState {
  loggedIn: boolean
  /** 说明为什么（日志与 UI 文案都用它） */
  detail: string
}

/**
 * 登录检查只有仍停在请求的课程入口才算成功。
 *
 * 智慧树的失效会话会先落到 onlineh5 的学生首页，再由前端跳去登录中心；
 * 只排除 login.* 会在这个中间页产生短暂的假阳性。
 */
export function isCourseDestination(target: string, current: string): boolean {
  try {
    const expected = new URL(target)
    const actual = new URL(current)
    const normalizePath = (path: string): string => path.replace(/\/+$/, '') || '/'
    return (
      actual.origin === expected.origin &&
      normalizePath(actual.pathname) === normalizePath(expected.pathname)
    )
  } catch {
    return false
  }
}

/**
 * 现在能不能直接打开课程页 —— 也就是"这次还需不需要登录"。
 *
 * 智慧树的学习页是 SPA：未登录时 HTTP 依然返回 200、也没有 Location 头，
 * 跳登录页是前端 JS 干的（实测 `page.request` 拿不到任何信号）。
 * 所以这里真导航一次，用**最终 URL** 判断。
 */
export async function checkCourseSession(ctx: LoginContext): Promise<CourseSessionState> {
  const { session, settings, log } = ctx
  const target = settings.videoUrl?.trim()

  if (!target) return { loggedIn: false, detail: '未配置课程地址' }

  if (!(await hasCookiesFor(session, target))) {
    return { loggedIn: false, detail: '会话里没有该站点的 cookie（全新会话）' }
  }

  try {
    await session.navigate(target)
  } catch (error) {
    return { loggedIn: false, detail: `打开课程页失败：${String(error)}` }
  }
  await session.playwrightPage.waitForTimeout(SLEEP.short)

  const current = session.getCurrentUrl()
  if (isLoginUrl(current)) {
    return { loggedIn: false, detail: `被带到登录页：${current}` }
  }
  if (!isCourseDestination(target, current)) {
    return { loggedIn: false, detail: `课程入口跳转到了其他页面：${current}` }
  }

  // Traditional course authentication is asynchronous. The initial URL and HTML
  // shell alone are not proof that the server granted access to the course.
  if (new URL(target).hostname === 'studyvideoh5.zhihuishu.com') {
    try {
      const expected = new URL(target)
      const ready = await session.playwrightPage.waitForFunction(
        ({ origin, pathname, selector }) => {
          if (location.origin !== origin || location.pathname !== pathname) return true
          const entry = document.querySelector(selector)
          if (!entry) return false
          const rect = entry.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && getComputedStyle(entry).visibility !== 'hidden'
        },
        { origin: expected.origin, pathname: expected.pathname, selector: VIDEO_LIST_ITEM_CSS },
        { timeout: 15_000 }
      )
      await ready.dispose()
    } catch {
      return { loggedIn: false, detail: `未加载已授权的课程目录：${session.getCurrentUrl()}` }
    }
    if (!isCourseDestination(target, session.getCurrentUrl())) {
      return { loggedIn: false, detail: `加载课程目录期间发生跳转：${session.getCurrentUrl()}` }
    }
  }

  log.info(`会话仍然有效，复用现有登录：${current}`)
  return { loggedIn: true, detail: current }
}

/**
 * 数字石大门户会话是否还有效。
 *
 * 这个用**纯请求**就能判断（实测）：未登录时 `i.upc.edu.cn` 302 到
 * `cas.upc.edu.cn/cas/login?...`；已登录则停在门户页。
 * 会话还有效时不需要再注入账号密码 —— CAS 表单根本不会出现，
 * 旧实现会在这里弹"请手动登录"并干等用户操作。
 */
export async function isUpcPortalSessionAlive(
  session: BrowserSession,
  log: Logger
): Promise<boolean> {
  try {
    const response = await session.playwrightPage.request.get(UPC_BASE_URL, {
      maxRedirects: 5,
      timeout: 15_000
    })
    const landed = response.url()
    if (isLoginUrl(landed)) {
      log.info(`数字石大门户会话已失效（落在 ${landed}）`)
      return false
    }
    log.info(`数字石大门户会话仍有效：${landed}`)
    return true
  } catch (error) {
    log.warn(`探测数字石大门户会话失败：${String(error)}`)
    return false
  }
}
