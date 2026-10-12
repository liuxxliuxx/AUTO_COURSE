import { randomUUID } from 'node:crypto'
import type { Course, CourseInput, CourseLibrary, CourseMutationResult, CourseRunOptions } from '@shared/types'
import { identifyCourse, optionsFromLegacy, validateRunOptions } from '@shared/courses'
import type { Database } from '../storage/database'
import type { SettingsService } from './settings-service'
import { sanitizeCourseNote } from '../util/filename'

type Row = { id: string; identity: string; name: string; url: string; kind: Course['kind']; options: string;
  created_at: string; updated_at: string; last_run_at: string | null; progress_warning: string | null }

export class CourseService {
  constructor(private readonly db: Database, private readonly settings: SettingsService,
    private readonly runningCourseId: () => string | string[] | null = () => null) {
    if (!this.db.getSetting('courseDefaults')) this.db.setSetting('courseDefaults', JSON.stringify(optionsFromLegacy(this.settings.getAll())))
  }

  private decode(row: Row): Course {
    return { id: row.id, identity: row.identity, name: row.name, url: row.url, kind: row.kind,
      options: JSON.parse(row.options), createdAt: row.created_at, updatedAt: row.updated_at,
      lastRunAt: row.last_run_at, progressWarning: row.progress_warning }
  }
  list(): CourseLibrary {
    const rows = this.db.raw().prepare(`SELECT c.*, (SELECT MAX(p.last_run_at) FROM account_course_progress p WHERE p.course_id=c.id) AS last_run_at FROM courses c
      WHERE c.deleted_at IS NULL ORDER BY COALESCE((SELECT MAX(p.last_run_at) FROM account_course_progress p WHERE p.course_id=c.id),c.created_at) DESC, c.id`).all() as Row[]
    return { courses: rows.map(row => this.decode(row)), selectedCourseId: this.db.getSetting('selectedCourseId') || null,
      defaults: JSON.parse(this.db.getSetting('courseDefaults')) }
  }
  get(id: string): Course | null {
    const row = this.db.raw().prepare(`SELECT c.*, (SELECT MAX(p.last_run_at) FROM account_course_progress p WHERE p.course_id=c.id) AS last_run_at FROM courses c
      WHERE c.id=? AND c.deleted_at IS NULL`).get(id) as Row | undefined
    return row ? this.decode(row) : null
  }
  private mutate(fn: () => { courseId?: string } | void): CourseMutationResult {
    try { const result = this.db.transaction(fn); return { ok: true, library: this.list(), ...result } }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) } }
  }
  create(input: CourseInput): CourseMutationResult {
    try {
      const identity = identifyCourse(input.url).identity
      const existing = this.db.raw().prepare('SELECT id FROM courses WHERE identity=? AND deleted_at IS NULL').get(identity) as {id:string} | undefined
      if (existing) return { ok: false, message: '该课程已存在', existingCourseId: existing.id }
    } catch (error) { return { ok: false, message: String(error).replace(/^Error: /, '') } }
    return this.mutate(() => {
      const parsed = this.validate(input)
      const archived = this.db.raw().prepare('SELECT id FROM courses WHERE identity=?').get(parsed.identity) as {id:string} | undefined
      const id = archived?.id ?? randomUUID()
      const now = new Date().toISOString()
      if (archived) this.db.raw().prepare('UPDATE courses SET name=?,url=?,kind=?,options=?,updated_at=?,deleted_at=NULL WHERE id=?')
        .run(input.name.trim(), parsed.url, parsed.kind, JSON.stringify(input.options), now, id)
      else this.db.raw().prepare('INSERT INTO courses (id,identity,name,url,kind,options,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, parsed.identity, input.name.trim(), parsed.url, parsed.kind, JSON.stringify(input.options), now, now)
      this.db.setSetting('selectedCourseId', id)
      return { courseId: id }
    })
  }
  private validate(input: CourseInput): ReturnType<typeof identifyCourse> {
    if (!input.name?.trim()) throw new Error('请输入课程名称')
    const parsed = identifyCourse(input.url)
    validateRunOptions(input.options, parsed.kind)
    return parsed
  }
  update(id: string, input: CourseInput): CourseMutationResult {
    return this.mutate(() => {
      this.assertEditable(id)
      const course = this.get(id)!
      const parsed = this.validate(input)
      if (course.kind !== 'unknown' && parsed.identity !== course.identity) throw new Error('这个地址属于另一门课程，请使用“添加课程”以保留原课程进度')
      this.db.raw().prepare('UPDATE courses SET name=?,url=?,identity=?,kind=?,options=?,updated_at=?,progress_warning=? WHERE id=?')
        .run(input.name.trim(), parsed.url, parsed.identity, parsed.kind, JSON.stringify(input.options), new Date().toISOString(),
          course.kind === 'unknown' ? null : course.progressWarning, id)
      return { courseId: id }
    })
  }
  private assertEditable(id: string): void {
    if (!this.get(id)) throw new Error('课程不存在或已移除')
    if ([this.runningCourseId()].flat().includes(id)) throw new Error('这门课程正在运行，请先停止任务')
  }
  remove(id: string): CourseMutationResult {
    return this.mutate(() => {
      this.assertEditable(id)
      if (this.db.raw().prepare('SELECT 1 FROM workflow_steps WHERE course_id=? LIMIT 1').get(id)) throw new Error('课程被工作流引用，请先移除对应步骤')
      this.db.raw().prepare('UPDATE courses SET deleted_at=? WHERE id=?').run(new Date().toISOString(), id)
      if (this.db.getSetting('selectedCourseId') === id) this.db.setSetting('selectedCourseId', '')
      if (this.db.getSetting('schedulerCourseId') === id) {
        this.settings.update({ autoMode: false })
        this.db.setSetting('schedulerCourseId', '')
        this.db.setSetting('schedulerPausedReason', '调度课程已移除，请重新选择')
      }
    })
  }
  select(id: string): CourseMutationResult {
    return this.mutate(() => { if (!this.get(id)) throw new Error('课程不存在'); this.db.setSetting('selectedCourseId', id) })
  }
  defaults(options: CourseRunOptions): CourseMutationResult {
    return this.mutate(() => { validateRunOptions(options); this.db.setSetting('courseDefaults', JSON.stringify(options)) })
  }
  markRun(id: string): void { this.db.raw().prepare('UPDATE courses SET last_run_at=? WHERE id=?').run(new Date().toISOString(), id) }

  /**
   * 转录输出目录名。默认就是课程名，保证和 v1 已有的「课程录音/<课程名>/」一致；
   * 只有同名课程才追加序号。序号按课程加入课程库的先后（rowid）分配，
   * 已移除的课程仍然占位，所以同一门课程的目录不会因为别的课程增删而改名。
   */
  transcriptFolderName(id: string): string {
    const rows = this.db.raw().prepare('SELECT id, name FROM courses ORDER BY rowid').all() as Array<{ id: string; name: string }>
    const target = rows.find(item => item.id === id)
    if (!target) return ''
    const base = sanitizeCourseNote(target.name || '')
    const index = rows.filter(item => sanitizeCourseNote(item.name || '') === base).findIndex(item => item.id === id)
    return index > 0 ? `${base} (${index + 1})` : base
  }

}
