<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { WorkflowInput, WorkflowStep } from '@shared/workflows'
import type { Account } from '@shared/accounts'
import type { CourseRunOptions, Course } from '@shared/types'
import { validateRunOptions } from '@shared/courses'
import { unavailableCourse as unavailable } from '../lib/workflow-editor'
import WorkflowCourseLibrary from './WorkflowCourseLibrary.vue'
import WorkflowStepList from './WorkflowStepList.vue'
import WorkflowStepConfig from './WorkflowStepConfig.vue'
import WorkflowScheduleForm from './WorkflowScheduleForm.vue'
import UiIcon from './UiIcon.vue'

const props = defineProps<{ accounts: Account[]; courses: Course[]; busy: boolean; dirty: boolean; error: string }>()
const draft = defineModel<WorkflowInput>({ required: true })
const originalSchedule = JSON.stringify(draft.value.schedule)
const emit = defineEmits<{ save: []; cancel: [] }>()
const selected = ref(draft.value.steps[0]?.id ?? '')
const search = ref(''), picker = ref(false), scheduleOpen = ref(false)
const undoButton=ref<HTMLButtonElement|null>(null)
const validation = ref('')
const undoState=ref<{kind:'remove'|'restore';step:WorkflowStep;index:number;restored?:CourseRunOptions}|null>(null)
watch(()=>JSON.stringify(draft.value),()=>{validation.value='';const undo=undoState.value;if(undo?.kind==='restore' && JSON.stringify(draft.value.steps.find(s=>s.id===undo.step.id)?.options)!==JSON.stringify(undo.restored))undoState.value=null})
const saveHint=computed(()=>!draft.value.name.trim()?'请填写工作流名称':!draft.value.steps.length?'请添加至少一个课程步骤':draft.value.steps.some(s=>!!unavailable(course(s.courseId)))?'有不可用课程，请移除对应步骤后保存':draft.value.steps.some(s=>!props.accounts.some(a=>a.id===s.accountId))?'请选择每一步使用的账号':'')
async function undo():Promise<void> {
  const value=undoState.value;if(!value||props.busy)return
  if(value.kind==='remove')draft.value.steps.splice(Math.min(value.index,draft.value.steps.length),0,JSON.parse(JSON.stringify(value.step)))
  else {const step=draft.value.steps.find(s=>s.id===value.step.id);if(step)step.options={...value.step.options}}
  selected.value=value.step.id;undoState.value=null
  await nextTick();stepList.value?.focusSelected()
}
function shortcuts(event:KeyboardEvent):void {
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void save()}
  if(event.key==='Escape' && picker.value){event.preventDefault();picker.value=false}
}
const library = ref<InstanceType<typeof WorkflowCourseLibrary> | null>(null)
const pickerTrigger = ref<HTMLButtonElement | null>(null)
const editorBody = ref<HTMLElement | null>(null)
const configPanel = ref<InstanceType<typeof WorkflowStepConfig> | null>(null)
const stepList = ref<InstanceType<typeof WorkflowStepList> | null>(null)
const scheduleForm = ref<InstanceType<typeof WorkflowScheduleForm> | null>(null)
watch(selected, async () => { await nextTick(); stepList.value?.revealSelected();if(!draft.value.steps.length){if(pickerTrigger.value?.offsetParent)pickerTrigger.value.focus();else library.value?.focusSearch()} })

watch(picker, async open => {
  if (open) scheduleOpen.value = false
  await nextTick()
  if (open) {
    if (editorBody.value) editorBody.value.scrollTop = 0
    library.value?.focusSearch()
  } else if (pickerTrigger.value?.offsetParent) pickerTrigger.value.focus()
  else library.value?.focusSearch()
})
let resize: ResizeObserver | undefined
onMounted(() => {
  let wasWide = (editorBody.value?.clientWidth ?? 0) > 900
  resize = new ResizeObserver(entries => {
    const wide = entries[0].contentRect.width > 900
    if (wide && picker.value) picker.value = false
    if (wasWide && !wide && (library.value?.containsFocus() || document.activeElement === document.body)) pickerTrigger.value?.focus()
    wasWide = wide
    stepList.value?.revealSelected()
  })
  if (editorBody.value) resize.observe(editorBody.value)
})
onBeforeUnmount(() => resize?.disconnect())
const current = computed(() => draft.value.steps.find(step => step.id === selected.value))
const course = (id: string): Course | undefined => props.courses.find(item => item.id === id)
const name = (step: WorkflowStep): string => course(step.courseId)?.name ?? '课程已不可用'
const scheduleSummary = computed(() => !draft.value.schedule ? '仅手动'
  : `${draft.value.schedule.kind === 'daily' ? '每日定时' : '单次定时'} · ${draft.value.schedule.enabled ? '启用' : '停用'}`)
