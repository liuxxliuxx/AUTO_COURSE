/** 设置 / 凭据 / 课程 / 对话框 / 应用信息 相关 IPC。 */

import { app, dialog, BrowserWindow } from 'electron'
import { IPC_INVOKE } from '@shared/ipc'
import type { ChromeDetectionResult, CredentialState } from '@shared/types'
import { handle } from './handle'
import type { ServiceContainer } from '../services/container'
import { createLogger } from '../services/logger'

const logger = createLogger('ipc:settings')

function parentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
}

export function registerSettingsIpc(container: ServiceContainer): void {
  // ------------------------------------------------------------------ 设置

  handle(IPC_INVOKE.settingsGetAll, () => container.settings.getAll())

  handle(IPC_INVOKE.settingsUpdate, (patch) => {
    const next = container.settings.update(patch)
    container.broadcastSettings()
    return next
  })

  handle(IPC_INVOKE.settingsValidate, () => container.settings.validate())

  // ------------------------------------------------------------------ 凭据

  handle(IPC_INVOKE.credentialsGet, () => container.credentials.get())

  handle(IPC_INVOKE.credentialsSet, (creds) => container.credentials.set(creds))

  handle(IPC_INVOKE.credentialsState, (): CredentialState => container.credentials.state())

  // ------------------------------------------------------------------ 课程

  handle(IPC_INVOKE.coursesList, () => {
    const s = container.settings.getAll()
    const url = s.videoUrl || container.db.getUrlHistory('video', 1)[0]?.url || ''
    const note = s.courseNote || (url ? container.db.getNoteForUrl(url) : '')
    return container.db.listCourses(url, note)
  })

  handle(IPC_INVOKE.coursesSelect, ({ url, note }) => {
    container.settings.update({ videoUrl: url, courseNote: note })
    if (url) container.db.saveUrlHistory('video', url, note)
    container.broadcastSettings()
    return container.db.listCourses(url, note)
  })

  // ------------------------------------------------------------ 文件对话框

  handle(IPC_INVOKE.dialogPickDirectory, async () => {
    const parent = parentWindow()
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? '' : (result.filePaths[0] ?? '')
  })

  handle(IPC_INVOKE.dialogPickFile, async () => {
    const parent = parentWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'All files', extensions: ['*'] }]
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? '' : (result.filePaths[0] ?? '')
  })

  // ------------------------------------------------------------ 应用信息

  handle(IPC_INVOKE.appVersion, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform
  }))

  handle(IPC_INVOKE.logsRecent, () => container.getRecentLogs())

  handle(IPC_INVOKE.migrationReport, () => container.migration)

  // ------------------------------------------------------------ 兼容占位
  // v2 不再需要 Chrome / ChromeDriver 路径配置（Playwright 自带匹配的 Chromium，
  // Electron Host 也自带 Chromium）。保留这个入口只为让旧 UI 调用不报错。

  handle(IPC_INVOKE.browserDetectChrome, (): ChromeDetectionResult => {
    logger.info('v2 不再需要 Chrome/ChromeDriver 检测')
    return {
      chrome: '',
      driver: '',
      status: 'v2 使用 Electron 自带 Chromium，无需外部 Chrome 或 ChromeDriver'
    }
  })
}
