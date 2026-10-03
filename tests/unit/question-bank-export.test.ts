import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Database } from '../../src/main/storage/database'
import { CourseService } from '../../src/main/services/course-service'
import { SettingsService } from '../../src/main/services/settings-service'
import { MasteryQuestionBank } from '../../src/main/automation/mastery/question-bank'
import { buildCourseQuestionBankExport } from '../../src/main/services/question-bank-export'
import { DEFAULT_COURSE_OPTIONS } from '../../src/shared/courses'

let db: Database
let dir: string
afterEach(() => { db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })
function setup() {
  dir = mkdtempSync(join(tmpdir(), 'ac-bank-export-'))
  const file = join(dir, 'test.db')
  db = new Database(file)
  const courses = new CourseService(db, new SettingsService(db))
  const add = (name: string, mastery = true) => {
    const result = courses.create({ name, url: mastery ? `https://studywisdomh5.zhihuishu.com/study/mastery?recruitAndCourseId=${name}` : `https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=${name}`, options: { ...DEFAULT_COURSE_OPTIONS } })
    if (!result.ok) throw new Error(result.message)
    return result.courseId!
  }
  return { file, courses, add }
}
describe('课程题库导出', () => {
  it('按课程过滤，区分确认与未知答案，关联在重启和改名后保留', () => {
    const { courses, add, file } = setup()
    const a = add('A'), b = add('B')
    const bank = new MasteryQuestionBank(db, a)
    bank.saveCorrect('多选题', 'multi', ['甲', '乙', '丙'], [0, 2])
    const q = bank.getOrCreate('未知题', 'judge', ['对', '错'])
    bank.markAttempt(q.id, false)
    new MasteryQuestionBank(db, b).getOrCreate('B 专属', 'single', ['一', '二'])
    new MasteryQuestionBank(db).getOrCreate('无归属旧题', 'single', ['一', '二'])
    courses.update(a, { ...courses.get(a)!, name: '新名称' })
    db.close(); db = new Database(file)
    const reloaded = new CourseService(db, new SettingsService(db))
    const data = buildCourseQuestionBankExport(db, reloaded, a)
    expect(data.course).toMatchObject({ id: a, name: '新名称' })
    expect(data.questions).toHaveLength(2)
    expect(data.questions.find(q => q.content === '多选题')).toMatchObject({ answerStatus: 'confirmed', options: [{ content: '甲', isCorrect: true }, { content: '乙', isCorrect: false }, { content: '丙', isCorrect: true }] })
    expect(data.questions.find(q => q.content === '未知题')).toMatchObject({ answerStatus: 'unknown', attemptCount: 1 })
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
    expect(new MasteryQuestionBank(db).listForCourse(b).map(q => q.content)).toEqual(['B 专属'])
  })
  it('同一题可归属多个课程，重复采集不重复导出', () => {
    const { courses, add } = setup()
    const a = add('A'), b = add('B')
    for (const id of [a, a, b]) new MasteryQuestionBank(db, id).getOrCreate('共同题', 'single', ['一', '二'])
    expect(buildCourseQuestionBankExport(db, courses, a).questions).toHaveLength(1)
    expect(buildCourseQuestionBankExport(db, courses, b).questions).toHaveLength(1)
  })
  it('拒绝错误类型、已删除课程和没有关联题目的课程', () => {
    const { courses, add } = setup()
    expect(() => buildCourseQuestionBankExport(db, courses, add('传统课', false))).toThrow('只有掌握度')
    const id = add('空课程')
    expect(() => buildCourseQuestionBankExport(db, courses, id)).toThrow('暂无已关联')
    courses.remove(id)
    expect(() => buildCourseQuestionBankExport(db, courses, id)).toThrow('不存在')
  })
})
