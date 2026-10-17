import { AccountService } from '../../src/main/services/account-service'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Database } from '../../src/main/storage/database'
import { SettingsService } from '../../src/main/services/settings-service'
import { CourseService } from '../../src/main/services/course-service'
import { BotService } from '../../src/main/services/bot-service'
import { EventBus } from '../../src/main/services/event-bus'
import { WorkflowService } from '../../src/main/workflows/workflow-service'
import { WorkflowRunManager } from '../../src/main/workflows/workflow-run-manager'
import { WorkflowScheduler } from '../../src/main/workflows/workflow-scheduler'
import { RunRepository } from '../../src/main/workflows/run-repository'
import { CourseTaskExecutor } from '../../src/main/workflows/course-task-executor'
import { dailyOccurrence } from '../../src/main/workflows/schedule'
import { DEFAULT_COURSE_OPTIONS } from '../../src/shared/courses'
import type { RunnerContext, RunOutcome } from '../../src/main/automation/runner'
import type { BrowserService } from '../../src/main/automation/browser-service'
import type { CredentialStore } from '../../src/main/storage/credentials'
import type { WorkflowInput } from '../../src/shared/workflows'
const dbs: Database[] = [], dirs: string[] = []
afterEach(() => {dbs.splice(0).forEach(db => db.close());dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true}))})
function harness(work: (ctx: RunnerContext) => Promise<RunOutcome> = async () => ({ reason: 'completed', completedCount: 1, watchedSeconds: 1 })) {
  const db = new Database(':memory:'); dbs.push(db)
  const settings = new SettingsService(db); let manager: WorkflowRunManager
  const courses = new CourseService(db, settings, () => manager?.occupiedCourses() ?? [])
  const dir=mkdtempSync(join(tmpdir(),'ac-flow-'));dirs.push(dir)
  const accounts=new AccountService(db,dir,()=>manager?.occupiedAccounts()??[])
  const flows = new WorkflowService(db, courses, id => manager?.isActive(id) ?? false, accounts)
  const repo = new RunRepository(db), credentials = { username: 'fixture', password: 'secret' }
  const cleanup = vi.fn(async () => { }), opened: string[] = [], contexts: RunnerContext[] = []
  manager = new WorkflowRunManager(flows, courses, settings, accounts, repo, (run, report) => {
    const bus = new EventBus(); bus.on('event:bot-status', s => report(s))
    const browser = { openSession: async () => ({}) } as unknown as BrowserService
    const bot = new BotService(db, { get: () => credentials } as CredentialStore, settings, bus, browser, () => ({ mode: 'classic', run: async (ctx) => { contexts.push(ctx); return work(ctx) } }), async () => null, courses, accounts)
    return { task: new CourseTaskExecutor(bot, accounts), windowVisibility: async () => false, openWindow: async () => { opened.push(run.id) }, cleanupStep: cleanup, stop:()=>bot.stop('user'), dispose: async () => { await bot.dispose(); bus.clear() } }
  })
  const add = (name: string) => { const result = courses.create({ name, url: `https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=${name}`, options: { ...DEFAULT_COURSE_OPTIONS } }); if (!result.ok) throw Error(result.message); return result.courseId! }
  const byCourse = new Map<string,string>()
  const accountFor=(courseId:string)=>{let id=byCourse.get(courseId);if(!id){id=accounts.create({name:courseId,username:'fixture',password:'secret',loginMethod:'zhihuishu',loggedUrl:''}).id;byCourse.set(courseId,id)}return id}
  const input = (ids: string[]): WorkflowInput => ({ name: ids.join(','), steps: ids.map(courseId => ({ id: randomUUID(), accountId:accountFor(courseId), courseId, options: { ...DEFAULT_COURSE_OPTIONS } })), schedule: null })
  const done = async () => vi.waitFor(() => expect(manager.occupiedCourses()).toHaveLength(0))
  return { db, accounts, accountFor, settings, courses, flows, repo, manager, add, input, done, cleanup, contexts, opened }
}
describe('workflow persistence and lifecycle', () => {
  it('uses each saved step skip-completed option instead of the global or course default', async () => {
    const h=harness(),a=h.add('A'),input=h.input([a,a])
    input.steps[0].options.skipCompleted=false
    input.steps[1].options.skipCompleted=true
    const flow=h.flows.create(input)
    expect(h.courses.get(a)?.options.skipCompleted).toBe(true)
    expect(h.manager.start(flow.id).ok).toBe(true)
    await h.done()
    expect(h.contexts.map(ctx=>ctx.settings.skipCompleted)).toEqual([false,true])
  })
  it('disabled schedules persist and never fire, including overdue one-time schedules', () => {
    const h = harness(), a = h.add('A')
    const now = Date.now()
    for (const kind of ['daily', 'once'] as const) {
      const flow = h.flows.create({ ...h.input([a]), schedule: { kind, enabled: true, timeZone: 'Asia/Shanghai', time: kind === 'daily' ? '09:00' : new Date(now + 60000).toISOString(), nextAt: null } })
      h.flows.setSchedule(flow.id, { ...flow.schedule!, time: kind === 'once' ? new Date(now - 60000).toISOString() : '09:00', nextAt: new Date(now - 60000).toISOString() })
      const current = h.flows.get(flow.id)!
      h.flows.update(flow.id, current.version, { ...current, schedule: { ...current.schedule!, enabled: false } })
      const reloaded = new WorkflowService(h.db, h.courses, () => false, h.accounts).get(flow.id)!
      expect(reloaded.schedule).toMatchObject({ enabled: false, nextAt: null })
      expect(reloaded.steps).toEqual(flow.steps)
    }
    new WorkflowScheduler(h.db, h.flows, h.manager).tick(now + 86400000)
    expect(h.repo.list()).toHaveLength(0)
    expect(h.db.raw().prepare('SELECT * FROM workflow_schedule_firings').all()).toHaveLength(0)
  })
  it('persists ordered independent options, rejects stale edits and deletion of referenced courses', () => {
    const h = harness(), a = h.add('A'), b = h.add('B'), input = h.input([a, b]); input.steps[0].options.timeLimitMinutes = 3
    const flow = h.flows.create(input); input.steps[0].options.timeLimitMinutes = 99
    expect(new WorkflowService(h.db, h.courses, () => false, h.accounts).get(flow.id)?.steps[0].options.timeLimitMinutes).toBe(3)
    const updated = h.flows.update(flow.id, 1, { ...flow, steps: [...flow.steps].reverse() })
    expect(updated.steps[0].courseId).toBe(b); expect(() => h.flows.update(flow.id, 1, flow)).toThrow('修改')
    expect(h.courses.remove(a)).toMatchObject({ ok: false }); h.flows.remove(flow.id); expect(h.courses.remove(a).ok).toBe(true)
  })
  it('transaction rolls back partial writes without importing legacy schedules', () => {
    const h = harness(), a = h.add('A'); h.db.setSetting('schedulerCourseId', a)
    expect(h.flows.list()).toHaveLength(0)
    h.db.raw().exec("CREATE TRIGGER fail_step BEFORE INSERT ON workflow_steps BEGIN SELECT RAISE(ABORT,'fail insert'); END")
    expect(() => h.flows.create(h.input([a]))).toThrow(); expect(h.flows.list()).toHaveLength(0)
  })
  it('parallel runs reserve ALL accounts synchronously and reject later overlap before execution', async () => {
    const release: Array<() => void> = []; const h = harness(async () => { await new Promise<void>(r => release.push(r)); return { reason: 'completed', completedCount: 1, watchedSeconds: 0 } })
    const a = h.add('A'), b = h.add('B'), c = h.add('C'), first = h.flows.create(h.input([a, b])), other = h.flows.create(h.input([c]))
    const r1 = h.manager.start(first.id), r2 = h.manager.start(other.id), conflict = h.manager.start(h.flows.create(h.input([b])).id)
    expect(r1.ok && r2.ok).toBe(true); expect(conflict).toMatchObject({ ok: false }); expect(h.manager.start(first.id).ok).toBe(false)
    expect(h.manager.occupiedCourses()).toHaveLength(3)
    expect(() => h.flows.remove(first.id)).toThrow('运行'); expect(h.courses.update(b, { ...h.courses.get(b)! })).toMatchObject({ ok: false })
    h.flows.update(first.id, 1, { ...first, steps: [first.steps[0]] })
    await vi.waitFor(() => expect(release).toHaveLength(2)); expect(h.contexts).toHaveLength(2)
    release.splice(0).forEach(r => r()); await vi.waitFor(() => expect(release).toHaveLength(1)); release[0](); await h.done()
    expect(h.repo.list().find(r => r.id === (r1.ok ? r1.runId : ''))!.snapshot.steps).toHaveLength(2)
  })
  it('continues after failure and reads updated continuation for a repeated course', async () => {
    let n = 0; const h = harness(async ctx => { n++; if (n === 1) throw Error('login failed'); if (n === 2) ctx.reportVideoCompleted('chapter 2'); if (n === 3) expect(ctx.lastVideoTitle).toBe('chapter 2'); return { reason: 'time-limit', completedCount: 1, watchedSeconds: 2 } })
    const a = h.add('A'), input = h.input([a, a, a]); input.steps.forEach(s => s.options.startPosition = 'resume'); const flow = h.flows.create(input)
    h.manager.start(flow.id); await h.done(); expect(h.repo.list()[0].state).toBe('partial'); expect(h.repo.list()[0].steps.map(s => s.state)).toEqual(['failed', 'succeeded', 'succeeded']); expect(h.cleanup).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(h.repo.list())).not.toContain('secret')
  })
  it('interventions and stop target one run; rejects stale confirmation', async () => {
    const h = harness(async ctx => { await ctx.requestCaptcha('login', 'fixture', 'manual-login'); return { reason: ctx.shouldStop() ? 'user' : 'completed', completedCount: 0, watchedSeconds: 0 } })
    const a = h.add('A'), b = h.add('B'), flow = h.flows.create(h.input([a, a])), other = h.flows.create(h.input([b])); const r = h.manager.start(flow.id), s = h.manager.start(other.id); if (!r.ok || !s.ok) throw Error('start')
    await vi.waitFor(() => expect(h.repo.get(s.runId)?.steps[0].status?.intervention?.id).toBeTruthy())
    expect(() => h.manager.confirm(s.runId, 'wrong', 'wrong')).toThrow('过期')
    await h.manager.stop(r.runId); expect(h.repo.get(r.runId)?.steps.map(s => s.state)).toEqual(['cancelled', 'cancelled']); expect(h.repo.get(s.runId)?.state).toBe('running')
    const step = h.repo.get(s.runId)!.steps[0]; h.manager.confirm(s.runId, step.stepId, step.status!.intervention!.id!); await h.done(); expect(h.repo.get(s.runId)?.state).toBe('succeeded')
  })
  it('recovery marks incomplete history interrupted without restarting', async () => {
    const h = harness(), a = h.add('A'), flow = h.flows.create(h.input([a])); h.manager.start(flow.id); await h.done()
    const run = h.repo.list()[0]; run.state = 'running'; run.steps[0].state = 'running'; h.repo.save(run); h.repo.recover(); expect(h.repo.get(run.id)?.state).toBe('interrupted')
  })
})
describe('workflow schedules', () => {
  it('catches up latest daily occurrence once, survives repeated ticks and advances despite rejection', async () => {
    const h = harness(), a = h.add('A'), flow = h.flows.create(h.input([a])), now = Date.parse('2030-01-05T05:00:00Z')
    h.flows.setSchedule(flow.id, { kind: 'daily', enabled: true, time: '09:00', timeZone: 'Asia/Shanghai', nextAt: '2030-01-01T01:00:00Z' })
    const scheduler = new WorkflowScheduler(h.db, h.flows, h.manager); scheduler.tick(now); scheduler.tick(now); await h.done()
    expect(h.repo.list()).toHaveLength(1); expect(h.flows.get(flow.id)?.schedule?.nextAt).toBe('2030-01-06T01:00:00.000Z')
    const rows = h.db.raw().prepare('SELECT * FROM workflow_schedule_firings').all(); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ scheduled_at: '2030-01-05T01:00:00.000Z' })
  })
  it('single schedule is consumed once; same-time overlapping workflows are rejected deterministically', async () => {
    const h = harness(), a = h.add('A'), f = h.flows.create(h.input([a])), g = h.flows.create(h.input([a])), now = Date.parse('2030-01-05T05:00:00Z')
    for (const flow of [f, g]) h.flows.setSchedule(flow.id, { kind: 'once', enabled: true, time: new Date(now).toISOString(), timeZone: 'Asia/Shanghai', nextAt: new Date(now).toISOString() })
    const scheduler = new WorkflowScheduler(h.db, h.flows, h.manager); scheduler.tick(now); scheduler.tick(now); await h.done()
    expect(h.repo.list().map(r => r.state).sort()).toEqual(['rejected', 'succeeded']); expect(h.flows.get(f.id)?.schedule?.enabled).toBe(false)
  })
  it('handles daylight saving gaps and overlaps as one occurrence', () => {
    const s = { kind: 'daily' as const, enabled: true, time: '02:30', timeZone: 'America/New_York', nextAt: null }
    expect(dailyOccurrence(s, Date.parse('2030-03-10T05:00:00Z'), true)).toBe('2030-03-10T07:00:00.000Z')
    expect(dailyOccurrence({ ...s, time: '01:30' }, Date.parse('2030-11-03T04:00:00Z'), true)).toBe('2030-11-03T05:30:00.000Z')
  })
})

