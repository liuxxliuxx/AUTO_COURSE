import type { Credentials } from '@shared/types'
import type { WorkflowRun, WorkflowStepSnapshot } from '@shared/workflows'
import type { CourseTaskExecutor } from './course-task-executor'
import { runLogContext, secretLogContext, redactSecrets } from '../services/logger'

export interface WorkflowRuntime {
  prepareStep?(step: WorkflowStepSnapshot): Promise<void>
  task: CourseTaskExecutor
  stop?(): Promise<void>
  openWindow(): Promise<void>
  cleanupStep(): Promise<void>
  dispose(): Promise<void>
}
export class WorkflowExecutor {
  cancelled = false
  constructor(readonly run: WorkflowRun, readonly runtime: WorkflowRuntime, private changed: () => void) { }
  async stop(): Promise<void> {
    this.cancelled = true; this.run.state = 'stopping'; this.changed()
    await this.runtime.stop?.()
  }
  async execute(credentials: ReadonlyMap<string, Credentials>): Promise<void> {
    await secretLogContext.run([...credentials.values()].map(c=>c.password), async () => {
    try {
      for (const [index, step] of this.run.snapshot.steps.entries()) {
        if (this.cancelled) break
        const state = this.run.steps[index]
        state.state = 'running'; state.startedAt = new Date().toISOString(); this.changed()
        await runLogContext.run({ workflowId: this.run.workflowId, runId: this.run.id, stepId: step.id }, async () => {
          try {
            await this.runtime.prepareStep?.(step)
            if (this.cancelled) { state.state = 'cancelled'; return }
            const result = await this.runtime.task.execute(this.run, step, credentials.get(step.accountId)!)
            state.status = result
            state.state = this.cancelled ? 'cancelled' : result.stoppedReason === 'error' ? 'failed' : 'succeeded'
            state.error = result.error?.message ?? (state.state === 'failed' ? result.message : null)
          } catch (error) { state.state = this.cancelled ? 'cancelled' : 'failed'; state.error = redactSecrets(String(error)) }
          finally {
            try { await this.runtime.cleanupStep() } catch (error) { state.state = 'failed'; state.error = redactSecrets(`清理失败：${String(error)}`) }
            state.finishedAt = new Date().toISOString(); this.changed()
          }
        })
      }
    } finally {
      for (const step of this.run.steps) if (step.state === 'pending') step.state = 'cancelled'
      try { await this.runtime.dispose() } catch (error) { this.run.message = redactSecrets(`资源清理失败：${String(error)}`) }
      const failed = this.run.steps.filter(s => s.state === 'failed').length
      this.run.state = this.cancelled ? 'cancelled' : failed === 0 ? 'succeeded' : failed === this.run.steps.length ? 'failed' : 'partial'
      this.run.finishedAt = new Date().toISOString()
      this.run.message ||= this.cancelled ? '已停止' : `完成 ${this.run.steps.filter(s => s.state === 'succeeded').length} 步，失败 ${failed} 步`
      this.changed()
    }
    })
  }
}
