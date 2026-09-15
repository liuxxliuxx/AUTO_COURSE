/**
 * 设置 store。
 *
 * 默认值与 v1 `gui/bridge.py::_default_setting` 保持一致，
 * 保证迁移后用户看到的行为不发生变化。
 */

import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type {
  AppSettings,
  CourseItem,
  CredentialState,
  Credentials,
  SettingsPatch,
  ValidationError
} from '@shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  loginMethod: 'zhihuishu',
  videoUrl: '',
  courseNote: '',
  loggedUrl: '',
  brushEnabled: true,
  mapMode: false,
  skipCompleted: true,
  fromLastProgress: false,
  timeLimitMinutes: 0,
  transcribeEnabled: false,
  transcribeBaseDir: '',
  autoMode: false,
  autoStartTime: '06:00',
  autoEndTime: '23:00',
  autoAllDay: false,
  autoLimitMinutes: 0,
  uiScale: 1
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
  const credentials = ref<Credentials>({ username: '', password: '' })
  const credentialState = shallowRef<CredentialState>({
    hasUsername: false,
    hasPassword: false,
    encryptionAvailable: true
  })
  const courses = ref<CourseItem[]>([])
  const validationErrors = shallowRef<ValidationError[]>([])
  const loading = ref(true)
  const saving = ref(false)

  async function load(): Promise<void> {
    const api = window.appApi
    const settled = await Promise.allSettled([
      api.settings.getAll(),
      api.credentials.get(),
      api.credentials.state(),
      api.courses.list()
    ])

    const [s, c, cs, list] = settled
    if (s?.status === 'fulfilled') settings.value = s.value
    if (c?.status === 'fulfilled') credentials.value = c.value
    if (cs?.status === 'fulfilled') credentialState.value = cs.value
    if (list?.status === 'fulfilled') courses.value = list.value

    loading.value = false
  }

  /** 保存单个字段。乐观更新本地状态，失败时回滚。 */
  async function update<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): Promise<void> {
    const previous = settings.value[key]
    settings.value = { ...settings.value, [key]: value }
    saving.value = true
    try {
      const next = await window.appApi.settings.update({ [key]: value } as SettingsPatch)
      settings.value = next
    } catch {
      settings.value = { ...settings.value, [key]: previous }
    } finally {
      saving.value = false
    }
  }

  async function updateMany(patch: SettingsPatch): Promise<void> {
    saving.value = true
    try {
      settings.value = await window.appApi.settings.update(patch)
    } finally {
      saving.value = false
    }
  }

  async function saveCredentials(next: Credentials): Promise<void> {
    credentials.value = next
    credentialState.value = await window.appApi.credentials.set(next)
  }

  async function selectCourse(url: string, note: string): Promise<void> {
    courses.value = await window.appApi.courses.select(url, note)
    settings.value = { ...settings.value, videoUrl: url, courseNote: note }
  }

  async function validate(): Promise<ValidationError[]> {
    validationErrors.value = await window.appApi.settings.validate()
    return validationErrors.value
  }

  return {
    settings,
    credentials,
    credentialState,
    courses,
    validationErrors,
    loading,
    saving,
    load,
    update,
    updateMany,
    saveCredentials,
    selectCourse,
    validate
  }
})
