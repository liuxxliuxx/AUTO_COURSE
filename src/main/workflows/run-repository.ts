import type { RunEvent, WorkflowRun } from '@shared/workflows'
import type { Database } from '../storage/database'
export class RunRepository {
  constructor(private db: Database) { }
  save(run: WorkflowRun): void {
    this.db.transaction(() => {
      this.db.raw().prepare('INSERT INTO workflow_runs VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data').run(run.id, run.workflowId, run.state, run.startedAt, JSON.stringify(run))
      for (const step of run.steps) this.db.raw().prepare('INSERT OR REPLACE INTO workflow_step_runs VALUES(?,?,?)').run(run.id, step.stepId, JSON.stringify(step))
    })
  }
  get(id: string): WorkflowRun | null { const row = this.db.raw().prepare('SELECT data FROM workflow_runs WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : null }
  list(): WorkflowRun[] { return (this.db.raw().prepare('SELECT data FROM workflow_runs ORDER BY started_at DESC,id DESC').all() as { data: string }[]).map(r => JSON.parse(r.data)) }
  event(value: RunEvent): void { this.db.raw().prepare('INSERT INTO workflow_run_events(run_id,data) VALUES(?,?)').run(value.runId, JSON.stringify(value)) }
  logs(id: string): RunEvent[] { return (this.db.raw().prepare('SELECT data FROM workflow_run_events WHERE run_id=? ORDER BY id').all(id) as { data: string }[]).map(r => JSON.parse(r.data)) }
  recover(): void {
    for (const run of this.list().filter(r => r.state === 'running' || r.state === 'stopping')) {
      run.state = 'interrupted'; run.finishedAt = new Date().toISOString(); run.message = '应用退出导致运行中断，请手动重新运行'
      run.steps.forEach(s => { if (s.state === 'running' || s.state === 'pending') { s.state = 'interrupted'; s.finishedAt = run.finishedAt } })
      this.save(run)
    }
  }
}