async function selectStep(id: string): Promise<void> {
  selected.value = id
  await nextTick()
  if (editorBody.value && editorBody.value.clientWidth < 600) configPanel.value?.scrollToConfig()
}
function add(value: Course): void {
  if (props.busy || unavailable(value)) return
  const step = { id: crypto.randomUUID(), accountId: props.accounts.length === 1 ? props.accounts[0].id : '', courseId: value.id, options: { ...value.options } }
  draft.value.steps.push(step)
  selected.value = step.id
  if (!draft.value.name) draft.value.name = value.name + ' 工作流'
}
function move(id: string, to: number): void {
  if (props.busy) return
  const from = draft.value.steps.findIndex(step => step.id === id)
  if (from < 0 || to < 0 || to >= draft.value.steps.length) return
  const [step] = draft.value.steps.splice(from, 1)
  draft.value.steps.splice(to, 0, step)
}
function remove(id: string): void {
  if (props.busy) return
  const index = draft.value.steps.findIndex(step => step.id === id)
  if (index < 0) return
  undoState.value={kind:'remove',step:JSON.parse(JSON.stringify(draft.value.steps[index])),index}
  draft.value.steps.splice(index, 1)
  if (selected.value === id) selected.value = draft.value.steps[Math.min(index, draft.value.steps.length - 1)]?.id ?? ''
}
async function restore(): Promise<void> {
  const value = current.value && course(current.value.courseId)
  if (!props.busy && value && current.value) {
    undoState.value={kind:'restore',step:JSON.parse(JSON.stringify(current.value)),index:draft.value.steps.findIndex(s=>s.id===current.value!.id),restored:{...value.options}}
    current.value.options={...value.options}
    await nextTick();undoButton.value?.focus()
  }
}
async function scheduleError(message: string, field: 'time' | 'zone'): Promise<void> {
  scheduleOpen.value = true
  validation.value = message
  await nextTick()
  scheduleForm.value?.focusInvalid(field)
}
async function save(): Promise<void> {
  if (props.busy || !draft.value.name.trim() || !draft.value.steps.length) return
  validation.value = ''
  for (const step of draft.value.steps) {
    try {
      const value = course(step.courseId)
      if (!props.accounts.some(a=>a.id===step.accountId)) throw Error('请选择账号')
      const reason = unavailable(value)
      if (reason) throw Error(reason)
      validateRunOptions(step.options, value!.kind)
    } catch (error) {
      selected.value = step.id
      validation.value = `${name(step)}：${String(error).replace(/^Error: /, '')}`
      await nextTick()
      configPanel.value?.focusInvalid()
      return
    }
  }
  const schedule = draft.value.schedule
  if (schedule) {
    try { new Intl.DateTimeFormat('zh-CN', { timeZone: schedule.timeZone }).format() }
    catch { await scheduleError('请输入有效时区，例如 Asia/Shanghai', 'zone'); return }
    const invalidTime = schedule.kind === 'daily'
      ? !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)
      : !schedule.time || Number.isNaN(new Date(schedule.time).getTime())
    if (invalidTime) { await scheduleError('请选择有效的定时时间', 'time'); return }
    if (schedule.kind === 'once' && schedule.enabled && JSON.stringify(schedule) !== originalSchedule && new Date(schedule.time).getTime() <= Date.now()) {
      await scheduleError('单次定时必须晚于当前时间', 'time'); return
    }
  }
  emit('save')
}
</script>
<template>
<form @keydown="shortcuts" class="workflow-editor" novalidate @submit.prevent="save" @keydown.esc="picker=false">
<header class="editor-header"><button type="button" :disabled="busy" @click="emit('cancel')"><UiIcon name="back"/>返回</button><input :disabled="busy" v-model="draft.name" aria-label="工作流名称" placeholder="工作流名称"/><span class="muted">{{draft.steps.length}} 步</span><button type="button" :aria-expanded="scheduleOpen" @click="scheduleOpen=!scheduleOpen" title="展开定时配置；定时修改随工作流一起保存">{{scheduleSummary}}</button></header>
<WorkflowScheduleForm v-show="scheduleOpen" ref="scheduleForm" v-model="draft.schedule" :disabled="busy" />
<div v-if="error||validation" class="notice error" role="alert">{{validation||error}}<span v-if="error">；草稿已保留</span></div>
<div class="editor-mobile-tools"><button ref="pickerTrigger" type="button" :aria-expanded="picker" @click="picker=!picker"><UiIcon name="add"/>添加课程</button><span class="muted editor-context">选中步骤即可编辑配置</span></div>
<div ref="editorBody" class="editor-body">
<WorkflowCourseLibrary ref="library" v-model:search="search" :courses="courses" :disabled="busy" :picker="picker" :step-count="draft.steps.length" :counts="Object.fromEntries(courses.map(c=>[c.id,draft.steps.filter(s=>s.courseId===c.id).length]))" @add="add" @close="picker=false" />
<WorkflowStepList :accounts="accounts" ref="stepList" :steps="draft.steps" :courses="courses" :selected="selected" :disabled="busy" @select="selectStep" @move="move" @remove="remove" />
<WorkflowStepConfig :accounts="accounts" ref="configPanel" :step="current" :position="draft.steps.findIndex(s=>s.id===selected)+1" :course="current && course(current.courseId)" :disabled="busy" @restore="restore" />
</div>
<footer class="editor-footer"><div class="footer-feedback"><span v-if="undoState" role="status">{{undoState.kind==='remove'?'已移除步骤':'已恢复课程配置'}} <button type="button" ref="undoButton" class="quiet" :disabled="busy" @click="undo">撤销</button></span><span class="muted">{{saveHint || (dirty?'有未保存的修改':'草稿未修改')}}</span></div><div class="actions"><button type="button" :disabled="busy" @click="emit('cancel')">取消</button><button type="submit" class="primary" :title="saveHint || '保存工作流，不会自动启动；⌘/Ctrl+S'" :disabled="busy||!draft.name.trim()||!draft.steps.length||draft.steps.some(s=>!!unavailable(course(s.courseId)))"><UiIcon name="save"/>{{busy?'正在保存…':'保存工作流'}}</button></div></footer>
</form>
</template>
<style scoped>
.footer-feedback { min-width:0;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center; }
.workflow-editor { display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden; }
.editor-header,.editor-footer { display:flex;align-items:center;gap:8px;padding:12px 16px;flex-shrink:0;background:var(--surface); }
.editor-header { border-bottom:1px solid var(--line);flex-wrap:wrap; }
.editor-header input { flex:1;min-width:100px; }
.editor-footer { justify-content:space-between;border-top:1px solid var(--line); }
button { display:inline-flex;align-items:center;justify-content:center;gap:4px; }
.editor-body { display:grid;grid-template-columns:220px minmax(0,1fr) 300px;min-height:0;flex:1;position:relative;overflow:hidden; }
.editor-mobile-tools { display:none;padding:8px 16px;border-bottom:1px solid var(--line); }
.workflow-editor>.notice { margin:4px 8px; }
@container(max-width:900px) {
  .editor-body { grid-template-columns:minmax(0,1fr) 300px; }
  .editor-mobile-tools { display:flex;justify-content:space-between; }
}
@container(max-width:600px) {
  .editor-body { display:block;overflow:auto; }
  .editor-context { display:none; }
  .editor-header input { order:3;flex-basis:100%; }
  .editor-header,.editor-footer { padding:8px 12px; }
  .editor-footer>span { font-size:12px; }
}
</style>
