/** Built Vue UI with real course persistence and an isolated desktop IPC boundary. */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { Database } from '../../src/main/storage/database'
import { SettingsService } from '../../src/main/services/settings-service'
import { CourseService } from '../../src/main/services/course-service'
import type { CourseInput, CourseRunOptions, BotStatus, SchedulerConfig, SettingsPatch } from '../../src/shared/types'
let browser: Browser, server: FixtureServer, context: BrowserContext, page: Page, db: Database
let courses: CourseService, settings: SettingsService, starts: number, failSave: boolean, state: BotStatus
let pageErrors: string[]
const shots = '/private/tmp/auto-course-ui'
beforeAll(async () => { server = await startFixtureServer(resolve('out/renderer')); browser = await chromium.launch({ headless: true }); mkdirSync(shots, { recursive: true }) })
afterAll(async () => { await browser?.close(); await server?.close() })
beforeEach(async () => {
  db = new Database(':memory:'); settings = new SettingsService(db)
  starts = 0; failSave = false
  state = { state: 'idle', mode: null, currentTitle: null, completedCount: 0, watchedSeconds: 0, stoppedReason: null, message: '准备好后开始一门课程', tone: 'neutral' }
  courses = new CourseService(db, settings, () => state.state !== 'idle' ? state.courseId ?? null : null)
  context = await browser.newContext({ viewport: { width: 1180, height: 780 } }); page = await context.newPage()
  pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message))
  let config: SchedulerConfig = { enabled: false, courseId: null, startTime: '06:00', endTime: '23:00', allDay: false, dailyLimitMinutes: 0 }
  await page.exposeFunction('_invoke', async (name: string, args: unknown[]) => {
    let result: unknown
    switch (name) {
      case 'courses.list': return courses.list()
      case 'courses.create': if (failSave) throw new Error('fixture 保存失败'); result = courses.create(args[0] as CourseInput); break
      case 'courses.update': result = courses.update(args[0] as string, args[1] as CourseInput); break
      case 'courses.remove': result = courses.remove(args[0] as string); break
      case 'courses.select': result = courses.select(args[0] as string); break
      case 'courses.defaults': result = courses.defaults(args[0] as CourseRunOptions); break
      case 'settings.getAll': return settings.getAll()
      case 'settings.update': return settings.update(args[0] as SettingsPatch)
      case 'credentials.get': return { username: 'fixture-user', hasPassword: true }
      case 'credentials.state': case 'credentials.set': return { hasUsername: true, hasPassword: true, encryptionAvailable: true }
      case 'scheduler.get': return { config, inRange: true, targetReached: false, nextTickAt: 0 }
      case 'scheduler.update': config = { ...config, ...args[0] as Partial<SchedulerConfig> }; return { config, inRange: true, targetReached: false, nextTickAt: 0 }
      case 'bot.status': return state
      case 'bot.start': {
        const course = courses.get((args[0] as { courseId: string }).courseId)!
        starts += 1; state = { ...state, state: 'running', phase: 'executing', courseId: course.id,
          snapshot: { id: 'fixture-run', course, settings: settings.getAll(), startedAt: new Date().toISOString(), source: 'manual' } }
        return { ok: true }
      }
      case 'bot.stop': state = { ...state, state: 'idle' }; return
      case 'progress.get': return { today: { date: '2026-09-16', watchedSeconds: 0 }, sessionSeconds: 0, targetMinutes: 0 }
      case 'logs.recent': return []
      case 'transcription.get': return { phase: 'idle', title: null, completed: 0, failed: 0, message: '转录未启用', tone: 'neutral', percent: null }
      case 'app.version': return { version: '2.0.0', platform: 'darwin' }
      default: return null
    }
    return result
  })
  await page.addInitScript(() => {
    type Bridge = { _invoke(name: string, args: unknown[]): Promise<unknown> }
    Object.defineProperty(window, 'appApi', { value: new Proxy({}, { get: (_target, domain: string) => {
      if (domain === 'events') return new Proxy({}, { get: () => () => () => {} })
      return new Proxy({}, { get: (_object, method: string) => (...args: unknown[]) => (window as unknown as Bridge)._invoke(`${domain}.${method}`, args) })
    } }) })
  })
  await page.goto(server.origin + '/index.html')
  await page.getByRole('heading', { name: '我的课程', exact: true }).waitFor()
})
afterEach(async () => { await context?.close(); db?.close(); expect(pageErrors).toEqual([]) })
async function add(name: string, key: string, action = 'learn'): Promise<void> {
  await page.getByRole('button', { name: '＋ 添加课程', exact: true }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('课程地址', { exact: false }).fill(`https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=${key}`)
  await form.getByLabel('课程名称', { exact: true }).fill(name)
  await form.getByLabel('运行方式', { exact: true }).selectOption(action)
  await form.getByRole('button', { name: '保存课程', exact: true }).click()
  await form.waitFor({ state: 'hidden' })
}
describe('课程与运行界面', () => {
  it('空状态、添加两门不同配置、切换与刷新后配置保持独立，保存不启动', async () => {
    expect(await page.getByText('从第一门课程开始').isVisible()).toBe(true)
    await page.screenshot({ path: `${shots}/empty.png`, fullPage: true })
    await add('艺术与审美', 'a', 'learn-transcribe'); await add('高等数学', 'b')
    expect(starts).toBe(0)
    await page.getByRole('button', { name: /艺术与审美 传统课/ }).click()
    expect(await page.getByRole('region', { name: '课程详情' }).getByText('学习并转录', { exact: true }).isVisible()).toBe(true)
    await page.getByRole('button', { name: '设为本次课程', exact: true }).click()
    await page.reload(); await page.getByRole('heading', { name: '艺术与审美', exact: true }).waitFor()
    expect(courses.list().courses).toHaveLength(2)
    await page.screenshot({ path: `${shots}/courses.png`, fullPage: true })
    await page.getByRole('button', { name: '开始运行 →', exact: true }).click()
    await page.getByRole('heading', { name: '运行', exact: true }).waitFor(); expect(starts).toBe(1)
    expect(await page.getByRole('button', { name: '开始运行', exact: true }).isDisabled()).toBe(true)
    await page.screenshot({ path: `${shots}/run.png`, fullPage: true })
    await page.getByRole('link', { name: '课程', exact: true }).click()
    expect(await page.getByRole('button', { name: '编辑', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: /高等数学 传统课/ }).click()
    expect(await page.getByRole('button', { name: '编辑', exact: true }).isEnabled()).toBe(true)
  })
  it('重复地址可打开已有课程，取消编辑不覆盖原课程，保存失败保留输入', async () => {
    await add('课程 A', 'a')
    await page.getByRole('button', { name: '＋ 添加课程', exact: true }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('课程地址', { exact: false }).fill('https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=a')
    await form.getByLabel('课程名称', { exact: true }).fill('重复课程')
    await form.getByRole('button', { name: '保存课程', exact: true }).click()
    await form.getByRole('button', { name: '打开已有课程', exact: true }).click()
    expect(courses.list().courses).toHaveLength(1)
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await form.getByLabel('课程名称', { exact: true }).fill('不保存的名称')
    page.once('dialog', dialog => dialog.accept()); await form.getByRole('button', { name: '取消', exact: true }).click()
    expect(courses.list().courses[0].name).toBe('课程 A')
    await page.getByRole('button', { name: '＋ 添加课程', exact: true }).click()
    await form.getByLabel('课程地址', { exact: false }).fill('https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=b')
    await form.getByLabel('课程名称', { exact: true }).fill('输入应保留')
    failSave = true; await form.getByRole('button', { name: '保存课程', exact: true }).click()
    await form.getByRole('alert').waitFor(); expect(await form.getByLabel('课程名称', { exact: true }).inputValue()).toBe('输入应保留')
    await page.screenshot({ path: `${shots}/save-error.png`, fullPage: true })
    failSave = false; await form.getByRole('button', { name: '保存课程', exact: true }).click(); await form.waitFor({ state: 'hidden' })
  })
  it('账号密码不回填、默认设置不改变现有课程、调度课程可独立选择', async () => {
    await add('课程 A', 'a'); await add('课程 B', 'b')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByText('留空保留已保存的密码', { exact: false }).count() // placeholder assertion below
    await page.getByPlaceholder('留空保留已保存的密码').waitFor()
    expect(await page.getByPlaceholder('留空保留已保存的密码').inputValue()).toBe('')
    await page.screenshot({ path: `${shots}/settings.png`, fullPage: true })
    await page.getByRole('button', { name: '课程默认配置', exact: true }).click()
    await page.getByLabel('运行方式', { exact: true }).selectOption('transcribe')
    await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.getByRole('status').waitFor()
    expect(courses.list().courses.every(c => c.options.action === 'learn')).toBe(true)
    expect(courses.list().defaults.action).toBe('transcribe')
    await page.getByRole('button', { name: '自动调度', exact: true }).click()
    const a = courses.list().courses.find(c => c.name === '课程 A')!
    await page.getByLabel('调度课程', { exact: false }).selectOption(a.id)
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    expect(courses.list().selectedCourseId).not.toBe(a.id)
  })
  it('键盘焦点限制在表单，长名称和窄窗口没有水平溢出', async () => {
    await add('这是一门名称较长的课程，用于检查缩放后的布局与文字换行', 'long')
    await page.setViewportSize({ width: 740, height: 570 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByLabel('课程地址', { exact: false }).focus(); await page.keyboard.press('Shift+Tab')
    expect(await page.getByRole('dialog').getByRole('button', { name: '保存课程', exact: true }).evaluate(el => el === document.activeElement)).toBe(true)
    await page.screenshot({ path: `${shots}/compact-form.png`, fullPage: true })
    await page.keyboard.press('Escape'); expect(await page.getByRole('dialog').count()).toBe(0)
  })
})
