import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SchedulerConfig, SchedulerStatus } from '@shared/types'
export const useSchedulerStore = defineStore('scheduler', () => {
  const status = ref<SchedulerStatus | null>(null)
  async function load(): Promise<void> { status.value = await window.appApi.scheduler.get() }
  async function save(config: Partial<SchedulerConfig>): Promise<void> { status.value = await window.appApi.scheduler.update(config) }
  return { status, load, save }
})
