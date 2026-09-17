<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useAppStore } from './stores/app'
import { useCoursesStore } from './stores/courses'
import { useSchedulerStore } from './stores/scheduler'
import { useSettingsStore } from './stores/settings'
const run = useAppStore(), courses = useCoursesStore(), scheduler = useSchedulerStore(), settings = useSettingsStore()
const router = useRouter()
const version = ref(''), platform = ref(''), error = ref('')
const ready = ref(false)
let unsubscribers: Array<() => void> = []
async function initialize(): Promise<void> {
  error.value = ''
  try {
    if (!unsubscribers.length) unsubscribers = [
      window.appApi.events.onCourseLibraryChanged(value => { courses.library = value }),
      window.appApi.events.onSchedulerStatus(value => { scheduler.status = value }),
      window.appApi.events.onSettingsChanged(value => { settings.settings = value })
    ]
    await Promise.all([run.hydrate(), courses.load(), scheduler.load(), settings.load()])
    if (courses.error || settings.error) throw new Error(courses.error || settings.error)
    const info = await window.appApi.app.version(); version.value = info.version; platform.value = info.platform
    if (run.isRunning) await router.replace('/run')
    ready.value = true
  } catch (e) { error.value = `初始化失败：${String(e)}` }
}
onMounted(initialize)
onUnmounted(() => { unsubscribers.forEach(off => off()); run.dispose() })
</script>
<template>
  <div class="shell" :data-platform="platform">
    <aside class="sidebar">
      <div class="window-space"></div>
      <div class="brand">课程助手</div>
      <nav aria-label="主导航">
        <RouterLink to="/courses">课程</RouterLink>
        <RouterLink to="/run">运行<span v-if="run.isRunning" class="live-dot"></span></RouterLink>
        <RouterLink to="/settings">设置</RouterLink>
      </nav>
      <div class="sidebar-bottom"><span class="badge" :class="run.isRunning ? 'green' : ''">{{ run.isRunning ? '任务进行中' : '空闲' }}</span><p>课程助手 <span v-if="version">v{{ version }}</span></p></div>
    </aside>
    <main class="workspace"><div class="titlebar"></div>
      <div v-if="error" class="page"><div class="notice error" role="alert">{{ error }}</div><button @click="initialize">重新加载</button></div>
      <RouterView v-else-if="ready" />
      <div v-else class="empty" role="status">正在加载课程与设置…</div>
    </main>
  </div>
</template>
<style scoped>
.shell { display: flex; height: 100%; }
.sidebar { width: 120px; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--line); display: flex; flex-direction: column; padding: 0 8px; }
.window-space { height: 20px; flex-shrink: 0; -webkit-app-region: drag; }
.shell[data-platform=darwin] .window-space { height: 40px; }
.brand { font-size: var(--fs-section); font-weight: 650; padding: 4px 8px 12px; }
nav { display: grid; gap: 4px; }
nav a { display: flex; align-items: center; gap: 8px; border-radius: var(--r-control); height: var(--rail-height); padding: 0 8px; color: var(--text-2); font-weight: 550; }
nav a:hover { background: var(--ground); }
nav a.router-link-active { background: var(--sky-dim); color: var(--sky); }
.sidebar-bottom { margin-top: auto; padding: 12px 0; }
.sidebar-bottom p { color: var(--text-3); font-size: var(--fs-micro); margin-top: 8px; }
.live-dot { width: 6px; height: 6px; background: var(--jade); border-radius: 50%; margin-left: auto; }
.workspace { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; container-type: inline-size; }
.titlebar { height: 20px; flex-shrink: 0; -webkit-app-region: drag; }
</style>
