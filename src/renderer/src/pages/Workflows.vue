<script setup lang="ts">
import { needsAttention,runLabel } from '../lib/run-presentation'
import WorkspaceToolbar from '../components/WorkspaceToolbar.vue'
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useWorkflowsStore } from '../stores/workflows'
import { useAccountStore } from '../stores/account'
import { useCoursesStore } from '../stores/courses'
import WorkflowEditor from '../components/WorkflowEditor.vue'
import WorkspaceSplit from '../components/WorkspaceSplit.vue'
import ToolRow from '../components/ToolRow.vue'
import UiIcon from '../components/UiIcon.vue'
import type { Workflow, WorkflowInput, WorkflowSchedule } from '@shared/workflows'
const store = useWorkflowsStore(), courses = useCoursesStore(), accounts = useAccountStore(), route = useRoute(), router = useRouter()
const selected = ref(''), draft = ref<WorkflowInput | null>(null), version = ref(0), baseline = ref(''), error = ref(''), message = ref(''), busy = ref(false), courseId = ref(''), search = ref('')
const rejectedRunId=ref('')
const flow = computed(() => store.flows.find(f => f.id === selected.value))
const latestRuns=computed(()=>{const result=new Map<string,typeof store.runs[number]>();for(const run of store.runs){const prior=result.get(run.workflowId);if(!prior || run.startedAt>prior.startedAt)result.set(run.workflowId,run)}return result})
const runningFor=(id:string)=>store.running.find(run=>run.workflowId===id)
const latestFor=(id:string)=>latestRuns.value.get(id)
const shownRun=(id:string)=>runningFor(id)??latestFor(id)
const blockingRun = computed(()=>flow.value ? store.running.find(run=>run.workflowId===flow.value!.id || run.snapshot.steps.some(step=>flow.value!.steps.some(s=>s.accountId===step.accountId))) : undefined)
const startReason = computed(()=>blockingRun.value ? blockingRun.value.workflowId===flow.value?.id ? '该工作流正在运行，不能重复启动。' : `账号被工作流“${blockingRun.value.snapshot.workflow.name}”占用，结束后可启动。` : '')
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value)
watch(selected,id=>{store.viewedWorkflowId=id})
watch(()=>route.query.id,id=>{if(!draft.value && typeof id==='string' && store.flows.some(flow=>flow.id===id))selected.value=id})
const visible = computed(() => store.flows.filter(f => f.name.toLowerCase().includes(search.value.toLowerCase())))
watch(search, () => {
  if (!visible.value.some(item => item.id === selected.value)) selected.value = visible.value[0]?.id ?? ''
})
function mayLeave(): boolean { return !dirty.value || window.confirm('还有未保存的工作流修改，确定放弃吗？') }
onBeforeRouteLeave(mayLeave)
function beforeUnload(e: BeforeUnloadEvent): void { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(async () => { window.addEventListener('beforeunload', beforeUnload); try { await Promise.all([store.load(),accounts.load()]); selected.value = store.flows.find(flow=>flow.id===String(route.query.id??store.viewedWorkflowId))?.id ?? store.flows[0]?.id ?? ''; if (route.query.courseId) { create(); courseId.value = String(route.query.courseId); addStep();await router.replace({query:{...route.query,courseId:undefined}}) } } catch (e) { error.value = String(e) } })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
function choose(id: string): void { if (!mayLeave()) return; selected.value = id; draft.value = null; error.value = ''; message.value = '';rejectedRunId.value=''  }
function edit(value?: Workflow): void {
  if (busy.value || !mayLeave()) return
  if(value) selected.value = value.id; version.value = value?.version ?? 0
  draft.value = value ? JSON.parse(JSON.stringify({ name: value.name, steps: value.steps, schedule: value.schedule })) : { name: '', steps: [], schedule: null }
  baseline.value = JSON.stringify(draft.value); error.value = ''; message.value = '';rejectedRunId.value=''
}
function create(): void { edit() }
async function cancel(): Promise<void> {
  if (busy.value || !mayLeave()) return
  const refresh = !!error.value
  draft.value = null; error.value = ''; message.value = '';rejectedRunId.value=''
  if (!refresh) return
  busy.value = true
  try {
    await store.load()
    if (!store.flows.some(item=>item.id===selected.value)) selected.value = visible.value[0]?.id ?? ''
  } catch (e) { error.value = String(e) }
  finally { busy.value = false }
}
function addStep(): void { const course = courses.library.courses.find(c => c.id === courseId.value); if (!draft.value || !course) return; draft.value.steps.push({ id: crypto.randomUUID(), accountId: accounts.accounts.length === 1 ? accounts.accounts[0].id : '', courseId: course.id, options: { ...course.options } }); if (!draft.value.name) draft.value.name = course.name + ' 工作流' }
async function save(): Promise<void> {
  if (!draft.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    const input = JSON.parse(JSON.stringify(draft.value))
    const saved = version.value
      ? await window.appApi.workflows.update(selected.value, version.value, input)
      : await window.appApi.workflows.create(input)
    // A refresh failure must not turn a successful create into a second create on retry.
    selected.value = saved.id; version.value = saved.version
    await store.load()
    search.value = ''; draft.value = null; message.value = '工作流已保存'
    await router.replace({query:{...route.query,id:saved.id,courseId:undefined}})
  } catch (e) { error.value = String(e) }
  finally { busy.value = false }
}
async function start(): Promise<void> {
  if(!flow.value || busy.value || startReason.value)return
  const id=flow.value.id
  busy.value=true;error.value='';message.value='';rejectedRunId.value=''
  try {
    const result=await window.appApi.workflows.start(id)
    await store.refreshRuns()
    if(!result.ok){rejectedRunId.value=result.runId??'';throw Error(result.message)}
    await router.push({path:'/run',query:{id:result.runId}})
  }catch(e){error.value=String(e).replace(/^Error: /,'')}
  finally{busy.value=false}
}
async function toggleSchedule(): Promise<void> {
  const current = flow.value
  if (!current?.schedule || busy.value) return
  busy.value = true; error.value = ''; message.value = '';rejectedRunId.value=''
  const enabled = !current.schedule.enabled
  try {
    await window.appApi.workflows.update(current.id, current.version, JSON.parse(JSON.stringify({
      name: current.name, steps: current.steps, schedule: { ...current.schedule, enabled }
    })))
    await store.load()
    message.value = enabled ? '定时已启用' : '定时已停用；当前运行不受影响，仍可手动运行'
  } catch (e) { error.value = String(e) }
  finally { busy.value = false }
}
async function remove(): Promise<void> {
  if (busy.value || !flow.value || !window.confirm('删除此工作流及其定时规则？运行历史和课程将保留。')) return
  busy.value = true; error.value = ''
  try {
    await window.appApi.workflows.remove(flow.value.id)
    await store.load()
    selected.value = visible.value[0]?.id ?? ''
    message.value = '工作流已删除，运行历史已保留'
  } catch (e) { error.value = String(e) }
  finally { busy.value = false }
}
const courseName = (id: string): string => courses.library.courses.find(c => c.id === id)?.name ?? '课程已不可用'
const scheduleLabel = (s: WorkflowSchedule | null): string => !s ? '仅手动运行' : `${s.enabled ? '已启用' : '已停用'} · ${s.kind === 'daily' ? '每日 ' + s.time : new Date(s.time).toLocaleString('zh-CN',{timeZone:s.timeZone})} · ${s.timeZone}`
</script>
<template>
<div class="page workflows-page">
<WorkflowEditor :accounts="accounts.accounts" v-if="draft" v-model="draft" :courses="courses.library.courses" :busy="busy" :dirty="dirty" :error="error" @save="save" @cancel="cancel"/>
<template v-else>
<WorkspaceToolbar title="工作流"><button :disabled="busy" class="primary" @click="create"><UiIcon name="add"/>创建工作流</button></WorkspaceToolbar>
<div v-if="error||store.flowError||store.error" class="notice error" role="alert">{{error||store.flowError||store.error}}</div><div v-if="message" class="notice success" role="status">{{message}}</div>
<WorkspaceSplit :detail-key="selected">
<template #list><div class="list-toolbar"><input v-model="search" type="search" aria-label="搜索工作流" placeholder="搜索工作流"/></div><ToolRow v-for="item in visible" :key="item.id" :selected="selected===item.id" :title="item.name" @click="choose(item.id)"><span class="row-text"><strong>{{item.name}}</strong><small>{{item.steps.length}} 步 · {{!item.schedule?'仅手动':!item.schedule.enabled?'定时已停用':item.schedule.kind==='daily'?'每日 '+item.schedule.time:'单次定时'}}</small></span><span v-if="latestFor(item.id)" class="badge" :class="{green:!!runningFor(item.id),attention:needsAttention(shownRun(item.id)!),failure:['failed','partial','rejected','interrupted'].includes(shownRun(item.id)!.state)}" :title="runLabel(shownRun(item.id)!)">{{runningFor(item.id) ? needsAttention(runningFor(item.id)!)?'需处理':runningFor(item.id)!.state==='stopping'?'停止中':'运行中' : latestFor(item.id)!.state==='succeeded'?'执行完成':runLabel(latestFor(item.id)!)}}</span></ToolRow><p v-if="!visible.length" class="empty">没有匹配的工作流</p></template>
<section v-if="flow" class="stack flow-detail"><h2 class="detail-title">{{flow.name}}</h2><div class="actions"><button class="primary" :disabled="busy||!!startReason" :title="startReason || '以当前保存的配置启动一次运行'" @click="start"><UiIcon name="play"/>立即运行</button><button :disabled="busy" title="修改只影响下一次运行，当前运行使用启动时配置" @click="edit(flow)"><UiIcon name="edit"/>编辑</button><button :disabled="busy||store.running.some(r=>r.workflowId===flow!.id)" :title="runningFor(flow.id)?'请先停止正在运行的记录':'删除工作流与定时规则，保留课程和运行历史'" @click="remove">删除</button><button v-if="flow.schedule" :disabled="busy" title="只改变后续定时触发，不影响当前运行和手动启动" @click="toggleSchedule">{{flow.schedule.enabled?'停用定时':'启用定时'}}</button></div><p v-if="startReason" class="muted small">{{startReason}} <RouterLink v-if="blockingRun" :to="{path:'/run',query:{id:blockingRun.id}}">查看运行</RouterLink></p><p v-if="latestFor(flow.id)" class="muted small">最近一次：{{runLabel(latestFor(flow.id)!)}} <RouterLink :to="{path:'/run',query:{id:latestFor(flow.id)!.id}}">查看记录</RouterLink></p><div v-if="flow.notice" class="notice warning">{{flow.notice}}</div><p>{{scheduleLabel(flow.schedule)}}</p><p v-if="flow.schedule?.nextAt">下次运行：{{new Date(flow.schedule.nextAt).toLocaleString()}}</p><h3>执行顺序</h3><ol class="flow-steps"><li v-for="step in flow.steps" :key="step.id"><strong>{{courseName(step.courseId)}}</strong><small>账号：{{accounts.accounts.find(a=>a.id===step.accountId)?.name || '账号不可用'}}</small><small>{{ {learn:'学习','learn-transcribe':'学习并转录',transcribe:'仅转录'}[step.options.action] }} · {{step.options.startPosition==='resume'?'上次位置':'课程开头'}} · {{step.options.timeLimitMinutes?step.options.timeLimitMinutes+' 分钟':'不限时长'}} · {{step.options.skipCompleted?'跳过已完成':'处理全部'}}</small></li></ol><small>修改工作流只影响下一次运行。</small></section>
<section v-else class="empty"><template v-if="store.flows.length"><h2>选择工作流</h2><p>更改搜索条件，或从列表选择工作流。</p></template><template v-else><h2>把课程组合成工作流</h2><p>每个工作流顺序执行，不同工作流可并行。</p><button @click="create">创建第一个工作流</button></template></section>
</WorkspaceSplit></template></div>
</template>
<style scoped>
.attention { color:var(--brass); }
.failure { color:var(--clay); }
.workflows-page { display:flex;flex-direction:column;overflow:hidden; }
.list-toolbar { padding:12px;position:sticky;top:0;background:var(--list-surface);z-index:1; }
.detail-title { font-size:var(--fs-readout);font-weight:600;overflow-wrap:anywhere; }
.flow-detail { gap:16px; }
.flow-steps { padding-left:24px;margin:0; }
.flow-steps li { padding:10px 0;overflow-wrap:anywhere; }
.flow-steps li+li { border-top:1px solid var(--line-soft); }
.flow-steps strong { font-weight:550; }
.flow-steps small { display:block;color:var(--text-3);margin-top:4px; }
button { display:inline-flex;align-items:center;gap:6px; }
.workflows-page>.notice { margin:10px 20px 0; }
</style>
