/**
 * typed IPC 注册入口。
 *
 * 约定：
 *  - Renderer → Main 只通过 ipcMain.handle（请求-响应）
 *  - Main → Renderer 只通过 webContents.send（事件推送），由 EventBus 统一转发
 *  - 每个 handler 的签名由 @shared/ipc 的 InvokeMap 约束
 */

import { registerBotIpc } from './bot'
import { registerSettingsIpc } from './settings'
import type { ServiceContainer } from '../services/container'
import { createLogger } from '../services/logger'

const logger = createLogger('ipc')

export function registerIpcHandlers(container: ServiceContainer): void {
  registerSettingsIpc(container)
  registerBotIpc(container)
  logger.info('IPC handlers 已注册')
}

export { handle } from './handle'
