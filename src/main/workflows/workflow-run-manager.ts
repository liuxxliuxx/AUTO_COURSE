import type { AccountService } from '../services/account-service'
import { redactSecrets } from '../services/logger'
import { randomUUID } from 'node:crypto'
import type { BotStatus, Credentials, TranscriptionStatus } from '@shared/types'
import type { WorkflowRun, WorkflowStartResult } from '@shared/workflows'
import type { WorkflowService } from './workflow-service'
import type { CourseService } from '../services/course-service'
import type { SettingsService } from '../services/settings-service'
import type { RunRepository } from './run-repository'
import { WorkflowExecutor, type WorkflowRuntime } from './workflow-executor'
import { identifyCourse, validateRunOptions, settingsForCourse } from '@shared/courses'

type RuntimeFactory = (run: WorkflowRun, report: (status?: BotStatus, transcription?: TranscriptionStatus) => void) => WorkflowRuntime
export class WorkflowRunManager {
  private active = new Map<string, { executor: WorkflowExecutor; done: Promise<void> }>()
  private reservations = new Map<string, string[]>()
  private closing = false
  private maintenance: Promise<unknown> | null = null
  get isMaintaining(): boolean { return this.maintenance !== null }
  async withMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) throw new Error('应用正在退出')
    if (this.maintenance) throw new Error('正在清理缓存，请稍候')
    if (this.active.size) throw new Error('请先停止所有运行中的任务，等待课程窗口关闭后再清理缓存')
    const pending = Promise.resolve().then(operation)
    this.maintenance = pending
    try { return await pending } finally { this.maintenance = null }
  }
  constructor(private flows: WorkflowService, private courses: CourseService, private settings: SettingsService, private accounts: AccountService, readonly repository: RunRepository, private factory: RuntimeFactory, private publish: (run: WorkflowRun) => void = () => { }) { repository.recover() }
  isActive(id: string): boolean { return [...this.active.values()].some(a => a.executor.run.workflowId === id) }
  occupiedAccounts(): string[] { return [...new Set([...this.reservations.values()].flat())] }
  occupiedCourses(): string[] { return [...this.active.values()].flatMap(a => a.executor.run.snapshot.steps.map(s => s.courseId)) }
  start(workflowId: string, source: 'manual' | 'schedule' = 'manual'): WorkflowStartResult {
    if (this.closing) return { ok: false, message: '应用正在退出' }
    if (this.isMaintaining) return { ok: false, message: '正在清理缓存，请稍候再启动任务' }
    const flow = this.flows.get(workflowId)
    if (!flow) return { ok: false, message: '任务不存在' }
    let run: WorkflowRun
    try {
      const steps = flow.steps.map(s => {
        const account = this.accounts.get(s.accountId)
        if (!account) throw new Error('账号不存在')
        const course = this.courses.get(s.courseId)
        if (!course) throw new Error('课程不存在')
        identifyCourse(course.url); validateRunOptions(s.options, course.kind)
        return { ...s, course: structuredClone(course), account: structuredClone(account) }
      })
      if (!steps.length) throw new Error('任务没有步骤')
      const settings = { ...this.settings.getAll(), autoMode: false }
      run = { id: randomUUID(), workflowId, source, state: 'running', snapshot: { workflow: structuredClone(flow), steps, settings }, startedAt: new Date().toISOString(), finishedAt: null, message: '', steps: steps.map(s => ({ stepId: s.id, state: 'pending', startedAt: null, finishedAt: null, status: null, transcription: null, error: null })) }
    } catch (e) { return { ok: false, message: String(e) } }
    const reject = (message: string): WorkflowStartResult => { run.state = 'rejected'; run.message = message; run.finishedAt = new Date().toISOString(); run.steps.forEach(s => s.state = 'cancelled'); this.repository.save(run); return { ok: false, message, runId: run.id } }
    for (const { executor } of this.active.values()) {
      if (executor.run.workflowId === workflowId) return reject('该任务已在运行')
      const overlap = run.snapshot.steps.find(s => executor.run.snapshot.steps.some(other => other.accountId === s.accountId))
      if (overlap) return reject(`账号“${overlap.account.name}”已被任务“${executor.run.snapshot.workflow.name}”占用`)
    }
    const creds = new Map<string, Credentials>()
    for (const step of run.snapshot.steps) {
      if (!creds.has(step.accountId)) {
        const value = this.accounts.credentials(step.accountId)
        if (!value.username.trim() || !value.password) return reject(`请为账号“${step.account.name}”保存登录账号和密码`)
        creds.set(step.accountId, { ...value })
      }
    }
    for (const step of run.snapshot.steps) {
      const errors = this.settings.validate(settingsForCourse({ ...run.snapshot.settings, loginMethod: step.account.loginMethod, loggedUrl: step.account.loggedUrl }, { ...step.course, options: step.options }))
      if (errors.length) return reject(errors.map(e => e.message).join('；'))
    }
    if (run.snapshot.steps.some(s => this.occupiedAccounts().includes(s.accountId))) return reject('账号已被其他任务占用')
    this.repository.save(run)
    this.reservations.set(run.id, [...new Set(run.snapshot.steps.map(s => s.accountId))])
    const changed = (): void => { this.repository.save(run); this.publish(structuredClone(run)) }
    let runtime: WorkflowRuntime
    try {
      runtime = this.factory(run, (status, transcription) => {
        const step = run.steps.find(s => s.state === 'running')
        if (!step) return
        if (status) step.status = status
        if (transcription) step.transcription = {...transcription,message:redactSecrets(transcription.message)}
        changed()
      })
    } catch (e) { this.reservations.delete(run.id); creds.clear(); return reject(`初始化失败：${String(e)}`) }
    const executor = new WorkflowExecutor(run, runtime, changed)
    // No await before reservation. Concurrent IPC starts cannot pass the same check.
    const slot = { executor, done: Promise.resolve() }
    this.active.set(run.id, slot)
    slot.done = Promise.resolve().then(() => executor.execute(creds)).catch(e => {
      run.state = 'failed'; run.message = String(e); run.finishedAt = new Date().toISOString(); changed()
    }).finally(() => { this.active.delete(run.id); this.reservations.delete(run.id); creds.clear() })
    return { ok: true, runId: run.id }
  }
  async stop(id: string): Promise<void> { const a = this.active.get(id); if (!a) return; await a.executor.stop(); await a.done }
  async openWindow(id: string): Promise<void> { const a = this.active.get(id); if (!a) throw new Error('运行已结束'); await a.executor.runtime.openWindow() }
  async windowVisibility(id: string, visible?: boolean): Promise<boolean | null> {
    return this.active.get(id)?.executor.runtime.windowVisibility(visible) ?? null
  }
  confirm(id: string, stepId: string, requestId: string): void {
    const a = this.active.get(id), step = a?.executor.run.steps.find(s => s.stepId === stepId && s.state === 'running')
    if (!step || !requestId || step.status?.intervention?.id !== requestId) throw new Error('处理请求已过期')
    a!.executor.runtime.task.bot.confirmIntervention()
  }
  async dispose(): Promise<void> { this.closing = true; await this.maintenance?.catch(() => {}); await Promise.all([...this.active.keys()].map(id => this.stop(id))) }
}
