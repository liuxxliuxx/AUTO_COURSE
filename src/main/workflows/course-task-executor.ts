import { randomUUID } from 'node:crypto'
import type { BotStatus, Credentials, RunSnapshot } from '@shared/types'
import type { WorkflowRun, WorkflowStepSnapshot } from '@shared/workflows'
import { settingsForCourse } from '@shared/courses'
import type { BotService } from '../services/bot-service'
import type { CourseService } from '../services/course-service'

/** Compatibility boundary: legacy runners receive a fixed step configuration. */
export class CourseTaskExecutor {
  constructor(readonly bot: BotService, private courses: CourseService) { }
  async execute(run: WorkflowRun, step: WorkflowStepSnapshot, credentials: Credentials): Promise<BotStatus> {
    const course = { ...step.course, options: { ...step.options }, lastVideoTitle: this.courses.get(step.courseId)?.lastVideoTitle ?? null }
    const settings = settingsForCourse({ ...run.snapshot.settings, autoMode: false }, course)
    const snapshot: RunSnapshot = { id: randomUUID(), course, settings, startedAt: new Date().toISOString(), source: run.source }
    return this.bot.execute(snapshot, credentials)
  }
}
