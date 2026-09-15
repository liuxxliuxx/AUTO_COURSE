/** 设置 / 凭据 / 课程 / 对话框 / 应用信息 相关 IPC。 */

import { app, dialog, BrowserWindow } from 'electron'
import { IPC_INVOKE } from '@shared/ipc'
import type { CredentialState } from '@shared/types'
import { handle } from './handle'
import type { ServiceContainer } from '../services/container'

/** 对话框需要有父窗口才会在 macOS 上以 sheet 形式弹出 */
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

  // ------------------------------------------------------------ 应用信息

  handle(IPC_INVOKE.appVersion, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform
  }))

  handle(IPC_INVOKE.logsRecent, () => container.getRecentLogs())

  handle(IPC_INVOKE.migrationReport, () => container.migration)
}
