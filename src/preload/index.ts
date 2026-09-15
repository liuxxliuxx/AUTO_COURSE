/**
 * Preload 入口。
 *
 * 运行在 sandbox + contextIsolation 下，唯一能同时看到 ipcRenderer 和
 * Renderer 全局对象的地方。只暴露 `window.appApi`。
 */

import { contextBridge, ipcRenderer } from 'electron'
import { createApi } from './api'

const api = createApi(ipcRenderer)

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('appApi', api)
} else {
  // contextIsolation 被关闭属于配置错误，仅作兜底。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).appApi = api
}
