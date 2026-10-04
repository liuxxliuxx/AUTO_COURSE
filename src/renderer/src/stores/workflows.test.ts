import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkflowsStore } from './workflows'
import type { Workflow, WorkflowRun } from '@shared/workflows'
import type { AppSettings } from '@shared/types'

const flow:Workflow={id:'flow',name:'任务',version:1,createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',notice:null,steps:[],schedule:null}
const run:WorkflowRun={id:'run',workflowId:flow.id,source:'manual',state:'running',startedAt:flow.createdAt,finishedAt:null,message:'',snapshot:{workflow:flow,steps:[],settings:{} as AppSettings},steps:[]}
const api={list:vi.fn(),runs:vi.fn()}
beforeEach(()=>{setActivePinia(createPinia());vi.stubGlobal('window',{appApi:{workflows:api}});api.list.mockReset();api.runs.mockReset()})
afterEach(()=>vi.unstubAllGlobals())
describe('运行界面的异步状态保护',()=>{
  it('新的停止事件不会被较早发出的运行记录刷新覆盖',async()=>{
    let finish!:(runs:WorkflowRun[])=>void
    api.runs.mockImplementationOnce(()=>new Promise<WorkflowRun[]>(resolve=>finish=resolve))
    const store=useWorkflowsStore(), refreshing=store.refreshRuns()
    store.acceptRun({...run,state:'stopping'})
    finish([run]);await refreshing
    expect(store.runs[0].state).toBe('stopping')
  })
  it('保存后取得的新工作流版本不会被较慢的旧列表响应覆盖',async()=>{
    let finish!:(flows:Workflow[])=>void
    api.list.mockImplementationOnce(()=>new Promise<Workflow[]>(resolve=>finish=resolve)).mockResolvedValueOnce([{...flow,version:2,name:'已保存的新名称'}])
    api.runs.mockResolvedValue([])
    const store=useWorkflowsStore(), refreshing=store.refreshFlows()
    await store.load();finish([flow]);await refreshing
    expect(store.flows[0]).toMatchObject({version:2,name:'已保存的新名称'})
  })
  it('运行列表刷新成功不会掩盖工作流列表的读取失败',async()=>{
    api.list.mockRejectedValueOnce(Error('工作流列表读取失败'));api.runs.mockResolvedValue([run])
    const store=useWorkflowsStore()
    await store.refreshFlows();await store.refreshRuns()
    expect(store.flowError).toContain('工作流列表读取失败')
    expect(store.error).toBe('')
    expect(store.runs).toHaveLength(1)
  })
})
