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
      <div class="brand"><span class="brand-icon">学</span><div>课程助手<small>专注学习，有序进行</small></div></div>
      <nav aria-label="主导航">
        <RouterLink to="/courses"><span aria-hidden="true">▦</span>课程</RouterLink>
        <RouterLink to="/run"><span aria-hidden="true">▷</span>运行<span v-if="run.isRunning" class="live-dot"></span></RouterLink>
        <RouterLink to="/settings"><span aria-hidden="true">⚙</span>设置</RouterLink>
      </nav>
      <div class="sidebar-bottom"><span class="badge" :class="run.isRunning ? 'green' : ''">{{ run.isRunning ? '任务进行中' : '当前无运行任务' }}</span><p>课程助手 <span v-if="version">v{{ version }}</span></p></div>
    </aside>
    <main class="workspace"><div class="titlebar"></div>
      <div v-if="error" class="page"><div class="notice error" role="alert">{{ error }}</div><button @click="initialize">重新加载</button></div>
      <RouterView v-else-if="ready" />
      <div v-else class="empty" role="status">正在加载课程与设置…</div>
    </main>
  </div>
</template>
<style scoped>
.shell{display:flex;height:100%;min-width:640px}.sidebar{width:194px;flex-shrink:0;background:#fff;border-right:1px solid var(--line-soft);display:flex;flex-direction:column;padding:0 16px}.window-space{height:48px;-webkit-app-region:drag}.brand{display:flex;gap:11px;align-items:center;font-size:18px;font-weight:650;padding:10px 7px 34px}.brand-icon{display:grid;place-items:center;width:36px;height:38px;background:var(--sky);color:white;border-radius:10px;font-size:19px}.brand small{display:block;font-size:10px;color:var(--text-3);font-weight:400;margin-top:2px}nav{display:grid;gap:7px}nav a{display:flex;align-items:center;gap:12px;border-radius:8px;padding:11px 14px;color:var(--text-2);font-weight:550}nav a>span:first-child{font-size:21px;line-height:1}nav a:hover{background:var(--ground)}nav a.router-link-active{background:var(--sky-dim);color:var(--sky)}.sidebar-bottom{margin-top:auto;padding:24px 8px}.sidebar-bottom p{color:var(--text-3);font-size:11px;margin-top:14px}.live-dot{width:6px;height:6px;background:var(--jade);border-radius:50%;margin-left:auto}.workspace{flex:1;min-width:0;height:100%;display:flex;flex-direction:column}.titlebar{height:20px;flex-shrink:0;-webkit-app-region:drag}.workspace>.page{height:calc(100% - 20px)}
@media(max-width:850px){.sidebar{width:150px;padding:0 10px}.brand{font-size:16px}.brand small{display:none}}
</style>
