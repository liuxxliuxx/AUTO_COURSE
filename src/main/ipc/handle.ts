/**
 * 类型安全的 IPC handler 注册助手。
 *
 * 约束来自 @shared/ipc 的 InvokeMap：channel 与请求/响应类型必须一一对应，
 * 写错任何一个都会在 typecheck 阶段暴露。
 */

import { ipcMain } from 'electron'
import type { InvokeMap, InvokeName } from '@shared/ipc'
import { createLogger } from '../services/logger'

const logger = createLogger('ipc')

export function handle<C extends InvokeName>(
  channel: C,
  handler: (req: InvokeMap[C]['req']) => InvokeMap[C]['res'] | Promise<InvokeMap[C]['res']>
): void {
  ipcMain.handle(channel, async (_event, req: InvokeMap[C]['req']) => {
    try {
      return await handler(req)
    } catch (error) {
      logger.exception(`${channel} 处理失败`, error)
      // 转成干净的错误信息，避免 Renderer 侧拿到 "Error invoking remote method" 噪音
      throw new Error(error instanceof Error ? error.message : String(error))
    }
  })
}
