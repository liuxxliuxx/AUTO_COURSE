<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useCoursesStore } from '../stores/courses'
import { useSchedulerStore } from '../stores/scheduler'
import { ACTION_LABELS, KIND_LABELS } from '@shared/courses'
import { formatDuration } from '../lib/format'
import type { RunPhase } from '@shared/types'
const run = useAppStore(), courses = useCoursesStore(), scheduler = useSchedulerStore()
const course = computed(() => run.isRunning ? run.status.snapshot?.course : courses.selected)
const phaseLabels: Record<RunPhase, string> = { idle: '准备就绪', preparing: '准备环境', login: '登录中', 'loading-course': '加载课程', executing: '执行中', waiting: '等待处理', stopping: '正在停止', finished: '任务已结束' }
const filter = ref('key'), copied = ref('')
const logs = computed(() => run.logs.filter(e => filter.value === 'all' || (filter.value === 'key' ? e.level !== 'debug' : e.level === filter.value)))
const steps = ['准备', '登录', '加载课程', '执行']
const activeStep = computed(() => ({ idle: -1, preparing: 0, login: 1, 'loading-course': 2, executing: 3, waiting: -1, stopping: -1, finished: -1 })[run.status.phase ?? 'idle'])
async function start(): Promise<void> { if (course.value) await run.start(course.value.id) }
async function retry(): Promise<void> { if (run.status.courseId) await run.start(run.status.courseId) }
async function copyLogs(): Promise<void> {
  try { await navigator.clipboard.writeText(logs.value.map(e => `${new Date(e.time).toLocaleTimeString()} [${e.level}] ${e.message}`).join('\n')); copied.value = '已复制' }
  catch { copied.value = '复制失败，请选择日志文本复制' }
}
const retryAvailable = computed(() => !run.isRunning && courses.library.courses.some(c => c.id === run.status.courseId))
</script>
<template>
  <div class="page run-page">
    <header class="page-header"><h1>运行</h1><RouterLink to="/courses">管理课程</RouterLink></header>
    <div v-if="run.error" class="notice error" role="alert">{{ run.error }} <RouterLink to="/settings">检查设置</RouterLink></div>
    <section class="panel run-summary"><div class="run-info"><div class="summary-heading"><span class="badge" :class="run.isRunning ? 'green' : 'blue'">{{ run.isRunning ? phaseLabels[run.status.phase ?? 'preparing'] : '本次课程' }}</span></div>
      <h2>{{ course?.name || '尚未选择课程' }}</h2>
      <p v-if="course" class="muted">{{ KIND_LABELS[course.kind] }} <span>·</span> {{ ACTION_LABELS[course.options.action] }} <span>·</span> {{ course.options.timeLimitMinutes ? `${course.options.timeLimitMinutes} 分钟` : '不限时长' }}</p><p v-else class="muted">在课程页添加或选择课程，再开始运行。</p>
      </div><div class="run-actions"><button class="primary" :disabled="!course || !run.canStart" @click="start">{{ run.starting ? '正在启动…' : '开始运行' }}</button><button :disabled="!run.isRunning || run.status.state === 'stopping'" @click="run.stop">{{ run.status.state === 'stopping' ? '正在停止…' : '停止任务' }}</button><button class="quiet" @click="run.openWindow">打开课程窗口</button></div>
    </section>
    <section v-if="run.status.intervention" class="notice warning intervention" role="alert"><h3>{{ run.status.intervention.kind === 'captcha' ? '请完成验证码' : '需要手动登录' }}</h3><p>{{ run.status.intervention.message }}</p><div class="actions"><button @click="run.openWindow">打开{{ run.status.intervention.kind === 'captcha' ? '验证' : '登录' }}窗口</button><button class="primary" @click="run.confirm">{{ run.status.intervention.kind === 'captcha' ? '已完成验证，继续' : '已完成登录，继续' }}</button></div></section>
    <section v-else-if="run.status.error && !run.isRunning" class="notice error" role="alert"><h3>{{ run.status.error.code === 'login' ? '登录未完成' : run.status.error.code === 'course' ? '课程加载失败' : '任务执行失败' }}</h3><p v-if="run.status.snapshot" class="small">任务课程：{{ run.status.snapshot.course.name }}</p><p>{{ run.status.error.message }}</p><div class="actions"><button @click="run.openWindow">打开{{ run.status.error.code === 'login' ? '登录' : '课程' }}窗口</button><button :disabled="!retryAvailable" @click="retry">{{ run.status.error.code === 'login' ? '重试登录' : '重试任务' }}</button><RouterLink :to="{ path: '/courses', query: { id: run.status.courseId } }">检查课程配置</RouterLink></div></section>
    <div class="stats"><section><span>本次已处理</span><strong class="num">{{ run.status.completedCount }}<small> 项</small></strong></section><section><span>本次学习时长</span><strong class="num">{{ formatDuration(run.status.watchedSeconds) }}</strong></section><section><span>今日累计</span><strong class="num">{{ formatDuration(run.progress.today.watchedSeconds) }}</strong></section></div>
    <div class="run-body"><section class="panel phase-panel"><h3>任务进展</h3><ol class="steps"><li v-for="(label, index) in steps" :key="label" :class="{ current: activeStep === index, done: activeStep > index }"><span>{{ activeStep > index ? '✓' : index + 1 }}</span>{{ label }}</li></ol><h2 class="current-title">{{ run.status.currentTitle || (run.isRunning ? phaseLabels[run.status.phase ?? 'preparing'] : run.status.message) }}</h2><p v-if="run.status.currentTitle" class="muted">{{ run.status.message }}</p></section>
      <section class="panel auxiliary"><h3>自动调度</h3><p>{{ scheduler.status?.pausedReason ? '已暂停，等待处理' : scheduler.status?.config.enabled ? '已启用' : '未启用' }}</p><p class="muted small">{{ courses.library.courses.find(c => c.id === scheduler.status?.config.courseId)?.name || '尚未设置目标课程' }}</p><RouterLink to="/settings">调整设置</RouterLink><div class="divider"></div><h3>转录状态</h3><p class="muted small">{{ run.transcription?.message || '未启用转录' }}</p></section></div>
    <details class="panel logs" open><summary>技术日志 <span class="muted small">{{ run.logs.length }} 条</span></summary><div class="log-toolbar"><label>显示 <select v-model="filter"><option value="key">关键事件</option><option value="all">全部（含调试）</option><option value="warning">警告</option><option value="error">错误</option></select></label><div class="actions"><span class="muted small" role="status">{{ copied }}</span><button @click="copyLogs">复制日志</button></div></div><div class="log-lines" aria-label="运行日志"><p v-if="!logs.length" class="muted">暂无符合条件的日志</p><div v-for="(entry,index) in logs" :key="index" class="log-line" :class="entry.level"><time>{{ new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false }) }}</time><span>{{ entry.message.replace(/\x1b\[[0-9;]*m/g, '') }}</span></div></div></details>
  </div>
</template>
<style scoped>
.run-page { display: flex; flex-direction: column; gap: 0; }
.page-header { margin-bottom: 0; }
.run-summary { border: 0; border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; }
.run-info { min-width: 0; }
.summary-heading { display: flex; align-items: center; }
.run-summary h2 { font-weight: 750; font-size: var(--fs-title); margin: 4px 0; overflow-wrap: anywhere; }
.run-summary p>span { padding: 0 4px; color: var(--text-3); }
.run-actions { display: flex; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
.stats { display: flex; flex-wrap: wrap; gap: 4px 0; background: var(--accent-soft); border-bottom: 1px solid var(--line); padding: 7px 4px; flex-shrink: 0; }
.stats section { padding: 0 12px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.stats section+section { border-left: 1px solid var(--line); }
.stats span { color: var(--text-3); }
.stats strong { font-family: var(--font-num); color: var(--accent); font-weight: 700; font-size: var(--fs-readout); }
.stats small { font-size: var(--fs-micro); font-weight: 400; color: var(--text-3); }
.run-body { display: grid; grid-template-columns: minmax(0,1fr) 220px; gap: 0; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.run-body>.panel { border: 0; padding: 12px 16px; }
.run-body>.auxiliary { border-left: 1px solid var(--line); background: var(--ground); }
.steps { display: flex; list-style: none; padding: 0; margin: 8px 0; gap: 12px; flex-wrap: wrap; }
.steps li { display: flex; align-items: center; gap: 4px; color: var(--text-3); font-size: var(--fs-micro); }
.steps li>span { width: 18px; height: 18px; border-radius: 0; display: grid; place-items: center; background: var(--ground); border: 1px solid var(--line); }
.steps li.current { color: var(--sky); font-weight: 600; }
.steps li.current>span { background: var(--accent-fill); border-color: var(--accent-line); color: var(--accent); }
.steps li.done>span { color: var(--jade); background: var(--jade-dim); border-color: transparent; }
.current-title { font-size: var(--fs-section); overflow-wrap: anywhere; }
.auxiliary p { overflow-wrap: anywhere; }
.auxiliary>a { display: inline-block; margin-top: 4px; }
.auxiliary .divider { margin: 8px 0; }
.notice { margin: 8px 12px; }
.notice .actions { margin-top: 8px; }
.notice p { margin-top: 4px; }
.logs { border: 0; padding: 12px 16px; flex: 1; min-height: 160px; position: relative; }
.logs[open] { display: flex; flex-direction: column; }
.logs::details-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.logs:not([open]) { flex: none; min-height: 0; }
.logs summary { cursor: pointer; font-weight: 700; flex-shrink: 0; }
.logs summary span { font-weight: 400; margin-left: 8px; }
.log-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0; flex-shrink: 0; flex-wrap: wrap; }
.log-toolbar label { display: flex; align-items: center; gap: 8px; }
.log-toolbar select { width: 135px; }
.log-lines { flex: 1; min-height: 48px; overflow: auto; font: 12px/1.6 var(--font-num); user-select: text; }
.log-line { display: grid; grid-template-columns: 65px minmax(0,1fr); gap: 8px; padding: 2px 0; border-bottom: 1px solid var(--line-soft); }
.log-line time { color: var(--text-3); }
.log-line span { white-space: pre-wrap; overflow-wrap: anywhere; }
.log-line.error { color: var(--clay); } .log-line.warning { color: var(--brass); }
@container(max-width:760px) { .run-summary { align-items: flex-start; flex-direction: column; } }
@container(max-width:600px) { .run-body { grid-template-columns: 1fr; } .run-body>.auxiliary { border-left: 0; border-top: 1px solid var(--line-soft); } .auxiliary { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 4px 8px; } .auxiliary .divider { grid-column: 1 / -1; margin: 4px 0; } }
</style>
