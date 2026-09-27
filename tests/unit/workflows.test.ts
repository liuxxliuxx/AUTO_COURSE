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
const dbs: Database[] = []
afterEach(() => dbs.splice(0).forEach(db => db.close()))
function harness(work: (ctx: RunnerContext) => Promise<RunOutcome> = async () => ({ reason: 'completed', completedCount: 1, watchedSeconds: 1 })) {
  const db = new Database(':memory:'); dbs.push(db)
  const settings = new SettingsService(db); let manager: WorkflowRunManager
  const courses = new CourseService(db, settings, () => manager?.occupiedCourses() ?? [])
  const flows = new WorkflowService(db, courses, id => manager?.isActive(id) ?? false)
  const repo = new RunRepository(db), credentials = { username: 'fixture', password: 'secret' }
  const cleanup = vi.fn(async () => { }), opened: string[] = [], contexts: RunnerContext[] = []
  manager = new WorkflowRunManager(flows, courses, settings, () => credentials, repo, (run, report) => {
    const bus = new EventBus(); bus.on('event:bot-status', s => report(s))
    const browser = { openSession: async () => ({}) } as unknown as BrowserService
    const bot = new BotService(db, { get: () => credentials } as CredentialStore, settings, bus, browser, () => ({ mode: 'classic', run: async (ctx) => { contexts.push(ctx); return work(ctx) } }), async () => null, courses)
    return { task: new CourseTaskExecutor(bot, courses), openWindow: async () => { opened.push(run.id) }, cleanupStep: cleanup, dispose: async () => { await bot.dispose(); bus.clear() } }
  })
  const add = (name: string) => { const result = courses.create({ name, url: `https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=${name}`, options: { ...DEFAULT_COURSE_OPTIONS } }); if (!result.ok) throw Error(result.message); return result.courseId! }
  const input = (ids: string[]): WorkflowInput => ({ name: ids.join(','), steps: ids.map(courseId => ({ id: randomUUID(), courseId, options: { ...DEFAULT_COURSE_OPTIONS } })), schedule: null })
  const done = async () => vi.waitFor(() => expect(manager.occupiedCourses()).toHaveLength(0))
  return { db, settings, courses, flows, repo, manager, add, input, done, cleanup, contexts, opened }
}
describe('workflow persistence and lifecycle', () => {
  it('disabled schedules persist and never fire, including overdue one-time schedules', () => {
    const h = harness(), a = h.add('A')
    const now = Date.now()
    for (const kind of ['daily', 'once'] as const) {
      const flow = h.flows.create({ ...h.input([a]), schedule: { kind, enabled: true, timeZone: 'Asia/Shanghai', time: kind === 'daily' ? '09:00' : new Date(now + 60000).toISOString(), nextAt: null } })
      h.flows.setSchedule(flow.id, { ...flow.schedule!, time: kind === 'once' ? new Date(now - 60000).toISOString() : '09:00', nextAt: new Date(now - 60000).toISOString() })
      const current = h.flows.get(flow.id)!
      h.flows.update(flow.id, current.version, { ...current, schedule: { ...current.schedule!, enabled: false } })
      const reloaded = new WorkflowService(h.db, h.courses, () => false).get(flow.id)!
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
    expect(new WorkflowService(h.db, h.courses, () => false).get(flow.id)?.steps[0].options.timeLimitMinutes).toBe(3)
    const updated = h.flows.update(flow.id, 1, { ...flow, steps: [...flow.steps].reverse() })
    expect(updated.steps[0].courseId).toBe(b); expect(() => h.flows.update(flow.id, 1, flow)).toThrow('修改')
    expect(h.courses.remove(a)).toMatchObject({ ok: false }); h.flows.remove(flow.id); expect(h.courses.remove(a).ok).toBe(true)
  })
  it('transaction rolls back partial writes and legacy migration is idempotent', () => {
    const h = harness(), a = h.add('A'); h.db.setSetting('schedulerCourseId', a)
    h.flows.migrateLegacy(); h.flows.migrateLegacy(); expect(h.flows.list()).toHaveLength(1); expect(h.flows.list()[0].schedule).toBeNull()
    h.db.raw().exec("CREATE TRIGGER fail_step BEFORE INSERT ON workflow_steps BEGIN SELECT RAISE(ABORT,'fail insert'); END")
    expect(() => h.flows.create(h.input([a]))).toThrow(); expect(h.flows.list()).toHaveLength(1)
  })
  it('parallel runs reserve ALL courses synchronously and reject later overlap before execution', async () => {
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
