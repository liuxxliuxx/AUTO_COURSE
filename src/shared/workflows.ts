import type { Account } from './accounts'
import type { AppSettings, BotStatus, Course, CourseRunOptions, LogEntry, TranscriptionStatus } from './types'

export interface WorkflowStep { id: string; accountId: string; courseId: string; options: CourseRunOptions }
export interface WorkflowSchedule {
  kind: 'once' | 'daily'; enabled: boolean; timeZone: string
  /** ISO instant for once; HH:mm in timeZone for daily. */
  time: string; nextAt: string | null
}
export interface WorkflowInput { name: string; steps: WorkflowStep[]; schedule: WorkflowSchedule | null }
export interface Workflow extends WorkflowInput { id: string; version: number; createdAt: string; updatedAt: string; notice: string | null }
export type WorkflowState = 'running' | 'stopping' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted' | 'rejected'
export type StepState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export interface WorkflowStepSnapshot extends WorkflowStep { course: Course; account: Account }
export interface WorkflowSnapshot { workflow: Workflow; steps: WorkflowStepSnapshot[]; settings: AppSettings }
export interface WorkflowStepRun { stepId: string; state: StepState; startedAt: string | null; finishedAt: string | null; status: BotStatus | null; transcription: TranscriptionStatus | null; error: string | null }
export interface WorkflowRun {
  id: string; workflowId: string; source: 'manual' | 'schedule'; state: WorkflowState
  snapshot: WorkflowSnapshot; startedAt: string; finishedAt: string | null; message: string
  steps: WorkflowStepRun[]
}
export interface RunEvent extends LogEntry { workflowId: string; runId: string; stepId: string | null }
export type WorkflowStartResult = { ok: true; runId: string } | { ok: false; message: string; runId?: string }
export interface WorkflowApi {
  list(): Promise<Workflow[]>; get(id: string): Promise<Workflow | null>
  create(input: WorkflowInput): Promise<Workflow>
  update(id: string, version: number, input: WorkflowInput): Promise<Workflow>
  remove(id: string): Promise<void>
  runs(): Promise<WorkflowRun[]>; run(id: string): Promise<WorkflowRun | null>
  start(workflowId: string): Promise<WorkflowStartResult>; stop(runId: string): Promise<void>
  openWindow(runId: string): Promise<void>
  windowVisibility(runId: string, visible?: boolean): Promise<boolean | null>
  confirm(runId: string, stepId: string, requestId: string): Promise<void>
  logs(runId: string): Promise<RunEvent[]>
}
export const activeRun = (run: WorkflowRun): boolean => run.state === 'running' || run.state === 'stopping'
