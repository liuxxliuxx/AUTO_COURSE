<script setup lang="ts">
import WorkspaceToolbar from '../components/WorkspaceToolbar.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkflowsStore } from '../stores/workflows'
import { ACTION_LABELS, KIND_LABELS } from '@shared/courses'
import WorkspaceSplit from '../components/WorkspaceSplit.vue'
import UiIcon from '../components/UiIcon.vue'
import ToolRow from '../components/ToolRow.vue'
import ChoiceButtons from '../components/ChoiceButtons.vue'
import { activeRun, type RunEvent, type WorkflowRun } from '@shared/workflows'
import { needsAttention, runLabel, stepLabel, stopReason } from '../lib/run-presentation'
const api = window.appApi, store = useWorkflowsStore(), route = useRoute(), router = useRouter()
const selected = ref(String(route.query.id ?? '')), logs = ref<RunEvent[]>([]), runFilter = ref('all'), level = ref('')
const pending = ref<Record<string,string>>({}), errors = ref<Record<string,string>>({}), rejectedIds = ref<Record<string,string>>({})
const current = computed(() => store.runs.find(r => r.id === selected.value)), filtered = computed(() => logs.value.filter(l => !level.value || l.level === level.value))
const busy = computed(()=>!!pending.value[selected.value]), attentionCount = computed(()=>store.runs.filter(needsAttention).length)
const orderedRuns = computed(() => [...store.runs].sort((a, b) => Number(activeRun(b)) - Number(activeRun(a)) || b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)))
const visibleRuns = computed(() => orderedRuns.value.filter(r => runFilter.value==='all' || (runFilter.value==='active'?activeRun(r):runFilter.value==='attention'?needsAttention(r):runFilter.value==='finished'?!activeRun(r):['failed','partial','interrupted','rejected'].includes(r.state))))
const steps = computed(() => current.value?.snapshot.steps.map(definition => ({ definition, result: current.value!.steps.find(step => step.stepId === definition.id) })) ?? [])
const activeStep = computed(()=>steps.value.find(step=>step.result?.state==='running'))
const latestFlow = computed(()=>store.flows.find(flow=>flow.id===current.value?.workflowId))
const restartReason = computed(()=>!latestFlow.value ? '原工作流已删除，无法再次启动。历史记录仍可查看。' : store.running.some(run=>run.workflowId===current.value?.workflowId) ? '该工作流已有进行中的记录，请先查看或停止该记录。' : '')
const relatedRun = computed(()=>store.running.find(run=>run.workflowId===current.value?.workflowId))
const copied = ref(false), logLoading = ref(true), logError = ref(''), followLogs = ref(true), unseenLogs = ref(0), logPanel = ref<HTMLElement | null>(null)
const logText = computed(()=>filtered.value.map(l=>new Date(l.time).toLocaleTimeString()+' ['+l.level+'] '+l.message).join('\n'))
const metrics = computed(() => ({completed: current.value?.steps.filter(s=>s.state==='succeeded').length??0, handled: current.value?.steps.reduce((n,s)=>n+(s.status?.completedCount??0),0)??0, minutes: Math.floor((current.value?.steps.reduce((n,s)=>n+(s.status?.watchedSeconds??0),0)??0)/60)}))
const phases: Record<string, string> = { idle: '就绪', preparing: '准备', login: '登录', 'loading-course': '加载课程', executing: '执行', waiting: '等待处理', stopping: '停止中', finished: '完成' }
let timer: ReturnType<typeof setInterval> | undefined, copyTimer: ReturnType<typeof setTimeout> | undefined, logRequest = 0, disposed = false
const fetching = new Set<string>()
async function refreshLogs(): Promise<void> {
  const id = selected.value
  if (!id || fetching.has(id)) return
  const request = ++logRequest
  fetching.add(id)
  try {
    const result = await api.workflows.logs(id)
    if (disposed || request !== logRequest || selected.value !== id) return
    if (!followLogs.value) unseenLogs.value += Math.max(0,result.length-logs.value.length)
    logs.value = result; logError.value = ''
  } catch (e) { if (!disposed && request===logRequest && selected.value===id) logError.value=String(e).replace(/^Error: /,'') }
  finally { fetching.delete(id); if (!disposed && request===logRequest && selected.value===id) logLoading.value=false }
}
function scrollLogs(): void { if (logPanel.value) logPanel.value.scrollTop=logPanel.value.scrollHeight;unseenLogs.value=0 }
function logScroll(): void {
  const panel=logPanel.value
  if (panel && panel.scrollHeight-panel.clientHeight-panel.scrollTop>12) followLogs.value=false
}
watch(logText, async()=>{ await nextTick();if(followLogs.value)scrollLogs() })
watch(followLogs, async value=>{ if(value){await nextTick();scrollLogs()} })
watch(() => route.query.id, id => { if (typeof id==='string' && id!==selected.value) {runFilter.value='all';selected.value=id} })
watch(visibleRuns, () => {
  if (!visibleRuns.value.some(run => run.id === selected.value)) selected.value=visibleRuns.value[0]?.id??''
}, {immediate:true})
watch(selected, () => {
  logRequest++; logs.value=[];logLoading.value=!!selected.value;logError.value='';copied.value=false;followLogs.value=true;unseenLogs.value=0;clearTimeout(copyTimer)
  if (String(route.query.id??'')!==selected.value) void router.replace({query:{...route.query,id:selected.value||undefined}})
  void refreshLogs()
})
onMounted(async () => {await store.refreshRuns();if(disposed)return;await refreshLogs();if(!disposed)timer=setInterval(()=>void refreshLogs(),2000)})
onUnmounted(() => { disposed = true; logRequest++; clearInterval(timer); clearTimeout(copyTimer) })
async function action(run: WorkflowRun, label: string, fn: () => Promise<unknown>): Promise<void> {
  const id=run.id
  if(pending.value[id])return
  pending.value[id]=label;delete errors.value[id];delete rejectedIds.value[id]
  try { await fn();await store.refreshRuns() }
  catch(e){if(!disposed)errors.value[id]=String(e).replace(/^Error: /,'')}
  finally {delete pending.value[id]}
}
async function restart(run: WorkflowRun): Promise<void> {
  await action(run,'正在启动…',async()=>{
    const result=await api.workflows.start(run.workflowId)
    await store.refreshRuns()
    if(!result.ok){if(result.runId)rejectedIds.value[run.id]=result.runId;throw Error(result.message)}
    if(!disposed && selected.value===run.id){runFilter.value='all';selected.value=result.runId}
  })
}
async function copy(): Promise<void> {
  const id = selected.value
  try {
    await navigator.clipboard.writeText(filtered.value.map(l => `${new Date(l.time).toLocaleTimeString()} [${l.level}] ${l.message}`).join('\n'))
    if (selected.value !== id || disposed) return
    copied.value = true;clearTimeout(copyTimer);copyTimer = setTimeout(() => { copied.value = false }, 2000)
  } catch (e) { if (selected.value === id && !disposed) errors.value[id] = String(e) }
}
function choose(id:string):void{runFilter.value='all';selected.value=id}
</script>
<template>
<div class="page runs-page">
  <WorkspaceToolbar title="运行"><span>{{store.running.length}} 个进行中<span v-if="attentionCount" class="attention"> · {{attentionCount}} 个需处理</span></span><RouterLink :to="current && latestFlow ? {path:'/workflows',query:{id:current.workflowId}} : '/workflows'">管理工作流</RouterLink></WorkspaceToolbar>
  <div v-if="store.error" class="notice error" role="alert">运行记录更新失败，当前显示上次取得的数据。{{store.error}} <button @click="store.refreshRuns">重新加载</button></div>
  <div v-if="!store.runs.length" class="empty"><h2>还没有运行记录</h2><p>保存工作流后，选择立即运行或定时运行。</p><RouterLink to="/workflows">创建工作流</RouterLink></div>
  <WorkspaceSplit v-else class="runs-layout" :detail-key="selected">
    <template #list>
      <div class="run-toolbar"><div class="run-filters" role="group" aria-label="运行记录筛选"><button v-for="filter in [{id:'all',label:'全部'},{id:'active',label:'进行中'},{id:'attention',label:'需处理'},{id:'finished',label:'已结束'},{id:'abnormal',label:'异常'}]" :key="filter.id" :aria-pressed="runFilter===filter.id" @click="runFilter=filter.id">{{filter.label}}</button></div></div>
      <div aria-label="运行记录"><ToolRow v-for="run in visibleRuns" :key="run.id" :selected="run.id===selected" :title="run.snapshot.workflow.name+' · '+runLabel(run)" @click="selected=run.id"><span class="row-text"><strong>{{run.snapshot.workflow.name}}</strong><small>{{runLabel(run)}} · {{new Date(run.startedAt).toLocaleString()}}</small></span><span v-if="needsAttention(run)" class="attention">需处理</span></ToolRow><p v-if="!visibleRuns.length" class="empty">没有匹配的记录</p></div>
    </template>
    <section v-if="current" class="stack run-detail" aria-label="运行详情">
      <h2>{{current.snapshot.workflow.name}}</h2>
      <p><span class="run-state" :class="{attention:needsAttention(current),failure:['failed','partial','interrupted','rejected'].includes(current.state)}">{{runLabel(current)}}</span> · {{current.source==='schedule'?'定时触发':'手动运行'}} · <span title="下面的步骤和配置来自本次启动时保存的快照，编辑工作流不会改变这次运行">启动时配置</span></p>
      <div v-if="errors[current.id]" class="notice error" role="alert">{{errors[current.id]}} <button v-if="rejectedIds[current.id]" @click="choose(rejectedIds[current.id])">查看启动记录</button></div>
      <div v-if="current.message" class="notice" :class="{error:['failed','partial','rejected'].includes(current.state)}">{{current.message}}</div>
      <div class="actions">
        <button v-if="activeRun(current)" :disabled="busy||current.state==='stopping'" :title="current.state==='stopping'?'已收到停止请求，正在等待当前任务退出':'停止本次运行，尚未开始的步骤不会执行'" @click="action(current,'正在停止…',()=>api.workflows.stop(current!.id))"><UiIcon name="stop"/>{{current.state==='stopping'?'正在停止…':'停止工作流'}}</button>
        <button v-if="activeRun(current) && !needsAttention(current)" :disabled="busy" title="显示本次任务使用的课程窗口" @click="action(current,'正在打开窗口…',()=>api.workflows.openWindow(current!.id))">打开课程窗口</button>
        <button v-if="!activeRun(current)" :disabled="busy||!!restartReason" :title="restartReason || '使用工作流目前保存的配置新建一次运行，历史记录保持不变'" @click="restart(current)"><UiIcon name="play"/>运行最新配置</button>
        <span v-if="busy" class="muted small" role="status">{{pending[current.id]}}</span>
      </div>
      <p v-if="!activeRun(current) && restartReason" class="muted small">{{restartReason}} <button v-if="relatedRun" class="quiet" @click="choose(relatedRun.id)">查看进行中的记录</button></p>
      <p v-else-if="!activeRun(current)" class="muted small">再次启动使用最新配置，不重放历史快照。</p>
      <div v-if="current.state==='stopping'" class="notice" role="status">已收到停止请求，正在等待当前任务退出；不会再开始后续步骤。</div>
      <div v-if="activeStep && current.state==='running'" class="current-task"><strong>当前第 {{steps.findIndex(s=>s.definition.id===activeStep!.definition.id)+1}} 步 · {{activeStep.definition.course.name}} · {{activeStep.definition.account.name}}</strong><p>{{phases[activeStep.result?.status?.phase??'preparing']}} · {{activeStep.result?.status?.currentTitle || activeStep.result?.status?.message || '正在准备课程'}}</p></div>
      <template v-for="step in current.steps" :key="step.stepId"><div v-if="current.state==='running' && step.state==='running' && step.status?.intervention" class="notice warning" role="status"><p>{{step.status!.intervention!.message}}</p><div class="actions"><button :disabled="busy" title="在课程窗口中完成登录或验证码" @click="action(current,'正在打开窗口…',()=>api.workflows.openWindow(current!.id))">打开处理窗口</button><button :disabled="busy || !step.status!.intervention!.id" title="完成窗口中的操作后，通知当前任务继续" @click="action(current,'正在确认…',()=>api.workflows.confirm(current!.id,step.stepId,step.status!.intervention!.id!))">已完成，继续</button></div></div></template>
      <div class="run-metrics"><div><small>已完成步骤</small><strong>{{metrics.completed}} <span>/ {{steps.length}}</span></strong></div><div><small>已处理</small><strong>{{metrics.handled}} <span>项</span></strong></div><div><small>学习时长</small><strong>{{metrics.minutes}} <span>分钟</span></strong></div></div>
      <div class="run-steps"><article v-for="({definition,result:step},index) in steps" :key="definition.id" class="step stack" :class="{current:step?.state==='running'}">
        <h3>{{index+1}}. {{definition.course.name}} · {{definition.account.name}} <span class="badge" :class="{attention:current.state==='running' && step?.status?.intervention && step.state==='running',failure:step?.state==='failed'}">{{stepLabel(step,current.state)}}</span></h3>
        <p>{{KIND_LABELS[definition.course.kind]}} · {{ACTION_LABELS[definition.options.action]}} · {{definition.options.timeLimitMinutes ? `${definition.options.timeLimitMinutes} 分钟` : '不限时长'}}</p>
        <template v-if="step?.status"><p v-if="step.state==='running' && current.state==='stopping'">正在退出当前任务</p><p v-else-if="step.state!=='cancelled'">{{phases[step.status.phase??'idle']}} · {{step.status.currentTitle || step.status.message}}</p><p>已处理 {{step.status.completedCount}} 项 · 学习 {{Math.floor(step.status.watchedSeconds/60)}} 分钟<span v-if="stopReason(step.status)"> · {{stopReason(step.status)}}</span></p></template>
        <p v-if="step?.transcription">转录：{{step.transcription.message}}<span v-if="step.transcription.percent!==null"> · {{step.transcription.percent}}%</span></p><div v-if="step?.error" class="notice error">{{step.error}}</div>
      </article></div>
      <details open class="logs"><summary>技术日志（{{logs.length}}）</summary>
        <div class="actions log-tools"><ChoiceButtons v-model="level" label="日志级别" :choices="[{value:'',label:'全部'},{value:'info',label:'信息'},{value:'warning',label:'警告'},{value:'error',label:'错误'},{value:'debug',label:'调试'}]"/><button :disabled="!filtered.length" @click="copy" title="复制当前筛选结果"><UiIcon name="copy"/>复制日志</button><label class="check-row"><input v-model="followLogs" type="checkbox"/>跟随最新</label><button v-if="unseenLogs" class="quiet" @click="followLogs=true">{{unseenLogs}} 条新日志</button><span v-if="copied" class="muted small" role="status">日志已复制</span></div>
        <p v-if="logError" class="failure small" role="alert">日志更新失败：{{logError}} <button class="quiet" @click="refreshLogs">重试</button></p>
        <pre ref="logPanel" @scroll="logScroll">{{logText || (logLoading?'正在加载日志…':level && logs.length?'当前级别没有日志':'暂无日志')}}</pre>
      </details>
    </section>
    <section v-else class="empty"><h2>选择运行记录</h2><p>更改筛选条件，或从列表选择记录。</p></section>
  </WorkspaceSplit>
