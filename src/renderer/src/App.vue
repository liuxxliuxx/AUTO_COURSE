<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { needsAttention } from './lib/run-presentation'
import UiIcon from './components/UiIcon.vue'
import { accentLightness } from './lib/appearance'
import { accentHue } from '@shared/appearance'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useWorkflowsStore } from './stores/workflows'
import { useCoursesStore } from './stores/courses'
import { useAccountStore } from './stores/account'
import { useSettingsStore } from './stores/settings'
const run = useWorkflowsStore(), courses = useCoursesStore(), settings = useSettingsStore(), accounts = useAccountStore()
watch(() => settings.settings?.accentColor, value => {
  document.documentElement.style.setProperty('--accent-hue', String(accentHue(value)))
  document.documentElement.style.setProperty('--accent-lightness', `${accentLightness(value)}%`)
}, { immediate: true })
const attentionCount=computed(()=>run.runs.filter(needsAttention).length)
const router = useRouter()
const productName = ref(''), version = ref(''), platform = ref(''), error = ref('')
const ready = ref(false), welcome = ref(false)
async function dismissWelcome(): Promise<void> { await window.appApi.app.dismissWelcome(); welcome.value = false }
async function openLegacy(): Promise<void> { try { await window.appApi.app.openLegacyData() } catch(e) { window.alert(String(e).replace(/^Error: /,'')) } }
let unsubscribers: Array<() => void> = []
async function initialize(): Promise<void> {
  error.value = ''
  try {
    if (!unsubscribers.length) unsubscribers = [
      window.appApi.events.onWorkflowRun(value => run.acceptRun(value)),
      window.appApi.events.onCourseLibraryChanged(value => { courses.library = value }),
      window.appApi.events.onSettingsChanged(value => { settings.settings = value })
    ]
    await Promise.all([run.load(), courses.load(), settings.load(), accounts.load()])
    if (courses.error || settings.error) throw new Error(courses.error || settings.error)
    const info = await window.appApi.app.version(); productName.value = info.name; version.value = info.version; platform.value = info.platform
    if (run.running.length > 0 && router.currentRoute.value.path !== '/run') await router.replace('/run')
    welcome.value = await window.appApi.app.welcome()
    ready.value = true
  } catch (e) { error.value = `初始化失败：${String(e)}` }
}
let poll: ReturnType<typeof setInterval> | undefined, flowPoll: ReturnType<typeof setInterval> | undefined
onMounted(() => { void initialize(); poll=setInterval(()=>void run.refreshRuns(),1000);flowPoll=setInterval(()=>void run.refreshFlows(),5000) })
onUnmounted(() => { unsubscribers.forEach(off => off()); clearInterval(poll);clearInterval(flowPoll) })
</script>
<template>
  <div class="shell" :data-platform="platform">
    <aside class="sidebar">
      <div class="window-space"></div>
      <div class="brand">{{ productName }}</div>
      <nav aria-label="主导航">
        <RouterLink to="/accounts">账号</RouterLink>
        <RouterLink to="/courses"><UiIcon name="courses"/>课程</RouterLink>
        <RouterLink to="/workflows"><UiIcon name="workflows"/>工作流</RouterLink>
        <RouterLink to="/run" aria-label="运行" :title="attentionCount ? attentionCount+' 个任务需要登录或验证码处理' : run.running.length+' 个任务进行中'"><UiIcon name="run"/>运行<span v-if="attentionCount" class="attention-count">{{attentionCount}}</span><span v-else-if="run.running.length > 0" class="live-dot"></span></RouterLink>
        <RouterLink to="/settings"><UiIcon name="settings"/>设置</RouterLink>
        <RouterLink to="/about">关于与帮助</RouterLink>
      </nav>
      <div class="sidebar-bottom"><span class="badge" :class="run.running.length > 0 ? 'green' : ''">{{ attentionCount ? attentionCount+' 个需处理' : run.running.length > 0 ? run.running.length+' 个任务进行中' : '空闲' }}</span><p>{{ productName }} <span v-if="version">v{{ version }}</span></p></div>
    </aside>
    <main class="workspace"><div class="titlebar"></div>
      <div v-if="error" class="page"><div class="notice error" role="alert">{{ error }}</div><button @click="initialize">重新加载</button></div>
      <template v-else-if="ready">
        <div v-if="welcome" class="notice" role="status"><strong>欢迎使用多账号版</strong><p>新版从空账号、课程和工作流开始，设置恢复默认。旧数据目录和已有输出文件已保留。</p><div class="actions"><RouterLink to="/accounts">添加账号</RouterLink><button @click="openLegacy">打开旧数据目录</button><button @click="dismissWelcome">知道了</button></div></div>
        <RouterView />
      </template>
      <div v-else class="empty" role="status">正在加载课程与设置…</div>
    </main>
  </div>
</template>
<style scoped>
.shell { display: flex; height: 100%; }
.sidebar { width: 152px; flex-shrink: 0; background: var(--sidebar); border-right: 1px solid var(--line); display: flex; flex-direction: column; padding: 0 10px; }
.window-space { height: 20px; flex-shrink: 0; -webkit-app-region: drag; }
.shell[data-platform=darwin] .window-space { height: 40px; }
.brand { font-size: 14px; font-weight: 600; letter-spacing: 0; padding: 8px 10px 20px; }
nav { display: grid; gap: 6px; }
nav a { display: flex; align-items: center; gap: 10px; border-radius: var(--r-control); height: var(--rail-height); padding: 0 10px; color: var(--text-2); font-weight: 500; }
nav a:hover { background: var(--ground); }
nav a.router-link-active { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 3px #20252c08;  }
.sidebar-bottom { margin-top: auto; padding: 12px 0;  }
.sidebar-bottom p { color: var(--text-3); font-size: var(--fs-micro); margin-top: 8px; }
.attention-count { margin-left:auto;color:var(--brass);font-size:12px; }
.live-dot { width: 6px; height: 6px; background: var(--jade); border-radius: 50%; margin-left: auto; }
.workspace { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; container-type: inline-size; }
.titlebar { background: var(--ground);  height: 16px; flex-shrink: 0; -webkit-app-region: drag; }
nav a.router-link-active svg { color: var(--accent); }
@media(max-width:700px) { .sidebar { width: 132px; padding:0 8px; } }
</style>
