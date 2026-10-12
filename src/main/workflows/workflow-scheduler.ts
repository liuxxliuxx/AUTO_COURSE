import type { Database } from '../storage/database'
import type { WorkflowService } from './workflow-service'
import type { WorkflowRunManager } from './workflow-run-manager'
import { dailyOccurrence } from './schedule'
import { createLogger } from '../services/logger'
export class WorkflowScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(private db: Database, private flows: WorkflowService, private runs: WorkflowRunManager) { }
  start(): void { if (this.timer) return; this.tick(); this.timer = setInterval(() => this.tick(), 1000); this.timer.unref?.() }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null }
  tick(now = Date.now()): void {
    if (this.runs.isMaintaining) return
    const due = this.flows.list().filter(f => f.schedule?.enabled && f.schedule.nextAt && Date.parse(f.schedule.nextAt) <= now)
      .sort((a, b) => a.schedule!.nextAt!.localeCompare(b.schedule!.nextAt!) || a.id.localeCompare(b.id))
    for (const flow of due) {
      const schedule = flow.schedule!
      const at = schedule.kind === 'once' ? schedule.nextAt! : dailyOccurrence(schedule, now, false)
      const claimed = this.db.transaction(() => {
        const inserted = this.db.raw().prepare("INSERT OR IGNORE INTO workflow_schedule_firings VALUES(?,?,NULL,'claimed')").run(flow.id, at).changes > 0
        this.flows.setSchedule(flow.id, { ...schedule, enabled: schedule.kind === 'daily', nextAt: schedule.kind === 'daily' ? dailyOccurrence(schedule, now, true) : null })
        return inserted
      })
      if (!claimed) continue
      try {
        const result = this.runs.start(flow.id, 'schedule')
        this.db.raw().prepare('UPDATE workflow_schedule_firings SET run_id=?,outcome=? WHERE workflow_id=? AND scheduled_at=?').run(result.runId ?? null, result.ok ? 'started' : result.message, flow.id, at)
      } catch (error) {
        this.db.raw().prepare('UPDATE workflow_schedule_firings SET outcome=? WHERE workflow_id=? AND scheduled_at=?').run(String(error), flow.id, at)
        createLogger('workflow-scheduler').exception('定时启动失败', error)
      }
    }
  }
}
