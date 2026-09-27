<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useWorkflowsStore } from '../stores/workflows'
import { useCoursesStore } from '../stores/courses'
import CourseOptionsForm from '../components/CourseOptionsForm.vue'
import type { Workflow, WorkflowInput, WorkflowSchedule } from '@shared/workflows'
const store = useWorkflowsStore(), courses = useCoursesStore(), route = useRoute(), router = useRouter()
const selected = ref(''), draft = ref<WorkflowInput | null>(null), version = ref(0), baseline = ref(''), error = ref(''), message = ref(''), busy = ref(false), courseId = ref(''), search = ref('')
const flow = computed(() => store.flows.find(f => f.id === selected.value))
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value)
const visible = computed(() => store.flows.filter(f => f.name.toLowerCase().includes(search.value.toLowerCase())))
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
const scheduleKind = ref('none'), scheduleTime = ref('09:00'), onceTime = ref(''), scheduleEnabled = ref(true)
function mayLeave(): boolean { return !dirty.value || window.confirm('还有未保存的工作流修改，确定放弃吗？') }
onBeforeRouteLeave(mayLeave)
function beforeUnload(e: BeforeUnloadEvent): void { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(async () => { window.addEventListener('beforeunload', beforeUnload); try { await store.load(); selected.value = store.flows[0]?.id ?? ''; if (route.query.courseId) { create(); courseId.value = String(route.query.courseId); addStep() } } catch (e) { error.value = String(e) } })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
function choose(id: string): void { if (!mayLeave()) return; selected.value = id; draft.value = null; error.value = ''; message.value = '' }
function edit(value?: Workflow): void {
  if (!mayLeave()) return
  selected.value = value?.id ?? ''; version.value = value?.version ?? 0
  draft.value = value ? JSON.parse(JSON.stringify({ name: value.name, steps: value.steps, schedule: value.schedule })) : { name: '', steps: [], schedule: null }
  baseline.value = JSON.stringify(draft.value); error.value = ''; message.value = ''
  const s = draft.value!.schedule; scheduleKind.value = s?.kind ?? 'none'; scheduleTime.value = s?.kind === 'daily' ? s.time : '09:00'; scheduleEnabled.value = s?.enabled ?? true
  onceTime.value = s?.kind === 'once' ? localInput(s.time) : ''
}
function localInput(iso: string): string { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
function create(): void { edit() }
function syncSchedule(): void {
  if (!draft.value) return
  draft.value.schedule = scheduleKind.value === 'none' ? null : { kind: scheduleKind.value as 'once' | 'daily', enabled: scheduleEnabled.value, timeZone: draft.value.schedule?.timeZone ?? zone, time: scheduleKind.value === 'daily' ? scheduleTime.value : onceTime.value ? new Date(onceTime.value).toISOString() : '', nextAt: null }
}
function addStep(): void { const course = courses.library.courses.find(c => c.id === courseId.value); if (!draft.value || !course) return; draft.value.steps.push({ id: crypto.randomUUID(), courseId: course.id, options: { ...course.options } }); if (!draft.value.name) draft.value.name = course.name + ' 工作流' }
function move(index: number, offset: number): void { const steps = draft.value!.steps; const [s] = steps.splice(index, 1); steps.splice(index + offset, 0, s) }
async function save(): Promise<void> { if (!draft.value) return; busy.value = true; error.value = ''; try { const input = JSON.parse(JSON.stringify(draft.value)); const saved = version.value ? await window.appApi.workflows.update(selected.value, version.value, input) : await window.appApi.workflows.create(input); draft.value = null; selected.value = saved.id; await store.load(); message.value = '工作流已保存' } catch (e) { error.value = String(e) } finally { busy.value = false } }
async function start(): Promise<void> { if (!flow.value) return; busy.value = true; error.value = ''; try { const id = await store.start(flow.value.id); await router.push({ path: '/run', query: { id } }) } catch (e) { error.value = String(e) } finally { busy.value = false } }
async function toggleSchedule(): Promise<void> {
  const current = flow.value
  if (!current?.schedule || busy.value) return
  busy.value = true; error.value = ''; message.value = ''
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
async function remove(): Promise<void> { if (!flow.value || !window.confirm('删除此工作流及其定时规则？运行历史和课程将保留。')) return; try { await window.appApi.workflows.remove(flow.value.id); await store.load(); selected.value = store.flows[0]?.id ?? '' } catch (e) { error.value = String(e) } }
const courseName = (id: string): string => courses.library.courses.find(c => c.id === id)?.name ?? '课程已不可用'
const scheduleLabel = (s: WorkflowSchedule | null): string => !s ? '仅手动运行' : `${s.enabled ? '已启用' : '已停用'} · ${s.kind === 'daily' ? '每日 ' + s.time : new Date(s.time).toLocaleString()} · ${s.timeZone}`
</script>
<template>
<div class="page">
<header class="page-header"><h1>工作流</h1><button class="primary" @click="create">创建工作流</button></header>
<div v-if="error||store.error" class="notice error" role="alert">{{error||store.error}}</div><div v-if="message" class="notice success" role="status">{{message}}</div>
<div class="flow-layout">
<aside class="panel stack"><input v-model="search" type="search" aria-label="搜索工作流" placeholder="搜索工作流"/><button v-for="item in visible" :key="item.id" :class="{primary:selected===item.id}" @click="choose(item.id)">{{item.name}} · {{item.steps.length}} 步<span v-if="store.running.some(r=>r.workflowId===item.id)"> · 运行中</span></button><p v-if="!visible.length" class="muted">还没有工作流。先添加课程，再组合步骤。</p></aside>
<form v-if="draft" class="panel stack" @submit.prevent="save">
<h2>{{version?'编辑工作流':'创建工作流'}}</h2><label for="flow-name">工作流名称</label><input id="flow-name" v-model="draft.name" required autofocus/>
<div class="actions"><select v-model="courseId" aria-label="选择步骤课程"><option value="">选择课程</option><option v-for="c in courses.library.courses" :key="c.id" :value="c.id" :disabled="c.kind==='unknown'">{{c.name}}</option></select><button type="button" :disabled="!courseId" @click="addStep">添加步骤</button></div>
<p class="muted">步骤按顺序执行。学习时长只累计执行器报告的学习时间，登录和人工等待不计入；仅转录沿用现有执行器计时。</p>
<section v-for="(step,index) in draft.steps" :key="step.id" class="step stack"><div class="actions"><strong>{{index+1}}. {{courseName(step.courseId)}}</strong><button type="button" :disabled="index===0" :aria-label="`上移步骤 ${index+1}`" @click="move(index,-1)">上移</button><button type="button" :disabled="index===draft.steps.length-1" :aria-label="`下移步骤 ${index+1}`" @click="move(index,1)">下移</button><button type="button" @click="draft.steps.splice(index,1)">删除步骤</button></div><CourseOptionsForm v-model="step.options" :kind="courses.library.courses.find(c=>c.id===step.courseId)?.kind"/></section>
<h3>定时运行</h3><label for="schedule-kind">触发方式</label><select id="schedule-kind" v-model="scheduleKind" @change="syncSchedule"><option value="none">仅手动运行</option><option value="once">单次定时</option><option value="daily">每日固定时间</option></select>
<template v-if="scheduleKind!=='none'"><label class="check-row"><input v-model="scheduleEnabled" type="checkbox" @change="syncSchedule"/>启用定时</label><label for="schedule-time">{{scheduleKind==='daily'?'每日开始时间':'运行日期时间'}}</label><input v-if="scheduleKind==='daily'" id="schedule-time" v-model="scheduleTime" type="time" required @change="syncSchedule"/><input v-else id="schedule-time" v-model="onceTime" type="datetime-local" required @change="syncSchedule"/><small>时区：{{draft.schedule?.timeZone??zone}}。错过后补跑最近一次；课程冲突则拒绝本次启动。</small></template>
<div class="actions"><button type="submit" class="primary" :disabled="busy">保存工作流</button><button type="button" :disabled="busy" @click="mayLeave()&&(draft=null)">取消</button></div>
</form>
<section v-else-if="flow" class="panel stack"><h2>{{flow.name}}</h2><div v-if="flow.notice" class="notice warning">{{flow.notice}}</div><p>{{scheduleLabel(flow.schedule)}}</p><p v-if="flow.schedule?.nextAt">下次运行：{{new Date(flow.schedule.nextAt).toLocaleString()}}</p><ol class="stack"><li v-for="step in flow.steps" :key="step.id">{{courseName(step.courseId)}} · {{ {learn:'学习','learn-transcribe':'学习并转录',transcribe:'仅转录'}[step.options.action] }} · {{step.options.timeLimitMinutes?step.options.timeLimitMinutes+' 分钟':'不限时长'}}</li></ol><div class="actions"><button class="primary" :disabled="busy||store.running.some(r=>r.workflowId===flow!.id)" @click="start">立即运行</button><button v-if="flow.schedule" :disabled="busy" @click="toggleSchedule">{{flow.schedule.enabled?'停用定时':'启用定时'}}</button><button :disabled="busy" @click="edit(flow)">编辑</button><button :disabled="store.running.some(r=>r.workflowId===flow!.id)" @click="remove">删除</button></div><small>修改工作流只影响下一次运行。</small></section>
<section v-else class="panel empty"><h2>把课程组合成工作流</h2><p>每个工作流顺序执行，不同工作流可并行。</p><button @click="create">创建第一个工作流</button></section>
</div></div>
</template>
<style scoped>
.flow-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px;padding:16px;align-items:start}.panel{padding:16px;min-width:0}.step{border:1px solid var(--line);padding:12px;border-radius:8px}.actions{flex-wrap:wrap}.actions select{flex:1;min-width:140px}.actions strong{flex:1;overflow-wrap:anywhere}aside button{text-align:left;white-space:normal;height:auto;min-height:38px}ol{padding-left:24px}@container(max-width:650px){.flow-layout{grid-template-columns:1fr}}
</style>
