import { errorMessage } from '../lib/ui-copy'
import { defineStore } from 'pinia'
import type { Workflow, WorkflowRun } from '@shared/workflows'
import { activeRun } from '@shared/workflows'
export const useWorkflowsStore = defineStore('workflows', {
  state: () => ({ flows: [] as Workflow[], runs: [] as WorkflowRun[], error: '', flowError: '', viewedWorkflowId:'', flowRequest:0, runRequest:0 }),
  getters: { running: s => s.runs.filter(activeRun), occupied: s => s.runs.filter(activeRun).flatMap(r => r.snapshot.steps.map(step => step.courseId)) },
  actions: {
    acceptRun(run: WorkflowRun) {
      // An older polling response must not overwrite a newer IPC event.
      this.runRequest++
      const index=this.runs.findIndex(item=>item.id===run.id)
      if(index<0)this.runs.unshift(run)
      else this.runs[index]=run
    },
    async load() {
      const flowRequest=++this.flowRequest, runRequest=++this.runRequest
      try {
        const [flows,runs]=await Promise.all([window.appApi.workflows.list(),window.appApi.workflows.runs()])
        if(flowRequest===this.flowRequest){this.flows=flows;this.flowError=''}
        if(runRequest===this.runRequest){this.runs=runs;this.error=''}
      }catch(e){if(flowRequest===this.flowRequest)this.flowError=errorMessage(e);if(runRequest===this.runRequest)this.error=errorMessage(e);throw e}
    },
    async refreshFlows() {
      const request=++this.flowRequest
      try { const flows=await window.appApi.workflows.list();if(request===this.flowRequest){this.flows=flows;this.flowError=''} }
      catch(e){if(request===this.flowRequest)this.flowError=errorMessage(e)}
    },
    async refreshRuns() {
      const request=++this.runRequest
      try { const runs=await window.appApi.workflows.runs();if(request===this.runRequest){this.runs=runs;this.error=''} }
      catch(e){if(request===this.runRequest)this.error=errorMessage(e)}
    },
    async start(id: string) { const result = await window.appApi.workflows.start(id); await this.refreshRuns(); if (!result.ok) throw new Error(result.message); return result.runId }
  }
})
