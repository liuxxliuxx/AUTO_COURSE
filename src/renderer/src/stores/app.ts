/**
 * 应用状态 store。
 *
 * 只镜像 Main 进程推来的事件，不自己推导业务状态 ——
 * Bot 的真实生命周期由 BotService 持有，UI 不得自行维护。
 */

import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type {
  BotStatus,
  CaptchaRequiredEvent,
  CourseItem,
  LogEntry,
  MigrationReport,
  ProgressSnapshot,
  SchedulerStatus,
  StatusTone,
  TranscriptionStatus
} from '@shared/types'

const IDLE_STATUS: BotStatus = {
  state: 'idle',
  mode: null,
  currentTitle: null,
  completedCount: 0,
  watchedSeconds: 0,
  stoppedReason: null,
  message: '就绪',
  tone: 'neutral'
}

const IDLE_TRANSCRIPTION: TranscriptionStatus = {
  phase: 'idle',
  title: null,
  completed: 0,
  failed: 0,
  message: '转录未启用',
  tone: 'neutral',
  percent: null
}

export const useAppStore = defineStore('app', () => {
  const status = shallowRef<BotStatus>({ ...IDLE_STATUS })
  const progress = ref<ProgressSnapshot>({
    today: { date: '', watchedSeconds: 0 },
    sessionSeconds: 0,
    targetMinutes: 0
  })
  const captcha = shallowRef<CaptchaRequiredEvent | null>(null)
  const transcription = shallowRef<TranscriptionStatus>({ ...IDLE_TRANSCRIPTION })
  const scheduler = shallowRef<SchedulerStatus | null>(null)
  const currentCourse = shallowRef<CourseItem | null>(null)
  const logs = ref<LogEntry[]>([])
  const migration = shallowRef<MigrationReport | null>(null)
  const loading = ref(true)

  const isRunning = computed(() => status.value.state !== 'idle')
  const canStart = computed(() => status.value.state === 'idle')
  const canStop = computed(
    () => status.value.state === 'running' || status.value.state === 'starting'
  )
  const hasCaptcha = computed(() => captcha.value !== null)

  /** 今日进度百分比；无目标时返回 null（界面据此隐藏进度条） */
  const todayPercent = computed<number | null>(() => {
    const target = progress.value.targetMinutes
    if (!target || target <= 0) return null
    return (progress.value.today.watchedSeconds / (target * 60)) * 100
  })

  let subscriptions: Array<() => void> = []

  function subscribe(): void {
    const api = window.appApi

    subscriptions = [
      api.events.onBotStatus((payload) => {
        status.value = payload
      }),
      api.events.onLog((entry) => {
        logs.value.push(entry)
        if (logs.value.length > 800) logs.value = logs.value.slice(-800)
      }),
      api.events.onProgress((payload) => {
        progress.value = payload
      }),
      api.events.onCaptchaRequired((payload) => {
        captcha.value = payload
      }),
      api.events.onCaptchaCleared(() => {
        captcha.value = null
      }),
      api.events.onTranscriptionStatus((payload) => {
        transcription.value = payload
      }),
      api.events.onSchedulerStatus((payload) => {
        scheduler.value = payload
      }),
      api.events.onCourseChanged((payload) => {
        currentCourse.value = payload
      }),
      api.events.onError((payload) => {
        logs.value.push({ time: Date.now(), level: 'error', message: payload.message })
      })
    ]
  }

  /** 首次挂载时拉取一次快照；IPC 尚未就绪时保持默认值，不阻塞界面渲染。 */
  async function hydrate(): Promise<void> {
    subscribe()
    const api = window.appApi
    const settled = await Promise.allSettled([
      api.bot.status(),
      api.progress.get(),
      api.transcription.get(),
      api.scheduler.get(),
      api.courses.list(),
      api.logs.recent(),
      api.migration.report()
    ])

    const [botStatus, prog, trans, sched, courses, recentLogs, mig] = settled
    if (botStatus?.status === 'fulfilled') status.value = botStatus.value
    if (prog?.status === 'fulfilled') progress.value = prog.value
    if (trans?.status === 'fulfilled') transcription.value = trans.value
    if (sched?.status === 'fulfilled') scheduler.value = sched.value
    if (courses?.status === 'fulfilled') currentCourse.value = courses.value[0] ?? null
    if (recentLogs?.status === 'fulfilled') logs.value = recentLogs.value
    if (mig?.status === 'fulfilled') migration.value = mig.value

    loading.value = false
  }

  function dispose(): void {
    for (const off of subscriptions) off()
    subscriptions = []
  }

  async function start(): Promise<void> {
    await window.appApi.bot.start()
  }

  async function stop(): Promise<void> {
    await window.appApi.bot.stop()
  }

  async function confirmCaptcha(): Promise<void> {
    await window.appApi.captcha.confirm()
    captcha.value = null
  }

  function toneColor(tone: StatusTone): string {
    switch (tone) {
      case 'success':
        return 'var(--jade)'
      case 'warning':
        return 'var(--brass)'
      case 'danger':
        return 'var(--clay)'
      default:
        return 'var(--text-3)'
    }
  }

  return {
    status,
    progress,
    captcha,
    transcription,
    scheduler,
    currentCourse,
    logs,
    migration,
    loading,
    isRunning,
    canStart,
    canStop,
    hasCaptcha,
    todayPercent,
    hydrate,
    dispose,
    start,
    stop,
    confirmCaptcha,
    toneColor
  }
})
