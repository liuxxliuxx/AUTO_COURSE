/** Read-only compatibility responses for old renderer builds. Execution requires a workflow ID. */
import { IPC_INVOKE } from '@shared/ipc'
import { handle } from './handle'
import type { ServiceContainer } from '../services/container'
export function registerBotIpc(container:ServiceContainer):void {
  const retired=():never=>{throw new Error('此入口已停用，请在任务中操作具体运行实例')}
  handle(IPC_INVOKE.botStart,()=>({ok:false as const,errors:[{field:'courseId' as const,message:'请通过任务启动课程'}]}))
  handle(IPC_INVOKE.botStop,retired)
  handle(IPC_INVOKE.botStatus,()=>({state:'idle',mode:null,currentTitle:null,completedCount:0,watchedSeconds:0,stoppedReason:null,message:'请使用任务',tone:'neutral'}))
  handle(IPC_INVOKE.interventionConfirm,retired)
  handle(IPC_INVOKE.schedulerGet,()=>({config:{enabled:false,courseId:null,startTime:'00:00',endTime:'23:59',allDay:false,dailyLimitMinutes:0},inRange:false,targetReached:false,nextTickAt:0}))
  handle(IPC_INVOKE.schedulerUpdate,retired)
  handle(IPC_INVOKE.progressGet,()=>container.progressSnapshot())
  handle(IPC_INVOKE.browserOpenCourseWindow,retired)
  handle(IPC_INVOKE.transcriptionGet,()=>({phase:'idle',title:null,completed:0,failed:0,message:'请在运行实例中查看转录状态',tone:'neutral',percent:null}))
}