describe('cache maintenance launch lock', () => {
  it('rejects cleanup while a runtime is active, including its shutdown', async () => {
    let release!: () => void
    const h = harness(async () => { await new Promise<void>(resolve => { release = resolve }); return { reason: 'completed', completedCount: 1, watchedSeconds: 0 } })
    const flow = h.flows.create(h.input([h.add('A')]))
    expect(h.manager.start(flow.id).ok).toBe(true)
    const cleanup = vi.fn(async () => {})
    await expect(h.manager.withMaintenance(cleanup)).rejects.toThrow('先停止')
    expect(cleanup).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release(); await h.done()
    await h.manager.withMaintenance(cleanup)
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('locks manual starts, preserves due schedules and releases the lock on failure', async () => {
    const h = harness(), now = Date.now()
    const flow = h.flows.create({ ...h.input([h.add('A')]), schedule: { kind: 'once', enabled: true, timeZone: 'Asia/Shanghai', time: new Date(now + 60000).toISOString(), nextAt: null } })
    h.flows.setSchedule(flow.id, { ...flow.schedule!, nextAt: new Date(now - 1000).toISOString() })
    let reject!: (error: Error) => void
    const pending = h.manager.withMaintenance(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    expect(h.manager.isMaintaining).toBe(true)
    expect(h.manager.start(flow.id)).toMatchObject({ ok: false, message: expect.stringContaining('清理缓存') })
    await expect(h.manager.withMaintenance(async () => {})).rejects.toThrow('清理缓存')
    const scheduler = new WorkflowScheduler(h.db, h.flows, h.manager)
    scheduler.tick(now)
    expect(h.flows.get(flow.id)?.schedule?.enabled).toBe(true)
    expect(h.db.raw().prepare('SELECT * FROM workflow_schedule_firings').all()).toHaveLength(0)
    await Promise.resolve()
    reject(Error('fixture cleanup failure'))
    await expect(pending).rejects.toThrow('fixture cleanup failure')
    expect(h.manager.isMaintaining).toBe(false)
    scheduler.tick(now)
    await h.done()
    expect(h.db.raw().prepare('SELECT * FROM workflow_schedule_firings').all()).toHaveLength(1)
  })
})

vi.mock('electron', () => ({safeStorage:{isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),decryptString:(value:Buffer)=>value.toString()}}))
