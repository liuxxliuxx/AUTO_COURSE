import { randomUUID } from 'node:crypto'
import type { Course, CourseInput, CourseLibrary, CourseMutationResult, CourseRunOptions } from '@shared/types'
import { identifyCourse, optionsFromLegacy, validateRunOptions } from '@shared/courses'
import type { Database } from '../storage/database'
import type { SettingsService } from './settings-service'
import { sanitizeCourseNote } from '../util/filename'

type Row = { id: string; identity: string; name: string; url: string; kind: Course['kind']; options: string;
  created_at: string; updated_at: string; last_run_at: string | null; progress_warning: string | null; last_video_title?: string }

export class CourseService {
  constructor(private readonly db: Database, private readonly settings: SettingsService,
    private readonly runningCourseId: () => string | string[] | null = () => null) { this.migrate() }

  private migrate(): void {
    if (this.db.getSetting('courseLibraryMigrated') === '1') return
    this.db.transaction(() => {
      const settings = this.settings.getAll()
      const defaults = optionsFromLegacy(settings)
      const history = this.db.getUrlHistory('video', 100000)
      const source = [...(settings.videoUrl ? [{ url: settings.videoUrl, note: settings.courseNote || this.db.getNoteForUrl(settings.videoUrl) }] : []), ...history]
      const identities = new Set<string>()
      const imported: Array<{ id: string; note: string }> = []
      let selected: string | null = null
      for (const item of source) {
        let kind: Course['kind'] = 'unknown'
        let identity = `legacy:${item.url.trim()}`
        try { const parsed = identifyCourse(item.url); kind = parsed.kind; identity = parsed.identity } catch { /* Preserve unsupported history for repair. */ }
        if (identities.has(identity)) continue
        identities.add(identity)
        const id = randomUUID()
        const now = new Date().toISOString()
        const options = { ...defaults }
        if ((kind === 'map' || kind === 'mastery') && options.action === 'transcribe') options.action = 'learn'
        if (kind === 'mastery' && options.action === 'learn-transcribe') options.action = 'learn'
        this.db.raw().prepare('INSERT INTO courses (id, identity, name, url, kind, options, created_at, updated_at, progress_warning) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, identity, item.note.trim() || '未命名课程', item.url.trim(), kind, JSON.stringify(options), now, now,
            kind === 'unknown' ? '旧地址无法识别，请编辑为有效的课程学习页链接' : null)
        imported.push({ id, note: item.note.trim() })
        if (item.url === settings.videoUrl) selected = id
      }
      // Both original and sanitized names must be unambiguous before associating legacy progress.
      for (const item of imported) {
        if (!item.note) continue
        const keys = new Set([item.note, sanitizeCourseNote(item.note)])
        const ambiguous = imported.filter(other => keys.has(other.note) || keys.has(sanitizeCourseNote(other.note))).length > 1
        const progress = this.db.getCourseProgress(item.note, sanitizeCourseNote(item.note))
        if (progress && !ambiguous) this.saveProgress(item.id, progress.lastVideoTitle)
        else if (progress) this.db.raw().prepare('UPDATE courses SET progress_warning=? WHERE id=?')
          .run('旧进度对应多个同名课程，请从头开始或重新确认续学位置', item.id)
      }
      this.db.setSetting('selectedCourseId', selected ?? imported[0]?.id ?? '')
      this.db.setSetting('courseDefaults', JSON.stringify(defaults))
      this.db.setSetting('schedulerCourseId', selected ?? '')
      if (settings.autoMode && !selected) {
        this.settings.update({ autoMode: false })
        this.db.setSetting('schedulerPausedReason', '迁移后无法确定调度课程，请重新选择')
      }
      this.db.setSetting('courseLibraryMigrated', '1')
    })
  }

  private decode(row: Row): Course {
    return { id: row.id, identity: row.identity, name: row.name, url: row.url, kind: row.kind,
      options: JSON.parse(row.options), createdAt: row.created_at, updatedAt: row.updated_at,
      lastRunAt: row.last_run_at, progressWarning: row.progress_warning, lastVideoTitle: row.last_video_title ?? null }
  }
  list(): CourseLibrary {
    const rows = this.db.raw().prepare(`SELECT c.*, p.last_video_title FROM courses c LEFT JOIN course_progress_v2 p ON p.course_id=c.id
      WHERE c.deleted_at IS NULL ORDER BY COALESCE(c.last_run_at,c.created_at) DESC, c.id`).all() as Row[]
    return { courses: rows.map(row => this.decode(row)), selectedCourseId: this.db.getSetting('selectedCourseId') || null,
      defaults: JSON.parse(this.db.getSetting('courseDefaults')) }
  }
  get(id: string): Course | null {
    const row = this.db.raw().prepare(`SELECT c.*, p.last_video_title FROM courses c LEFT JOIN course_progress_v2 p ON p.course_id=c.id
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

  saveProgress(id: string, title: string): void {
    this.db.raw().prepare('INSERT INTO course_progress_v2 (course_id,last_video_title,updated_at) VALUES (?,?,?) ON CONFLICT(course_id) DO UPDATE SET last_video_title=excluded.last_video_title,updated_at=excluded.updated_at')
      .run(id, title, new Date().toISOString())
  }
}
