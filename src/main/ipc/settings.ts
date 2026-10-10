/** 设置 / 凭据 / 课程 / 对话框 / 应用信息 相关 IPC。 */

import { dialog, BrowserWindow } from 'electron'
import { appInfo, openSupport, openProjectLink } from '../support'
import { writeFile } from 'node:fs/promises'
import { buildCourseQuestionBankExport } from '../services/question-bank-export'
import { IPC_INVOKE, IPC_EVENT } from '@shared/ipc'
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

  handle(IPC_INVOKE.credentialsGet, () => { const c = container.credentials.get(); return { username: c.username, hasPassword: !!c.password } })

  handle(IPC_INVOKE.credentialsSet, (creds) => {
    const saved = container.credentials.get()
    if (creds.password === undefined && creds.username !== saved.username) throw new Error('账号已变更，请重新输入密码')
    return container.credentials.set({ username: creds.username, password: creds.password ?? saved.password })
  })

  handle(IPC_INVOKE.credentialsState, (): CredentialState => container.credentials.state())

  // ------------------------------------------------------------------ 课程

  handle(IPC_INVOKE.coursesList, () => container.courses.list())
  const changed = <T extends { ok: boolean }>(result: T): T => {
    if (result.ok) {
      container.bus.emit(IPC_EVENT.courseLibraryChanged, container.courses.list())
      container.broadcastSettings()
    }
    return result
  }
  handle(IPC_INVOKE.coursesSelect, ({ id }) => changed(container.courses.select(id)))
  handle(IPC_INVOKE.coursesCreate, (input) => changed(container.courses.create(input)))
  handle(IPC_INVOKE.coursesUpdate, ({ id, input }) => changed(container.courses.update(id, input)))
  handle(IPC_INVOKE.coursesRemove, ({ id }) => changed(container.courses.remove(id)))
  handle(IPC_INVOKE.coursesDefaults, (options) => changed(container.courses.defaults(options)))
  handle(IPC_INVOKE.coursesExportQuestionBank, async ({ id }) => {
    const data = buildCourseQuestionBankExport(container.db, container.courses, id)
    const options = {
      title: '导出课程题库',
      defaultPath: `${data.course.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}_题库.json`,
      filters: [{ name: 'JSON 题库', extensions: ['json'] }]
    }
    const parent = parentWindow()
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true, path: '', count: 0 }
    await writeFile(result.filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
    return { canceled: false, path: result.filePath, count: data.questions.length }
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

  handle(IPC_INVOKE.appVersion, appInfo)
  handle(IPC_INVOKE.appSupport, openSupport)
  handle(IPC_INVOKE.appLink, openProjectLink)
  handle(IPC_INVOKE.appDiagnostics, () => JSON.stringify({ ...appInfo(), schemaVersion: container.migration.schemaVersion, encryptionAvailable: container.credentials.state().encryptionAvailable }, null, 2))

  handle(IPC_INVOKE.logsRecent, () => container.getRecentLogs())

  handle(IPC_INVOKE.migrationReport, () => container.migration)
}
