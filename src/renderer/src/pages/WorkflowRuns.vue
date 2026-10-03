<script setup lang="ts">
import WorkspaceToolbar from '../components/WorkspaceToolbar.vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useWorkflowsStore } from '../stores/workflows'
import { ACTION_LABELS, KIND_LABELS } from '@shared/courses'
import WorkspaceSplit from '../components/WorkspaceSplit.vue'
import UiIcon from '../components/UiIcon.vue'
import ToolRow from '../components/ToolRow.vue'
import { activeRun } from '@shared/workflows'
import type { RunEvent, WorkflowState, StepState } from '@shared/workflows'
const api = window.appApi
const store = useWorkflowsStore(), route = useRoute(), selected = ref(String(route.query.id ?? '')), error = ref(''), logs = ref<RunEvent[]>([]), runFilter = ref('all'), level = ref(''), busy = ref(false)
const current = computed(() => store.runs.find(r => r.id === selected.value)), filtered = computed(() => logs.value.filter(l => !level.value || l.level === level.value))
const orderedRuns = computed(() => [...store.runs].sort((a, b) => Number(activeRun(b)) - Number(activeRun(a)) || b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)))
const visibleRuns = computed(() => orderedRuns.value.filter(r => runFilter.value==='all' || (runFilter.value==='active'?activeRun(r):runFilter.value==='finished'?!activeRun(r):['failed','partial','interrupted','rejected'].includes(r.state))))
const needsAttention = (r: typeof store.runs[number]): boolean => r.state === 'running' && r.steps.some(s => s.state === 'running' && !!s.status?.intervention)
const steps = computed(() => current.value?.snapshot.steps.map(definition => ({ definition, result: current.value!.steps.find(step => step.stepId === definition.id) })) ?? [])
const copied = ref(false)
const names: Record<WorkflowState | StepState, string> = { pending: '待执行', running: '执行中', stopping: '停止中', succeeded: '成功', partial: '部分失败', failed: '失败', cancelled: '已停止', interrupted: '已中断', rejected: '启动被拒绝' }
const metrics = computed(() => ({completed: current.value?.steps.filter(s=>s.state==='succeeded').length??0, handled: current.value?.steps.reduce((n,s)=>n+(s.status?.completedCount??0),0)??0, minutes: Math.floor((current.value?.steps.reduce((n,s)=>n+(s.status?.watchedSeconds??0),0)??0)/60)}))
const phases: Record<string, string> = { idle: '就绪', preparing: '准备', login: '登录', 'loading-course': '加载课程', executing: '执行', waiting: '等待处理', stopping: '停止中', finished: '完成' }
let timer: ReturnType<typeof setInterval> | undefined, copyTimer: ReturnType<typeof setTimeout> | undefined, logRequest = 0, disposed = false
async function refreshLogs(): Promise<void> {
  const id = selected.value, request = ++logRequest
  if (!id) return
  try {
    const result = await api.workflows.logs(id)
    if (!disposed && request === logRequest && selected.value === id) logs.value = result
  } catch (e) { if (!disposed && request === logRequest && selected.value === id) error.value = String(e) }
}
watch(() => route.query.id, id => { runFilter.value = 'all'; selected.value = typeof id === 'string' ? id : '' })
watch(runFilter, () => {
  if (!visibleRuns.value.some(run => run.id === selected.value)) selected.value = visibleRuns.value[0]?.id ?? ''
})
watch([orderedRuns, selected], () => {
  if (!store.runs.some(run => run.id === selected.value)) selected.value = visibleRuns.value[0]?.id ?? ''
}, { immediate: true })
watch(selected, () => { logs.value = []; error.value = ''; copied.value = false; clearTimeout(copyTimer); void refreshLogs() })
onMounted(async () => {
  await store.refreshRuns()
  if (disposed) return
  await refreshLogs()
  if (!disposed) timer = setInterval(() => void refreshLogs(), 2000)
})
onUnmounted(() => { disposed = true; logRequest++; clearInterval(timer); clearTimeout(copyTimer) })
async function action(fn: () => Promise<unknown>): Promise<void> { busy.value = true; error.value = ''; try { await fn(); await store.refreshRuns() } catch (e) { error.value = String(e) } finally { busy.value = false } }
async function copy(): Promise<void> {
  const id = selected.value
  try {
    await navigator.clipboard.writeText(filtered.value.map(l => `${new Date(l.time).toLocaleTimeString()} [${l.level}] ${l.message}`).join('\n'))
    if (selected.value !== id || disposed) return
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 2000)
  } catch (e) { if (selected.value === id && !disposed) error.value = String(e) }
}
</script>
<template><div class="page runs-page"><WorkspaceToolbar title="运行"><span>{{store.running.length}} 个工作流进行中</span><RouterLink to="/workflows">管理工作流</RouterLink></WorkspaceToolbar><div v-if="error||store.error" class="notice error" role="alert">{{error||store.error}}</div>
<div v-if="!store.runs.length" class="empty"><h2>还没有运行记录</h2><p>保存工作流后，选择立即运行或定时运行。</p><RouterLink to="/workflows">创建工作流</RouterLink></div>
<WorkspaceSplit v-else class="runs-layout" :detail-key="selected"><template #list><div class="run-toolbar"><div class="run-filters" role="group" aria-label="运行记录筛选"><button v-for="filter in [{id:'all',label:'全部'},{id:'active',label:'进行中'},{id:'finished',label:'已结束'},{id:'abnormal',label:'异常'}]" :key="filter.id" :aria-pressed="runFilter===filter.id" @click="runFilter=filter.id">{{filter.label}}</button></div></div><div aria-label="运行记录"><ToolRow v-for="run in visibleRuns" :key="run.id" :selected="run.id===selected" :title="run.snapshot.workflow.name" @click="selected=run.id"><span class="row-text"><strong>{{run.snapshot.workflow.name}}</strong><small>{{names[run.state]}} · {{new Date(run.startedAt).toLocaleString()}}</small></span><span v-if="needsAttention(run)" class="attention">需处理</span></ToolRow><p v-if="!visibleRuns.length" class="empty">没有匹配的记录</p></div></template>
<section v-if="current" class="stack run-detail" aria-label="运行详情"><h2>{{current.snapshot.workflow.name}}</h2><p>{{names[current.state]}} · {{current.source==='schedule'?'定时触发':'手动运行'}}</p><div v-if="current.message" class="notice" :class="{error:['failed','partial','rejected'].includes(current.state)}">{{current.message}}</div><div class="actions"><button v-if="activeRun(current)" :disabled="busy||current.state==='stopping'" @click="action(()=>api.workflows.stop(current!.id))"><UiIcon name="stop"/>停止工作流</button><button v-if="activeRun(current)" :disabled="busy" @click="action(()=>api.workflows.openWindow(current!.id))">打开课程窗口</button><button v-else :disabled="busy" @click="action(async()=>{selected=await store.start(current!.workflowId)})"><UiIcon name="play"/>重新运行</button></div>
<template v-for="step in current.steps" :key="step.stepId"><div v-if="activeRun(current) && step.state==='running' && step.status?.intervention" class="notice warning"><p>{{step.status!.intervention!.message}}</p><div class="actions"><button :disabled="busy" @click="action(()=>api.workflows.openWindow(current!.id))">打开处理窗口</button><button :disabled="busy || current.state==='stopping' || !step.status!.intervention!.id" @click="action(()=>api.workflows.confirm(current!.id,step.stepId,step.status!.intervention!.id!))">已完成，继续</button></div></div></template>
<div class="run-metrics"><div><small>已完成步骤</small><strong>{{metrics.completed}} <span>/ {{steps.length}}</span></strong></div><div><small>已处理</small><strong>{{metrics.handled}} <span>项</span></strong></div><div><small>学习时长</small><strong>{{metrics.minutes}} <span>分钟</span></strong></div></div><div class="run-steps"><article v-for="({definition,result:step},index) in steps" :key="definition.id" class="step stack">
<h3>{{index+1}}. {{definition.course.name}} <span class="badge">{{names[step?.state ?? 'pending']}}</span></h3>
<p>{{KIND_LABELS[definition.course.kind]}} · {{ACTION_LABELS[definition.options.action]}} · {{definition.options.timeLimitMinutes ? `${definition.options.timeLimitMinutes} 分钟` : '不限时长'}}</p>
<template v-if="step?.status"><p>{{phases[step.status.phase??'idle']}} · {{step.status.currentTitle || step.status.message}}</p><p>已处理 {{step.status.completedCount}} 项 · 学习 {{Math.floor(step.status.watchedSeconds/60)}} 分钟</p>
</template>
<p v-if="step?.transcription">转录：{{step.transcription.message}}</p><div v-if="step?.error" class="notice error">{{step.error}}</div></article></div>
<details open class="logs"><summary>技术日志（{{logs.length}}）</summary><div class="actions"><select v-model="level" aria-label="日志级别"><option value="">全部日志</option><option value="info">信息</option><option value="warning">警告</option><option value="error">错误</option><option value="debug">调试</option></select><button @click="copy"><UiIcon name="copy"/>复制日志</button><span v-if="copied" class="muted small" role="status">日志已复制</span></div><pre>{{filtered.map(l=>new Date(l.time).toLocaleTimeString()+' ['+l.level+'] '+l.message).join('\n')||'暂无日志'}}</pre></details>
</section><section v-else class="empty"><h2>选择运行记录</h2><p>更改筛选条件，或从列表选择记录。</p></section></WorkspaceSplit></div></template>
<style scoped>
.runs-page { display:flex;flex-direction:column;overflow:hidden; }
.run-toolbar { padding:12px;position:sticky;top:0;background:var(--list-surface);z-index:1; }
.run-filters { display:flex;gap:2px;flex-wrap:wrap; }
.run-filters button { flex:1;min-height:28px;padding:3px 6px;font-size:12px;border-color:transparent;background:transparent;color:var(--text-3);white-space:nowrap; }
.run-filters [aria-pressed=true] { color:var(--accent);background:var(--accent-soft); }
.run-detail { height:100%;min-height:0;display:flex;flex-direction:column;gap:12px; }
.run-detail>:not(.logs) { flex-shrink:0; }
.run-detail h2 { font-size:var(--fs-readout);font-weight:600;overflow-wrap:anywhere; }
.run-detail>p { color:var(--text-3);font-size:12px; }
.run-steps { max-height:240px;overflow:auto;flex-shrink:0; }
.run-metrics { display:flex;gap:32px;flex-wrap:wrap;padding:12px 0;border-block:1px solid var(--line-soft); }
.run-metrics small { display:block;color:var(--text-3);margin-bottom:4px; }
.run-metrics strong { font-size:var(--fs-readout);font-weight:550;font-variant-numeric:tabular-nums; }
.run-metrics strong span { font-size:12px;font-weight:400;color:var(--text-3); }
.step { padding:10px 0;gap:6px; }
.step+.step { border-top:1px solid var(--line-soft); }
.step h3 { font-size:13px;font-weight:550;overflow-wrap:anywhere; }
.step p { color:var(--text-2);font-size:12px; }
.attention { font-size:12px;color:var(--brass);white-space:nowrap; }
.logs { flex:1;min-height:160px;border-top:1px solid var(--line);padding-top:12px; }
.logs[open] { display:flex;flex-direction:column; }
.logs::details-content { display:flex;flex-direction:column;flex:1;min-height:0; }
.logs:not([open]) { flex:0;min-height:0; }
.logs summary { cursor:pointer;margin-bottom:10px;font-weight:550; }
.logs pre { white-space:pre-wrap;overflow-wrap:anywhere;flex:1;height:100px;min-height:100px;overflow:auto;font:12px/1.65 var(--font-num);background:var(--ground);padding:12px;border:1px solid var(--line-soft);border-radius:6px;margin:10px 0 0; }
.actions select { width:auto;max-width:100%; }
button { display:inline-flex;align-items:center;gap:6px; }
.runs-page>.notice { margin:10px 20px 0; }
@container(max-width:500px) { .run-metrics { gap:20px; } }
</style>
