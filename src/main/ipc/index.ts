/**
 * typed IPC 注册入口。
 *
 * 约定：
 *  - Renderer → Main 只通过 ipcMain.handle（请求-响应）
 *  - Main → Renderer 只通过 webContents.send（事件推送）
 *  - 每个 handler 的签名由 @shared/ipc 的 InvokeMap 约束
 */

import { app, ipcMain } from 'electron'
import { IPC_INVOKE } from '@shared/ipc'
import type { InvokeMap, InvokeName } from '@shared/ipc'
import type { ServiceContainer } from '../services/container'
import { createLogger } from '../services/logger'

const logger = createLogger('ipc')

/**
 * 注册一个类型安全的 handler。
 * 抛出的异常会被转成结构化错误回传，避免 Renderer 侧拿到 "Error invoking remote method" 噪音。
 */
export function handle<C extends InvokeName>(
  channel: C,
  handler: (req: InvokeMap[C]['req']) => InvokeMap[C]['res'] | Promise<InvokeMap[C]['res']>
): void {
  ipcMain.handle(channel, async (_event, req: InvokeMap[C]['req']) => {
    try {
      return await handler(req)
    } catch (error) {
      logger.exception(`${channel} 处理失败`, error)
      throw new Error(error instanceof Error ? error.message : String(error))
    }
  })
}

export function registerIpcHandlers(container: ServiceContainer): void {
  // ---- 应用信息 ----
  handle(IPC_INVOKE.appVersion, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform
  }))

  // ---- 日志 ----
  handle(IPC_INVOKE.logsRecent, () => container.getRecentLogs())

  logger.info('IPC handlers 已注册')
}
