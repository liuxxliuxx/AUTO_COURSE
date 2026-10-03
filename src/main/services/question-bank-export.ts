import type { CourseService } from './course-service'
import type { Database } from '../storage/database'
import { MasteryQuestionBank } from '../automation/mastery/question-bank'

export function buildCourseQuestionBankExport(db: Database, courses: CourseService, courseId: string) {
  const course = courses.get(courseId)
  if (!course) throw new Error('课程不存在或已移除')
  if (course.kind !== 'mastery') throw new Error('只有掌握度课程支持导出题库')
  const questions = new MasteryQuestionBank(db).listForCourse(course.id)
  if (!questions.length) throw new Error('这门课程暂无已关联的题目。运行掌握度练习后可导出；旧题库中的题目会在再次遇到时自动关联。')
  return {
    format: 'auto-course-question-bank', version: 1, exportedAt: new Date().toISOString(),
    course: { id: course.id, name: course.name, url: course.url, kind: course.kind },
    questions: questions.map(q => ({
      id: q.id, content: q.content, type: q.type, attemptCount: q.attemptCount,
      answerStatus: q.options.some(o => o.isCorrect) ? 'confirmed' : 'unknown',
      options: q.options.map(o => ({ content: o.content, isCorrect: o.isCorrect }))
    }))
  }
}
