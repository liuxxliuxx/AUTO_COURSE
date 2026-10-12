import type { AccountService } from '../services/account-service'
import { randomUUID } from 'node:crypto'
import type { BotStatus, Credentials, RunSnapshot } from '@shared/types'
import type { WorkflowRun, WorkflowStepSnapshot } from '@shared/workflows'
import { settingsForCourse } from '@shared/courses'
import type { BotService } from '../services/bot-service'

/** Compatibility boundary: legacy runners receive a fixed step configuration. */
export class CourseTaskExecutor {
  constructor(readonly bot: BotService, private accounts: AccountService) { }
  async execute(run: WorkflowRun, step: WorkflowStepSnapshot, credentials: Credentials): Promise<BotStatus> {
    const course = { ...step.course, options: { ...step.options } }
    const settings = settingsForCourse({ ...run.snapshot.settings, autoMode: false, loginMethod: step.account.loginMethod, loggedUrl: step.account.loggedUrl }, course)
    const snapshot: RunSnapshot = { id: randomUUID(), accountId: step.accountId, lastVideoTitle: this.accounts.continuation(step.accountId, step.courseId), course, settings, startedAt: new Date().toISOString(), source: run.source }
    return this.bot.execute(snapshot, credentials)
  }
}
