import type { AccountService } from '../services/account-service'
import { randomUUID } from 'node:crypto'
import type { Workflow, WorkflowInput, WorkflowSchedule, WorkflowStep } from '@shared/workflows'
import { validateRunOptions, identifyCourse } from '@shared/courses'
import type { Database } from '../storage/database'
import type { CourseService } from '../services/course-service'
import { prepareSchedule } from './schedule'

export class WorkflowService {
  constructor(private db: Database, private courses: CourseService, private isActive: (id: string) => boolean, private accounts: AccountService) { }
  list(): Workflow[] { return (this.db.raw().prepare('SELECT id FROM workflows ORDER BY created_at,id').all() as { id: string }[]).map(r => this.get(r.id)!) }
  get(id: string): Workflow | null {
    const r = this.db.raw().prepare('SELECT * FROM workflows WHERE id=?').get(id) as { id: string; name: string; version: number; created_at: string; updated_at: string; notice: string | null } | undefined
    if (!r) return null
    const steps = (this.db.raw().prepare('SELECT * FROM workflow_steps WHERE workflow_id=? ORDER BY position').all(id) as { id: string; account_id: string; course_id: string; options: string }[]).map(s => ({ id: s.id, accountId: s.account_id, courseId: s.course_id, options: JSON.parse(s.options) }))
    const schedule = this.db.raw().prepare('SELECT config FROM workflow_schedules WHERE workflow_id=?').get(id) as { config: string } | undefined
    return { id: r.id, name: r.name, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, notice: r.notice, steps, schedule: schedule ? JSON.parse(schedule.config) : null }
  }
  private validate(input: WorkflowInput): WorkflowInput {
    if (!input.name?.trim()) throw new Error('请输入任务名称')
    if (!Array.isArray(input.steps) || !input.steps.length) throw new Error('至少添加一个课程步骤')
    const ids = new Set<string>()
    const steps: WorkflowStep[] = input.steps.map(s => {
      if (!s.id || ids.has(s.id)) throw new Error('步骤 ID 重复或为空')
      ids.add(s.id)
      if (!this.accounts.get(s.accountId)) throw new Error('请选择有效的账号')
      const course = this.courses.get(s.courseId)
      if (!course) throw new Error('课程不存在或已删除')
      identifyCourse(course.url); validateRunOptions(s.options, course.kind)
      return { id: s.id, accountId: s.accountId, courseId: s.courseId, options: { ...s.options } }
    })
    return { name: input.name.trim(), steps, schedule: prepareSchedule(input.schedule) }
  }
  create(input: WorkflowInput): Workflow { return this.save(randomUUID(), null, input) }
  update(id: string, version: number, input: WorkflowInput): Workflow { return this.save(id, version, input) }
  private save(id: string, version: number | null, input: WorkflowInput): Workflow {
    return this.db.transaction(() => {
      const existing = this.get(id)
      if (version !== null && (!existing || existing.version !== version)) throw new Error('任务已被修改，请重新加载后编辑')
      // Preserve an unchanged schedule, including overdue occurrences awaiting catch-up.
      const sameSchedule = existing && JSON.stringify(existing.schedule) === JSON.stringify(input.schedule)
      const value = this.validate({ ...input, schedule: sameSchedule ? null : input.schedule })
      if (sameSchedule) value.schedule = existing.schedule
      const now = new Date().toISOString()
      if (existing) this.db.raw().prepare('UPDATE workflows SET name=?,version=version+1,updated_at=?,notice=NULL WHERE id=?').run(value.name, now, id)
      else this.db.raw().prepare('INSERT INTO workflows(id,name,version,created_at,updated_at) VALUES(?,?,1,?,?)').run(id, value.name, now, now)
      this.db.raw().prepare('DELETE FROM workflow_steps WHERE workflow_id=?').run(id)
      value.steps.forEach((s, i) => this.db.raw().prepare('INSERT INTO workflow_steps VALUES(?,?,?,?,?,?)').run(s.id, id, i, s.accountId, s.courseId, JSON.stringify(s.options)))
      this.setSchedule(id, value.schedule)
      return this.get(id)!
    })
  }
  setSchedule(id: string, schedule: WorkflowSchedule | null): void {
    if (schedule) this.db.raw().prepare('INSERT OR REPLACE INTO workflow_schedules VALUES(?,?)').run(id, JSON.stringify(schedule))
    else this.db.raw().prepare('DELETE FROM workflow_schedules WHERE workflow_id=?').run(id)
  }
  remove(id: string): void {
    if (this.isActive(id)) throw new Error('任务正在运行，请先停止')
    this.db.raw().prepare('DELETE FROM workflows WHERE id=?').run(id)
  }
}
