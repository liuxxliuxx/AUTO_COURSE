<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { accentHue } from '@shared/appearance'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useWorkflowsStore } from './stores/workflows'
import { useCoursesStore } from './stores/courses'
import { useSettingsStore } from './stores/settings'
const run = useWorkflowsStore(), courses = useCoursesStore(), settings = useSettingsStore()
watch(() => settings.settings?.accentColor, value => {
  document.documentElement.style.setProperty('--accent-hue', String(accentHue(value)))
}, { immediate: true })
const router = useRouter()
const version = ref(''), platform = ref(''), error = ref('')
const ready = ref(false)
let unsubscribers: Array<() => void> = []
async function initialize(): Promise<void> {
  error.value = ''
  try {
    if (!unsubscribers.length) unsubscribers = [
      window.appApi.events.onWorkflowRun(value => { const index=run.runs.findIndex(r=>r.id===value.id); if(index<0)run.runs.unshift(value);else run.runs[index]=value }),
      window.appApi.events.onCourseLibraryChanged(value => { courses.library = value }),
      window.appApi.events.onSettingsChanged(value => { settings.settings = value })
    ]
    await Promise.all([run.load(), courses.load(), settings.load()])
    if (courses.error || settings.error) throw new Error(courses.error || settings.error)
    const info = await window.appApi.app.version(); version.value = info.version; platform.value = info.platform
    if (run.running.length > 0 && router.currentRoute.value.path !== '/run') await router.replace('/run')
    ready.value = true
  } catch (e) { error.value = `初始化失败：${String(e)}` }
}
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => { void initialize(); poll=setInterval(()=>void run.refreshRuns(),1000) })
onUnmounted(() => { unsubscribers.forEach(off => off()); clearInterval(poll) })
</script>
<template>
  <div class="shell" :data-platform="platform">
    <aside class="sidebar">
      <div class="window-space"></div>
      <div class="brand">课程助手</div>
      <nav aria-label="主导航">
        <RouterLink to="/courses">课程</RouterLink>
        <RouterLink to="/workflows">工作流</RouterLink>
        <RouterLink to="/run">运行<span v-if="run.running.length > 0" class="live-dot"></span></RouterLink>
        <RouterLink to="/settings">设置</RouterLink>
      </nav>
      <div class="sidebar-bottom"><span class="badge" :class="run.running.length > 0 ? 'green' : ''">{{ run.running.length > 0 ? '任务进行中' : '空闲' }}</span><p>课程助手 <span v-if="version">v{{ version }}</span></p></div>
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
.sidebar { width: 120px; flex-shrink: 0; background: var(--sidebar); border-right: 1px solid var(--line); display: flex; flex-direction: column; padding: 0 8px; }
.window-space { height: 20px; flex-shrink: 0; -webkit-app-region: drag; }
.shell[data-platform=darwin] .window-space { height: 40px; }
.brand { font-size: var(--fs-section); font-weight: 750; letter-spacing: -.3px; padding: 4px 8px 16px; }
nav { display: grid; gap: 4px; }
nav a { display: flex; align-items: center; gap: 8px; border-radius: var(--r-control); height: var(--rail-height); padding: 0 8px; color: var(--text-2); font-weight: 550; }
nav a:hover { background: var(--ground); }
nav a.router-link-active { background: var(--accent-fill); color: var(--accent); font-weight: 700; box-shadow: inset 3px 0 var(--accent); }
.sidebar-bottom { margin-top: auto; padding: 12px 0; border-top: 1px solid var(--line); }
.sidebar-bottom p { color: var(--text-3); font-size: var(--fs-micro); margin-top: 8px; }
.live-dot { width: 6px; height: 6px; background: var(--jade); border-radius: 50%; margin-left: auto; }
.workspace { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; container-type: inline-size; }
.titlebar { background: var(--ground); border-top: 3px solid var(--accent-fill); height: 20px; flex-shrink: 0; -webkit-app-region: drag; }
</style>
