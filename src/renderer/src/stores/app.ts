import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { BotStatus, LogEntry, ProgressSnapshot, TranscriptionStatus } from '@shared/types'
export const useAppStore = defineStore('run', () => {
  const status = ref<BotStatus>({ state: 'idle', mode: null, currentTitle: null, completedCount: 0,
    watchedSeconds: 0, stoppedReason: null, message: '准备好后开始一门课程', tone: 'neutral' })
  const logs = ref<LogEntry[]>([])
  const progress = ref<ProgressSnapshot>({ today: { date: '', watchedSeconds: 0 }, sessionSeconds: 0, targetMinutes: 0 })
  const transcription = ref<TranscriptionStatus | null>(null)
  const error = ref('')
  const starting = ref(false)
  const isRunning = computed(() => status.value.state !== 'idle')
  const canStart = computed(() => !isRunning.value && !starting.value)
  let subscriptions: Array<() => void> = []
  async function hydrate(): Promise<void> {
    if (!subscriptions.length) subscriptions = [
      window.appApi.events.onBotStatus(value => { status.value = value }),
      window.appApi.events.onLog(entry => { logs.value = [...logs.value.slice(-799), entry] }),
      window.appApi.events.onProgress(value => { progress.value = value }),
      window.appApi.events.onTranscriptionStatus(value => { transcription.value = value })
    ]
    const [s, p, l, t] = await Promise.all([window.appApi.bot.status(), window.appApi.progress.get(), window.appApi.logs.recent(), window.appApi.transcription.get()])
    status.value = s; progress.value = p; logs.value = l; transcription.value = t
  }
  async function start(courseId: string): Promise<boolean> {
    if (!canStart.value) return false
    starting.value = true; error.value = ''
    try {
      const result = await window.appApi.bot.start({ courseId })
      if (!result.ok) { error.value = result.errors.map(e => e.message).join('；'); return false }
      status.value = await window.appApi.bot.status()
      return true
    } catch (e) { error.value = String(e); return false }
    finally { starting.value = false }
  }
  async function stop(): Promise<void> { try { await window.appApi.bot.stop() } catch (e) { error.value = String(e) } }
  async function openWindow(): Promise<void> { try { await window.appApi.browser.openCourseWindow() } catch (e) { error.value = String(e) } }
  async function confirm(): Promise<void> { try { await window.appApi.intervention.confirm() } catch (e) { error.value = String(e) } }
  function dispose(): void { subscriptions.forEach(off => off()); subscriptions = [] }
  return { status, logs, progress, transcription, error, starting, isRunning, canStart, hydrate, start, stop, openWindow, confirm, dispose }
})
