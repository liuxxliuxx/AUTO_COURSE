/**
 * 登录态检查里可以用固定输入验证的部分。
 *
 * 「能复用就复用」的前提是判断本身靠得住：认错方向要么白白重登一次，
 * 要么在没登录的情况下直接去开课。这里把两头的边界钉死。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  hasCookiesFor,
  checkCourseSession,
  isCourseCenterLanding,
  isCourseDestination,
  isLoginUrl
} from '../../src/main/automation/login/session-check'
import type { BrowserSession } from '../../src/main/automation/browser-session'
import type { LoginContext } from '../../src/main/automation/login/provider'

describe('获取课程的登录顺序', () => {
  it('课程中心的所有同源父级路由都可等待，拒绝相似前缀和旁支路由', () => {
    expect(isCourseCenterLanding('https://hike-teaching-center.polymas.com/custom-stu-hike/')).toBe(true)
    expect(isCourseCenterLanding('https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike')).toBe(true)
    expect(isCourseCenterLanding('https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike/?from=sso#loading')).toBe(true)
    expect(isCourseCenterLanding('https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike/ai-course-center')).toBe(true)
    expect(isCourseCenterLanding('https://hike-teaching-center.polymas.com/custom-stu-hike/other')).toBe(false)
    expect(isCourseCenterLanding('https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike-other')).toBe(false)
    expect(isCourseCenterLanding('https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike/other')).toBe(false)
    expect(isCourseCenterLanding('https://hike-teaching-center.polymas.com/')).toBe(false)
    expect(isCourseCenterLanding('https://hub.polymas.com/custom-stu-hike/')).toBe(false)
  })
  it('认证前不凭残留 Cookie 导航目标主页', async () => {
    const navigate = vi.fn(), getCookies = vi.fn()
    const ctx = { authenticateFirst: true, session: { navigate, getCookies } } as unknown as LoginContext
    expect(await checkCourseSession(ctx)).toMatchObject({ loggedIn: false })
    expect(navigate).not.toHaveBeenCalled()
    expect(getCookies).not.toHaveBeenCalled()
  })
})

describe('isLoginUrl', () => {
  it('认得出智慧树与数字石大的登录页', () => {
    expect(isLoginUrl('https://login.zhihuishu.com/?origin=zhs&service=https%3A%2F%2Fx')).toBe(true)
    expect(isLoginUrl('https://passport.zhihuishu.com/login?service=x')).toBe(true)
    expect(
      isLoginUrl(
        'https://cas.upc.edu.cn/cas/login?service=http%3A%2F%2Fi.upc.edu.cn%2Fdcp%2Findex.jsp'
      )
    ).toBe(true)
  })

  it('不会把正常的课程页/工作台判成登录页', () => {
    expect(isLoginUrl('https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=abc123')).toBe(
      false
    )
    expect(isLoginUrl('https://hub.polymas.com/stu-hike/ctp/student-workspace')).toBe(false)
    expect(isLoginUrl('https://onlineweb.zhihuishu.com/')).toBe(false)
    expect(isLoginUrl('https://i.upc.edu.cn/dcp/index.jsp')).toBe(false)
    expect(isLoginUrl('')).toBe(false)
    expect(isLoginUrl('not a url')).toBe(false)
  })
})

describe('hasCookiesFor', () => {
  const withCookies = (domains: string[]): BrowserSession =>
    ({ getCookies: async () => domains.map((domain) => ({ domain })) }) as unknown as BrowserSession

  it('父域与本站 cookie 都算命中', async () => {
    const target = 'https://studyvideoh5.zhihuishu.com/stuStudy?x=1'
    expect(await hasCookiesFor(withCookies(['.zhihuishu.com']), target)).toBe(true)
    expect(await hasCookiesFor(withCookies(['studyvideoh5.zhihuishu.com']), target)).toBe(true)
  })

  it('别的站点 cookie 或空 cookie 都不算命中', async () => {
    const target = 'https://studyvideoh5.zhihuishu.com/stuStudy?x=1'
    expect(await hasCookiesFor(withCookies(['notzhihuishu.com']), target)).toBe(false)
    expect(await hasCookiesFor(withCookies([]), target)).toBe(false)
  })
})

describe('isCourseDestination', () => {
  const course =
    'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=4e595c584d5c4859'

  it('允许课程页自身更新查询参数或 hash', () => {
    expect(isCourseDestination(course, course + '#/lesson/1')).toBe(true)
    expect(
      isCourseDestination(course, 'https://studyvideoh5.zhihuishu.com/stuStudy?foo=bar')
    ).toBe(true)
  })

  it('不把未登录时经过的学生首页当成有效课程会话', () => {
    expect(
      isCourseDestination(course, 'https://onlineh5.zhihuishu.com/onlineWeb.html#/studentIndex')
    ).toBe(false)
    expect(isCourseDestination(course, 'https://login.zhihuishu.com/?origin=zhs')).toBe(false)
  })
})
