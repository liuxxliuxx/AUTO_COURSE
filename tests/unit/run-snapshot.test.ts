import { afterEach, describe, expect, it, vi } from 'vitest'
import { Database } from '../../src/main/storage/database'
import { SettingsService } from '../../src/main/services/settings-service'
import { CourseService } from '../../src/main/services/course-service'
import { BotService } from '../../src/main/services/bot-service'
import { EventBus } from '../../src/main/services/event-bus'
import { DEFAULT_COURSE_OPTIONS } from '../../src/shared/courses'
import type { BrowserService } from '../../src/main/automation/browser-service'
import type { CredentialStore } from '../../src/main/storage/credentials'
import type { RunnerContext, RunOutcome } from '../../src/main/automation/runner'
const dbs: Database[] = []
afterEach(() => dbs.splice(0).forEach(db => db.close()))
function harness() {
  const db = new Database(':memory:'); dbs.push(db)
  const settings = new SettingsService(db), bus = new EventBus()
  let bot: BotService
  const courses = new CourseService(db, settings, () => bot?.isRunning() ? bot.getStatus().courseId ?? null : null)
  let ctx!: RunnerContext
  let finish!: (outcome: RunOutcome) => void
  const complete = new Promise<RunOutcome>(resolve => { finish = resolve })
  const creds = { get: () => ({ username: 'fixture-user', password: 'fixture-password' }) } as unknown as CredentialStore
  const browser = { openSession: async () => ({}) } as unknown as BrowserService
  const factory = vi.fn(() => ({ mode: 'classic' as const, run: async (context: RunnerContext) => { ctx = context; return complete } }))
  bot = new BotService(db, creds, settings, bus, browser, factory, async () => null, courses)
  const add = (key: string) => { const result = courses.create({ name: key, url: `https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=${key}`, options: { ...DEFAULT_COURSE_OPTIONS } }); if (!result.ok) throw Error(result.message); return result.courseId! }
  return { db, settings, courses, bot, bus, add, factory, context: () => ctx, finish }
}
describe('单课程运行快照', () => {
  it('启动后更改其他课程与全局配置不会改变本次任务，也不会将进度写给其他课程', async () => {
    const h = harness(), a = h.add('A'), b = h.add('B')
    expect(await h.bot.start({ courseId: a })).toEqual({ ok: true })
    await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce())
    expect(await h.bot.start({ courseId: b })).toMatchObject({ ok: false })
    h.courses.select(b); h.settings.update({ courseNote: '错误全局名', loginMethod: 'upc', transcribeBaseDir: '/changed' })
    const courseB = h.courses.get(b)!
    h.courses.update(b, { name: courseB.name, url: courseB.url, options: { ...courseB.options, timeLimitMinutes: 10 } })
    h.context().reportVideoCompleted('第二章')
    expect(h.context().settings.courseNote).toBe('A'); expect(h.context().settings.loginMethod).toBe('zhihuishu')
    expect(h.courses.get(a)?.lastVideoTitle).toBe('第二章'); expect(h.courses.get(b)?.lastVideoTitle).toBeNull()
    expect(h.bot.getStatus().snapshot?.course.id).toBe(a)
    h.finish({ reason: 'completed', completedCount: 1, watchedSeconds: 0 })
    await vi.waitFor(() => expect(h.bot.isRunning()).toBe(false))
    expect(h.db.getCourseProgress('A')).toBeNull()
  })
  it('不同人工介入类型可区分，停止会解除等待并完成收尾', async () => {
    const h = harness(), id = h.add('A')
    await h.bot.start({ courseId: id }); await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce())
    h.context().reportPhase?.('login')
    const pending = h.context().requestCaptcha('login', '请手动登录', 'manual-login')
    expect(h.bot.getStatus().intervention?.kind).toBe('manual-login')
    expect(h.bot.getStatus().phase).toBe('waiting')
    const stopping = h.bot.stop(); expect(await pending).toBe(false)
    h.finish({ reason: 'user', completedCount: 0, watchedSeconds: 0 }); await stopping
    expect(h.bot.getStatus().intervention).toBeNull(); expect(h.bot.isRunning()).toBe(false)
  })
  it('登录失败结果保留明确阶段与错误', async () => {
    const h = harness(), id = h.add('A')
    await h.bot.start({ courseId: id }); await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce())
    h.finish({ reason: 'error', completedCount: 0, watchedSeconds: 0, error: { stage: 'login', code: 'login', message: '认证失败' } })
    await vi.waitFor(() => expect(h.bot.isRunning()).toBe(false))
    expect(h.bot.getStatus()).toMatchObject({ message: '认证失败', error: { code: 'login' }, phase: 'finished' })
  })
})
