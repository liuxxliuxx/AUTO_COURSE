import { defineStore } from 'pinia'
import type { Workflow, WorkflowRun } from '@shared/workflows'
import { activeRun } from '@shared/workflows'
export const useWorkflowsStore = defineStore('workflows', {
  state: () => ({ flows: [] as Workflow[], runs: [] as WorkflowRun[], error: '' }),
  getters: { running: s => s.runs.filter(activeRun), occupied: s => s.runs.filter(activeRun).flatMap(r => r.snapshot.steps.map(step => step.courseId)) },
  actions: {
    async load() { try { const [flows, runs] = await Promise.all([window.appApi.workflows.list(), window.appApi.workflows.runs()]); this.flows = flows; this.runs = runs; this.error = '' } catch (e) { this.error = String(e); throw e } },
    async refreshRuns() { try { this.runs = await window.appApi.workflows.runs(); this.error = '' } catch (e) { this.error = String(e) } },
    async start(id: string) { const result = await window.appApi.workflows.start(id); await this.refreshRuns(); if (!result.ok) throw new Error(result.message); return result.runId }
  }
})
