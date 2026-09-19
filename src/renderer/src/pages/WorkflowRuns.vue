<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useWorkflowsStore } from '../stores/workflows'
import { ACTION_LABELS, KIND_LABELS } from '@shared/courses'
import { activeRun } from '@shared/workflows'
import type { RunEvent, WorkflowState, StepState } from '@shared/workflows'
const api = window.appApi
const store = useWorkflowsStore(), route = useRoute(), selected = ref(String(route.query.id ?? '')), error = ref(''), logs = ref<RunEvent[]>([]), level = ref(''), busy = ref(false)
const current = computed(() => store.runs.find(r => r.id === selected.value)), filtered = computed(() => logs.value.filter(l => !level.value || l.level === level.value))
const orderedRuns = computed(() => [...store.runs].sort((a, b) => Number(activeRun(b)) - Number(activeRun(a)) || b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)))
const steps = computed(() => current.value?.snapshot.steps.map(definition => ({ definition, result: current.value!.steps.find(step => step.stepId === definition.id) })) ?? [])
const names: Record<WorkflowState | StepState, string> = { pending: '待执行', running: '执行中', stopping: '停止中', succeeded: '成功', partial: '部分失败', failed: '失败', cancelled: '已停止', interrupted: '已中断', rejected: '启动被拒绝' }
const phases: Record<string, string> = { idle: '就绪', preparing: '准备', login: '登录', 'loading-course': '加载课程', executing: '执行', waiting: '等待处理', stopping: '停止中', finished: '完成' }
let timer: ReturnType<typeof setInterval> | undefined, logRequest = 0, disposed = false
async function refreshLogs(): Promise<void> {
  const id = selected.value, request = ++logRequest
  if (!id) return
  try {
    const result = await api.workflows.logs(id)
    if (!disposed && request === logRequest && selected.value === id) logs.value = result
  } catch (e) { if (!disposed && request === logRequest && selected.value === id) error.value = String(e) }
}
watch(() => route.query.id, id => { selected.value = typeof id === 'string' ? id : '' })
watch([orderedRuns, selected], () => {
  if (!store.runs.some(run => run.id === selected.value)) selected.value = orderedRuns.value[0]?.id ?? ''
}, { immediate: true })
watch(selected, () => { logs.value = []; error.value = ''; void refreshLogs() })
onMounted(async () => {
  await store.refreshRuns()
  if (disposed) return
  await refreshLogs()
  if (!disposed) timer = setInterval(() => void refreshLogs(), 2000)
})
onUnmounted(() => { disposed = true; logRequest++; clearInterval(timer) })
async function action(fn: () => Promise<unknown>): Promise<void> { busy.value = true; error.value = ''; try { await fn(); await store.refreshRuns() } catch (e) { error.value = String(e) } finally { busy.value = false } }
async function copy(): Promise<void> { try { await navigator.clipboard.writeText(filtered.value.map(l => `${new Date(l.time).toLocaleTimeString()} [${l.level}] ${l.message}`).join('\n')) } catch (e) { error.value = String(e) } }
</script>
<template><div class="page runs-page"><header class="page-header"><h1>运行</h1><span>{{store.running.length}} 个工作流进行中</span><RouterLink to="/workflows">管理工作流</RouterLink></header><div v-if="error||store.error" class="notice error" role="alert">{{error||store.error}}</div>
<div v-if="!store.runs.length" class="empty"><h2>还没有运行记录</h2><p>保存工作流后，选择立即运行或定时运行。</p><RouterLink to="/workflows">创建工作流</RouterLink></div>
<div v-else class="runs-layout"><aside class="panel stack run-list" aria-label="运行记录"><button v-for="run in orderedRuns" :key="run.id" :class="{primary:run.id===selected}" :aria-pressed="run.id===selected" @click="selected=run.id">{{run.snapshot.workflow.name}}<br/><small>{{names[run.state]}} · {{new Date(run.startedAt).toLocaleString()}}</small></button></aside>
<section v-if="current" class="panel stack run-detail" aria-label="运行详情"><h2>{{current.snapshot.workflow.name}}</h2><p>{{names[current.state]}} · {{current.source==='schedule'?'定时触发':'手动运行'}}</p><div v-if="current.message" class="notice" :class="{error:['failed','partial','rejected'].includes(current.state)}">{{current.message}}</div><div class="actions"><button v-if="activeRun(current)" :disabled="busy||current.state==='stopping'" @click="action(()=>api.workflows.stop(current!.id))">停止工作流</button><button v-if="activeRun(current)" :disabled="busy" @click="action(()=>api.workflows.openWindow(current!.id))">打开课程窗口</button><button v-else :disabled="busy" @click="action(async()=>{selected=await store.start(current!.workflowId)})">重新运行</button></div>
<article v-for="({definition,result:step},index) in steps" :key="definition.id" class="step stack">
<h3>{{index+1}}. {{definition.course.name}} <span class="badge">{{names[step?.state ?? 'pending']}}</span></h3>
<p>{{KIND_LABELS[definition.course.kind]}} · {{ACTION_LABELS[definition.options.action]}} · {{definition.options.timeLimitMinutes ? `${definition.options.timeLimitMinutes} 分钟` : '不限时长'}}</p>
<template v-if="step?.status"><p>{{phases[step.status.phase??'idle']}} · {{step.status.currentTitle || step.status.message}}</p><p>已处理 {{step.status.completedCount}} 项 · 学习 {{Math.floor(step.status.watchedSeconds/60)}} 分钟</p>
<div v-if="activeRun(current) && step.state==='running' && step.status.intervention" class="notice warning"><p>{{step.status.intervention.message}}</p><div class="actions"><button :disabled="busy" @click="action(()=>api.workflows.openWindow(current!.id))">打开处理窗口</button><button :disabled="busy || !step.status.intervention.id" @click="action(()=>api.workflows.confirm(current!.id,step.stepId,step.status!.intervention!.id!))">已完成，继续</button></div></div></template>
<p v-if="step?.transcription">转录：{{step.transcription.message}}</p><div v-if="step?.error" class="notice error">{{step.error}}</div></article>
<details><summary>技术日志（{{logs.length}}）</summary><div class="actions"><select v-model="level" aria-label="日志级别"><option value="">关键事件</option><option value="info">信息</option><option value="warning">警告</option><option value="error">错误</option><option value="debug">调试</option></select><button @click="copy">复制日志</button></div><pre>{{filtered.map(l=>new Date(l.time).toLocaleTimeString()+' ['+l.level+'] '+l.message).join('\n')||'暂无日志'}}</pre></details>
</section></div></div></template>
<style scoped>
.runs-page{display:flex;flex-direction:column;overflow:hidden}
.runs-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:12px;padding:12px;flex:1;min-height:0;overflow:hidden}
.panel{padding:12px;min-width:0;min-height:0}
.run-list,.run-detail{overflow:auto}
.run-list button{flex-shrink:0;text-align:left;white-space:normal;height:auto;min-height:48px;overflow-wrap:anywhere}
.run-detail h2,.step h3{overflow-wrap:anywhere}
.step{border-top:1px solid var(--line);padding-top:12px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:350px;overflow:auto;font-size:12px}
.actions{flex-wrap:wrap}.actions select{width:auto;max-width:100%}
@container(max-width:650px){.runs-layout{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(100px,28%) minmax(0,1fr)}}
</style>
