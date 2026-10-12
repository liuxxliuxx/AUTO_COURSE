import { afterEach, describe, expect, it } from 'vitest'
import { Database } from '../../src/main/storage/database'
import { SettingsService } from '../../src/main/services/settings-service'
import { CourseService } from '../../src/main/services/course-service'
import { DEFAULT_COURSE_OPTIONS, identifyCourse } from '../../src/shared/courses'
import type { Course, CourseMutationResult } from '../../src/shared/types'
const dbs: Database[] = []
afterEach(() => { dbs.splice(0).forEach(db => db.close()) })
function setup(): { db: Database; settings: SettingsService } { const db = new Database(':memory:'); dbs.push(db); return { db, settings: new SettingsService(db) } }
const input = (id: string, name = id) => ({ name, url: `https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=${id}`, options: { ...DEFAULT_COURSE_OPTIONS } })
function created(result: CourseMutationResult): Course { expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.message); return result.library.courses.find(c => c.id === result.courseId)! }

describe('课程库与迁移', () => {
  it('旧课程、历史与进度不导入新版课程库', () => {
    const {db,settings}=setup()
    settings.update({videoUrl:input('a').url,courseNote:'旧课程'})
    db.saveUrlHistory('video',input('b').url,'旧历史');db.saveCourseProgress('旧课程','第一章')
    expect(new CourseService(db,settings).list().courses).toEqual([])
    expect(new CourseService(db,settings).list().courses).toEqual([])
    expect(db.getCourseProgress('旧课程')?.lastVideoTitle).toBe('第一章')
  })
  it('课程配置与默认值隔离，选择课程不覆盖全局旧字段', () => {
    const {db, settings} = setup(); const courses = new CourseService(db, settings)
    const a = created(courses.create(input('a'))), b = created(courses.create(input('b')))
    courses.update(a.id, { ...input('a'), options: { ...a.options, timeLimitMinutes: 20, action: 'transcribe' } })
    courses.defaults({ ...DEFAULT_COURSE_OPTIONS, timeLimitMinutes: 80 })
    courses.select(b.id)
    expect(courses.get(a.id)?.options.timeLimitMinutes).toBe(20)
    expect(courses.get(b.id)?.options.timeLimitMinutes).toBe(0)
    expect(settings.getAll().videoUrl).toBe('')
    expect(courses.list().defaults.timeLimitMinutes).toBe(80)
  })
  it('重命名保持进度，移除与重加同一门课程保留 ID 与进度，并停用关联调度', () => {
    const {db, settings} = setup(); const courses = new CourseService(db, settings)
    const a = created(courses.create(input('a')))
    courses.update(a.id, input('a', '新名称'))
    db.setSetting('schedulerCourseId', a.id); settings.update({ autoMode: true })
    courses.remove(a.id); expect(courses.get(a.id)).toBeNull(); expect(settings.getAll().autoMode).toBe(false)
    const restored = created(courses.create(input('a', '恢复课程')))
    expect(restored.id).toBe(a.id)
  })
  it('重复地址返回已有课程，运行课程禁止编辑删除，不能用另一门课程覆盖原课程', () => {
    const {db, settings} = setup(); let running: string | null = null
    const courses = new CourseService(db, settings, () => running)
    const a = created(courses.create(input('a')))
    expect(courses.create(input('a', '重复'))).toMatchObject({ ok: false, existingCourseId: a.id })
    running = a.id; expect(courses.update(a.id, input('a', '改变'))).toMatchObject({ ok: false }); expect(courses.remove(a.id)).toMatchObject({ ok: false })
    running = null; expect(courses.update(a.id, input('b'))).toMatchObject({ ok: false })
    expect(courses.get(a.id)?.name).toBe('a')
  })
  it('共享地址解析严格识别类型，图谱课不能保存仅转录配置', () => {
    const {db, settings} = setup(); const courses = new CourseService(db, settings)
    const url = 'https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/1/2?mapUid=u'
    expect(identifyCourse(url).kind).toBe('map'); expect(() => identifyCourse('https://example.com/course')).toThrow()
    expect(courses.create({ name: '图谱', url, options: { ...DEFAULT_COURSE_OPTIONS, action: 'transcribe' } })).toMatchObject({ ok: false })
    expect(courses.create({ ...input('x'), options: { ...DEFAULT_COURSE_OPTIONS, timeLimitMinutes: -1 } })).toMatchObject({ ok: false })
  })
  it('识别掌握度课地址并拒绝转录配置', () => {
    const { db, settings } = setup(); const courses = new CourseService(db, settings)
    const url = 'https://studywisdomh5.zhihuishu.com/study/mastery?recruitAndCourseId=abc123'
    expect(identifyCourse(url)).toMatchObject({ kind: 'mastery', identity: 'mastery:abc123' })
    expect(courses.create({ name: '掌握度', url, options: { ...DEFAULT_COURSE_OPTIONS, action: 'transcribe' } })).toMatchObject({ ok: false })
    expect(() => identifyCourse('https://studywisdomh5.zhihuishu.com/study/mastery')).toThrow('recruitAndCourseId')
  })
  it('转录目录沿用课程名，同名课程按创建顺序追加稳定序号', () => {
    const {db, settings} = setup(); const courses = new CourseService(db, settings)
    const first = created(courses.create(input('a', '高等数学')))
    const second = created(courses.create(input('b', '高等数学')))
    expect(courses.transcriptFolderName(first.id)).toBe('高等数学')
    expect(courses.transcriptFolderName(second.id)).toBe('高等数学 (2)')
    // 重启后重建服务，序号不变
    courses.update(second.id, input('b', '高等数学'))
    expect(new CourseService(db, settings).transcriptFolderName(second.id)).toBe('高等数学 (2)')
    // 移除其中一门不会让另一门的目录改名（旧文件不会被混进新课程）
    courses.remove(first.id)
    expect(courses.transcriptFolderName(second.id)).toBe('高等数学 (2)')
    // 重新添加被移除的那门课程时复用同一条记录，目录也回到原值
    const restored = created(courses.create(input('a', '高等数学')))
    expect(restored.id).toBe(first.id)
    expect(courses.transcriptFolderName(first.id)).toBe('高等数学')
  })
})
