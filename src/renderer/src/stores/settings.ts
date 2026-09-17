import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings, SettingsPatch } from '@shared/types'
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null)
  const error = ref('')
  async function load(): Promise<void> {
    error.value = ''
    try { settings.value = await window.appApi.settings.getAll() }
    catch (e) { error.value = String(e) }
  }
  async function save(patch: SettingsPatch): Promise<void> {
    settings.value = await window.appApi.settings.update(patch)
  }
  return { settings, error, load, save }
})