</div>
</template>
<style scoped>
.runs-page { display:flex;flex-direction:column;overflow:hidden; }
.run-toolbar { padding:12px;position:sticky;top:0;background:var(--list-surface);z-index:1; }
.run-filters { display:flex;gap:2px;flex-wrap:wrap; }
.run-filters button { flex:1;min-height:28px;padding:3px 6px;font-size:12px;border-color:transparent;background:transparent;color:var(--text-3);white-space:nowrap; }
.run-filters [aria-pressed=true] { color:var(--accent);background:var(--accent-soft); }
.run-detail { height:100%;min-height:0;display:flex;flex-direction:column;gap:10px; }
.run-detail>:not(.logs) { flex-shrink:0; }
.run-detail h2 { font-size:var(--fs-readout);font-weight:600;overflow-wrap:anywhere; }
.run-detail>p { color:var(--text-3);font-size:12px; }
.run-state { color:var(--text-2);font-weight:550; }
.current-task { border-top:1px solid var(--line-soft);padding-top:8px;overflow-wrap:anywhere; }
.current-task p { color:var(--text-3);font-size:12px;margin-top:4px; }
.run-steps { max-height:200px;overflow:auto;flex-shrink:0; }
.run-metrics { display:flex;gap:32px;flex-wrap:wrap;padding:10px 0;border-block:1px solid var(--line-soft); }
.run-metrics small { display:block;color:var(--text-3);margin-bottom:4px; }
.run-metrics strong { font-size:var(--fs-readout);font-weight:550;font-variant-numeric:tabular-nums; }
.run-metrics strong span { font-size:12px;font-weight:400;color:var(--text-3); }
.step { padding:8px 0;gap:4px; }
.step.current h3 { color:var(--accent); }
.step+.step { border-top:1px solid var(--line-soft); }
.step h3 { font-size:13px;font-weight:550;overflow-wrap:anywhere; }
.step p { color:var(--text-2);font-size:12px; }
.attention { color:var(--brass); }
.failure { color:var(--clay); }
.logs { flex:1;min-height:160px;border-top:1px solid var(--line);padding-top:10px; }
.logs[open] { display:flex;flex-direction:column; }
.logs::details-content { display:flex;flex-direction:column;flex:1;min-height:0; }
.logs:not([open]) { flex:0;min-height:0; }
.logs summary { cursor:pointer;margin-bottom:8px;font-weight:550; }
.logs pre { white-space:pre-wrap;overflow-wrap:anywhere;flex:1;height:100px;min-height:100px;overflow:auto;font:12px/1.65 var(--font-num);background:var(--ground);padding:12px;border:1px solid var(--line-soft);border-radius:6px;margin:8px 0 0; }
.log-tools { gap:6px; }
.log-tools .check-row { font-size:12px; }
button { display:inline-flex;align-items:center;gap:6px; }
.runs-page>.notice { margin:10px 20px 0; }
@container(max-width:500px) { .run-metrics { gap:20px; } }
</style>
