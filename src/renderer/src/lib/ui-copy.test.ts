import { describe, expect, it } from 'vitest'
import { completedLabel, courseSummary, durationLabel, errorMessage, errorText } from './ui-copy'
import { courseOccupancy, runLabel, stepLabel, stopReason } from './run-presentation'
import type { WorkflowRun, WorkflowState, WorkflowStepRun } from '@shared/workflows'
import type { BotStatus } from '@shared/types'

const step = (state: WorkflowStepRun['state']): WorkflowStepRun => ({stepId:'step', state, startedAt:null, finishedAt:null, status:null, transcription:null, error:null})
const run = (state: WorkflowState, steps: WorkflowStepRun[] = []): WorkflowRun => ({id:'run', workflowId:'flow', state, source:'manual', startedAt:'2026-10-17', finishedAt:null, message:'', steps, snapshot:{workflow:{id:'flow', name:'用户工作流名称', version:1, steps:[], schedule:null, notice:null, createdAt:'', updatedAt:''}, steps:[], settings:{} as WorkflowRun['snapshot']['settings']}})

describe('统一展示文案', () => {
  it.each([
    ['running','运行中'], ['stopping','停止中'], ['succeeded','已完成'], ['partial','部分失败'],
    ['failed','运行失败'], ['cancelled','已停止'], ['interrupted','异常中断'], ['rejected','启动失败']
  ] as const)('运行状态 %s → %s', (state,label) => expect(runLabel(run(state))).toBe(label))
  it('待运行与停止后未执行的步骤含义不同，停止状态优先于人工处理', () => {
    expect(stepLabel()).toBe('待运行')
    expect(stepLabel(step('pending'))).toBe('待运行')
    expect(stepLabel(step('cancelled'))).toBe('未执行')
    const current = {...step('running'),status:{intervention:{kind:'manual-login'}} as BotStatus}
    expect(stepLabel(current)).toBe('待处理')
    expect(runLabel(run('running',[current]))).toBe('等待登录')
    expect(runLabel(run('running',[{...current,status:{intervention:{kind:'captcha'}} as BotStatus}]))).toBe('等待验证码处理')
    expect(stepLabel(current,'stopping')).toBe('停止中')
    expect(runLabel(run('stopping',[current]))).toBe('停止中')
    expect(stopReason({stoppedReason:'time-limit'} as BotStatus)).toBe('达到单次时长限制')
    expect(courseOccupancy([], 'course')).toBeUndefined()
  })
  it('配置摘要使用相同选项和单位', () => {
    expect(durationLabel(0)).toBe('不限时长')
    expect(completedLabel(false)).toBe('处理全部')
    expect(courseSummary({action:'learn',startPosition:'resume',timeLimitMinutes:20,skipCompleted:true})).toBe('上次位置 · 20 分钟 · 跳过已完成')
  })
  it('移除传输包装和重复前缀，保留原因里的用户文字', () => {
    expect(errorText('保存任务', new Error("Error invoking remote method 'workflows.update': Error: 保存任务失败：Error: 保存任务失败：版本冲突"))).toBe('保存任务失败：版本冲突')
    const reason='任务“用户的工作流”不可用：https://example.com/工作流'
    expect(errorMessage(new Error(reason))).toBe(reason)
    expect(errorMessage('')).toBe('未知错误')
  })
})
