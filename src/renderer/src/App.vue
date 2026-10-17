<script setup lang="ts">
import { errorText } from './lib/ui-copy'
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

const attentionCount = computed(() => run.runs.filter(needsAttention).length)
const router = useRouter()
const productName = ref(''), version = ref(''), platform = ref(''), error = ref('')
const ready = ref(false), welcome = ref(false)

async function dismissWelcome(): Promise<void> { await window.appApi.app.dismissWelcome(); welcome.value = false }
async function openLegacy(): Promise<void> { try { await window.appApi.app.openLegacyData() } catch(e) { window.alert(errorText('打开旧数据目录', e)) } }

let unsubscribers: Array<() => void> = []

// 支持鼠标与触控板的前进与后退
let lastNavTime = 0
function navHistory(direction: 'back' | 'forward'): void {
  const now = Date.now()
  if (now - lastNavTime < 140) return
  lastNavTime = now
  if (direction === 'back') {
    router.back()
  } else {
    router.forward()
  }
}

function handleMouseNav(e: MouseEvent): void {
  if (e.button === 3) {
    e.preventDefault()
    navHistory('back')
  } else if (e.button === 4) {
    e.preventDefault()
    navHistory('forward')
  }
}

function handleAuxClick(e: MouseEvent): void {
  if (e.button === 3 || e.button === 4) {
    e.preventDefault()
  }
}

function handleKeyNav(e: KeyboardEvent): void {
  const isBack =
    (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.key === 'ArrowLeft') ||
    (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === '[' || e.key === 'ArrowLeft'))

  const isForward =
    (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.key === 'ArrowRight') ||
    (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === ']' || e.key === 'ArrowRight'))

  if (isBack) {
    e.preventDefault()
    navHistory('back')
  } else if (isForward) {
    e.preventDefault()
    navHistory('forward')
  }
}

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
  } catch (e) { error.value = errorText('初始化', e) }
}

let poll: ReturnType<typeof setInterval> | undefined, flowPoll: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void initialize()
  poll = setInterval(() => void run.refreshRuns(), 1000)
  flowPoll = setInterval(() => void run.refreshFlows(), 5000)
  window.addEventListener('mouseup', handleMouseNav, true)
  window.addEventListener('auxclick', handleAuxClick, true)
  window.addEventListener('keydown', handleKeyNav, true)
})

onUnmounted(() => {
  unsubscribers.forEach(off => off())
  clearInterval(poll)
  clearInterval(flowPoll)
  window.removeEventListener('mouseup', handleMouseNav, true)
  window.removeEventListener('auxclick', handleAuxClick, true)
  window.removeEventListener('keydown', handleKeyNav, true)
})
</script>

<template>
  <div class="shell" :data-platform="platform">
    <aside class="sidebar">
      <div class="window-space"></div>
      <div class="brand">{{ productName }}</div>
      <nav aria-label="主导航">
        <RouterLink to="/accounts"><UiIcon name="accounts"/>账号</RouterLink>
        <RouterLink to="/courses"><UiIcon name="courses"/>课程</RouterLink>
        <RouterLink to="/workflows"><UiIcon name="workflows"/>任务列表</RouterLink>
        <RouterLink to="/run" aria-label="运行" :title="attentionCount ? attentionCount+' 个任务需要登录或验证码处理' : run.running.length+' 个任务运行中'">
          <UiIcon name="run"/>运行
          <span v-if="attentionCount" class="attention-count">{{attentionCount}}</span>
          <span v-else-if="run.running.length > 0" class="live-dot"></span>
        </RouterLink>
        <RouterLink to="/settings"><UiIcon name="settings"/>设置</RouterLink>
        <RouterLink to="/about"><UiIcon name="about"/>关于与帮助</RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <span class="badge" :class="run.running.length > 0 ? 'green' : ''">
          {{ attentionCount ? attentionCount+' 个待处理' : run.running.length > 0 ? run.running.length+' 个任务运行中' : '空闲' }}
        </span>
        <p>{{ productName }} <span v-if="version">v{{ version }}</span></p>
      </div>
    </aside>

    <main class="workspace">
      <div class="titlebar"></div>
      <div v-if="error" class="page"><div class="notice error" role="alert">{{ error }}</div><button @click="initialize">重新加载</button></div>
      <template v-else-if="ready">
        <div v-if="welcome" class="notice" role="status"><strong>欢迎使用多账号版</strong><p>新版从空账号、课程和任务列表开始，设置恢复默认。旧数据目录和已有输出文件已保留。</p><div class="actions"><RouterLink to="/accounts">添加账号</RouterLink><button @click="openLegacy">打开旧数据目录</button><button @click="dismissWelcome">知道了</button></div></div>
        <RouterView v-slot="{ Component }">
          <Transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </template>
      <div v-else class="empty" role="status">正在加载…</div>
    </main>
  </div>
</template>

<style scoped>
.shell { display: flex; height: 100%; overflow: hidden; }
.sidebar {
  width: 156px;
  flex-shrink: 0;
  background: var(--sidebar);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  padding: 0 10px;
  user-select: none;
}
.window-space { height: 12px; flex-shrink: 0; -webkit-app-region: drag; }
.shell[data-platform=darwin] .window-space { height: 38px; }

.brand {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 8px 10px 18px;
  color: var(--text);
}

nav { display: grid; gap: 4px; }
nav a {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: var(--r-control);
  height: var(--rail-height);
  padding: 0 10px;
  color: var(--text-2);
  font-weight: 500;
  font-size: 13px;
  opacity: 1;
  transition: background 0.15s ease, color 0.15s ease;
}
nav a .ui-icon-box {
  color: var(--text-3);
}
nav a:hover {
  background: var(--ground);
  color: var(--text);
  opacity: 1;
}
nav a:hover .ui-icon-box {
  color: var(--text-2);
}
nav a.router-link-active {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 1px rgba(0, 0, 0, 0.02);
}
nav a.router-link-active .ui-icon-box {
  color: var(--accent);
}

.sidebar-bottom { margin-top: auto; padding: 12px 2px; }
.sidebar-bottom p { color: var(--text-3); font-size: var(--fs-micro); margin-top: 8px; }
.attention-count { margin-left: auto; color: var(--brass); font-size: 12px; font-weight: 600; }

.live-dot {
  width: 7px;
  height: 7px;
  background: var(--jade);
  border-radius: 50%;
  margin-left: auto;
  box-shadow: 0 0 0 0 rgba(52, 116, 91, 0.4);
  animation: pulse-dot 2.2s infinite cubic-bezier(0.4, 0, 0.6, 1);
}
@keyframes pulse-dot {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(52, 116, 91, 0.5); }
  70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(52, 116, 91, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(52, 116, 91, 0); }
}

.workspace {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  background: var(--surface);
}

/* 消除顶部 16px 细微色差横条：非 macOS 平台无需多余色条，macOS 平台保持透明拖拽条 */
.titlebar { display: none; }
.shell[data-platform=darwin] .titlebar {
  display: block;
  background: transparent;
  height: 28px;
  flex-shrink: 0;
  -webkit-app-region: drag;
}

/* 现代简约页面过渡动画 */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1), transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}
.page-fade-enter-from {
  opacity: 0;
  transform: translateY(3px);
}
.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media(max-width: 700px) {
  .sidebar { width: 136px; padding: 0 8px; }
}
</style>
