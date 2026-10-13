import { join } from 'node:path'
import type { WorkflowRun } from '@shared/workflows'
import type { BotStatus, TranscriptionStatus } from '@shared/types'
import type { WorkflowRuntime } from './workflow-executor'
import type { Database } from '../storage/database'
import type { AccountService } from '../services/account-service'
import type { CourseService } from '../services/course-service'
import type { SettingsService } from '../services/settings-service'
import type { SttWorkerOptions } from '../services/stt-worker'
import { BotService, type RunnerFactory } from '../services/bot-service'
import { EventBus } from '../services/event-bus'
import { BrowserService } from '../automation/browser-service'
import { TranscriptionService } from '../services/transcription-service'
import { CourseTaskExecutor } from './course-task-executor'

/** Each step owns its resources; persistent login profiles belong to accounts. */
export function createWorkflowRuntime(run: WorkflowRun, report: (status?: BotStatus, transcription?: TranscriptionStatus) => void,
  deps: {db:Database;accounts:AccountService;courses:CourseService;settingsService:SettingsService;userData:string;worker:SttWorkerOptions;runnerFactory:()=>RunnerFactory|null}): WorkflowRuntime {
  const {db,accounts,courses,settingsService,userData,worker,runnerFactory}=deps
  let current: { task: CourseTaskExecutor; browser: BrowserService; media: TranscriptionService; bus: EventBus } | null = null
  const cleanup = async (): Promise<void> => {
    const runtime = current
    if (!runtime) return
    current = null
    const errors: unknown[] = []
    try { await runtime.task.bot.dispose() } catch(error) { errors.push(error) }
    try { await runtime.media.dispose() } catch(error) { errors.push(error) }
    try { await runtime.browser.close() }
    finally { runtime.browser.dispose(); runtime.bus.clear(); current = null }
    if (errors.length) throw new AggregateError(errors,'步骤资源清理失败')
  }
  return {
    get task() { if (!current) throw new Error('当前步骤尚未初始化'); return current.task },
    prepareStep: async step => {
      await cleanup()
      const bus = new EventBus()
      const browser = new BrowserService({downloadDir:join(userData,'workflow-downloads',run.id,step.id),profileDir:accounts.profileDir(step.accountId),migrateLegacyProfile:false})
      const settings = {...run.snapshot.settings, loginMethod:step.account.loginMethod, loggedUrl:step.account.loggedUrl}
      const media = new TranscriptionService({bus,tempNamespace:`${run.id}-${step.id}`,getSettings:()=>settings,worker})
      bus.on('event:bot-status', status=>report(status))
      bus.on('event:transcription-status', status=>report(undefined,status))
      const bot = new BotService(db,{get:()=>accounts.credentials(step.accountId)},settingsService,bus,browser,(mode,ctx)=>{
        if(!runnerFactory())throw new Error('执行器尚未注册')
        return runnerFactory()!(mode,ctx)
      },async(config,only)=>{
        const enabled=await media.configure(config,only,accounts.transcriptFolderName(step.account,step.course))
        if((config.transcribeEnabled||only)&&!enabled)throw new Error(media.getStatus().message)
        return enabled?media:null
      },courses,accounts,join(userData,'diagnostics'))
      bus.on('event:progress', progress=>report({...bot.getStatus(),watchedSeconds:progress.sessionSeconds}))
      current = {task:new CourseTaskExecutor(bot,accounts),browser,media,bus}
    },
    openWindow:async()=>{if(!current)throw new Error('课程窗口尚未就绪');await current.browser.ensureSession();await current.browser.focusCourseWindow()},
    stop:async()=>{await current?.task.bot.stop('user')},
    cleanupStep:cleanup,
    dispose:cleanup
  }
}
