/**
 * AppApi 实现 —— 把 ipcRenderer 包装成白名单化的类型安全接口。
 *
 * 关键约束：ipcRenderer 本体绝不暴露给 Renderer。
 * Renderer 只能调用这里显式列出的方法，以及订阅这里显式列出的事件。
 */

import type { IpcRenderer } from 'electron'
import { IPC_EVENT, IPC_INVOKE } from '@shared/ipc'
import type { AppApi, EventName, EventPayloads, InvokeMap, InvokeName, Unsubscribe } from '@shared/ipc'

function invoke<C extends InvokeName>(
  ipcRenderer: IpcRenderer,
  channel: C,
  req?: InvokeMap[C]['req']
): Promise<InvokeMap[C]['res']> {
  return ipcRenderer.invoke(channel, req) as Promise<InvokeMap[C]['res']>
}

function subscribe<E extends EventName>(
  ipcRenderer: IpcRenderer,
  channel: E,
  cb: (payload: EventPayloads[E]) => void
): Unsubscribe {
  const listener = (_event: unknown, payload: EventPayloads[E]): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

export function createApi(ipcRenderer: IpcRenderer): AppApi {
  return {
    bot: {
      start: () => invoke(ipcRenderer, IPC_INVOKE.botStart),
      stop: () => invoke(ipcRenderer, IPC_INVOKE.botStop),
      status: () => invoke(ipcRenderer, IPC_INVOKE.botStatus)
    },

    settings: {
      getAll: () => invoke(ipcRenderer, IPC_INVOKE.settingsGetAll),
      update: (patch) => invoke(ipcRenderer, IPC_INVOKE.settingsUpdate, patch),
      validate: () => invoke(ipcRenderer, IPC_INVOKE.settingsValidate)
    },

    credentials: {
      get: () => invoke(ipcRenderer, IPC_INVOKE.credentialsGet),
      set: (creds) => invoke(ipcRenderer, IPC_INVOKE.credentialsSet, creds),
      state: () => invoke(ipcRenderer, IPC_INVOKE.credentialsState)
    },

    courses: {
      list: () => invoke(ipcRenderer, IPC_INVOKE.coursesList),
      select: (url, note) => invoke(ipcRenderer, IPC_INVOKE.coursesSelect, { url, note })
    },

    captcha: {
      confirm: () => invoke(ipcRenderer, IPC_INVOKE.captchaConfirm)
    },

    scheduler: {
      get: () => invoke(ipcRenderer, IPC_INVOKE.schedulerGet),
      update: (patch) => invoke(ipcRenderer, IPC_INVOKE.schedulerUpdate, patch)
    },

    progress: {
      get: () => invoke(ipcRenderer, IPC_INVOKE.progressGet),
      today: async () => (await invoke(ipcRenderer, IPC_INVOKE.progressGet)).today
    },

    browser: {
      openCourseWindow: () => invoke(ipcRenderer, IPC_INVOKE.browserOpenCourseWindow)
    },

    transcription: {
      get: () => invoke(ipcRenderer, IPC_INVOKE.transcriptionGet)
    },

    migration: {
      report: () => invoke(ipcRenderer, IPC_INVOKE.migrationReport)
    },

    logs: {
      recent: () => invoke(ipcRenderer, IPC_INVOKE.logsRecent)
    },

    dialog: {
      pickDirectory: () => invoke(ipcRenderer, IPC_INVOKE.dialogPickDirectory)
    },

    app: {
      version: () => invoke(ipcRenderer, IPC_INVOKE.appVersion)
    },

    events: {
      onBotStatus: (cb) => subscribe(ipcRenderer, IPC_EVENT.botStatus, cb),
      onLog: (cb) => subscribe(ipcRenderer, IPC_EVENT.log, cb),
      onProgress: (cb) => subscribe(ipcRenderer, IPC_EVENT.progress, cb),
      onCourseChanged: (cb) => subscribe(ipcRenderer, IPC_EVENT.courseChanged, cb),
      onCaptchaRequired: (cb) => subscribe(ipcRenderer, IPC_EVENT.captchaRequired, cb),
      onCaptchaCleared: (cb) => subscribe(ipcRenderer, IPC_EVENT.captchaCleared, cb),
      onTranscriptionStatus: (cb) => subscribe(ipcRenderer, IPC_EVENT.transcriptionStatus, cb),
      onSchedulerStatus: (cb) => subscribe(ipcRenderer, IPC_EVENT.schedulerStatus, cb),
      onSettingsChanged: (cb) => subscribe(ipcRenderer, IPC_EVENT.settingsChanged, cb),
      onError: (cb) => subscribe(ipcRenderer, IPC_EVENT.error, cb)
    }
  }
}
