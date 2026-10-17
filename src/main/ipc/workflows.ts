import { handle } from './handle'
import type { ServiceContainer } from '../services/container'
export function registerWorkflowIpc(c: ServiceContainer): void {
  handle('workflows:list', () => c.workflows.list())
  handle('workflows:get', r => c.workflows.get(r.id))
  handle('workflows:create', r => c.workflows.create(r))
  handle('workflows:update', r => c.workflows.update(r.id, r.version, r.input))
  handle('workflows:remove', r => c.workflows.remove(r.id))
  handle('workflows:runs', () => c.workflowRuns.repository.list())
  handle('workflows:run', r => c.workflowRuns.repository.get(r.id))
  handle('workflows:start', r => c.workflowRuns.start(r.workflowId))
  handle('workflows:stop', r => c.workflowRuns.stop(r.runId))
  handle('workflows:window', r => c.workflowRuns.openWindow(r.runId))
  handle('workflows:window-visibility', r => c.workflowRuns.windowVisibility(r.runId, r.visible))
  handle('workflows:confirm', r => c.workflowRuns.confirm(r.runId, r.stepId, r.requestId))
  handle('workflows:logs', r => c.workflowRuns.repository.logs(r.runId))
}
