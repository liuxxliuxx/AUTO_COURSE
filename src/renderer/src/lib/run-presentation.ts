import { activeRun, type WorkflowRun, type WorkflowStepRun, type WorkflowState } from '@shared/workflows'
import type { BotStatus, StopReason } from '@shared/types'

export const needsAttention = (run: WorkflowRun): boolean => run.state === 'running' && run.steps.some(step=>step.state==='running' && !!step.status?.intervention)
export const runLabel = (run: WorkflowRun): string => {
  if (needsAttention(run)) return run.steps.find(step=>step.state==='running')?.status?.intervention?.kind==='manual-login' ? '等待登录处理' : '等待验证码处理'
  return { running:'执行中', stopping:'停止中', succeeded:'本次执行完成', partial:'部分失败', failed:'执行失败', cancelled:'已停止', interrupted:'异常中断', rejected:'未能启动' }[run.state]
}
export const stepLabel = (step?: WorkflowStepRun, runState?: WorkflowState): string => {
  if (!step) return '待执行'
  if (runState==='stopping' && step.state==='running')return '停止中'
  if (step.state==='cancelled' && !step.startedAt) return '未执行'
  if (step.state==='running' && step.status?.intervention) return '需处理'
  return { pending:'待执行', running:'执行中', succeeded:'执行完成', failed:'失败', cancelled:'已停止', interrupted:'已中断' }[step.state]
}
const reasons: Record<StopReason,string> = { user:'用户停止', 'time-limit':'达到单次时长限制', 'out-of-schedule':'结束允许运行时段', 'target-reached':'达到本次目标', completed:'已处理完整列表', 'pool-exhausted':'没有待处理内容', error:'执行出错' }
export const stopReason = (status?: BotStatus | null): string => status?.stoppedReason ? reasons[status.stoppedReason] : ''
export function courseOccupancy(runs: WorkflowRun[], courseId: string): { run:WorkflowRun; label:string } | undefined {
  const run = runs.find(item=>activeRun(item) && item.snapshot.steps.some(step=>step.courseId===courseId))
  if (!run) return
  const executing = run.snapshot.steps.some(step=>step.courseId===courseId && run.steps.some(result=>result.stepId===step.id && result.state==='running'))
  return { run, label:run.state==='stopping' ? '停止中' : executing ? needsAttention(run) ? '需处理' : '正在执行' : '已被占用' }
}
