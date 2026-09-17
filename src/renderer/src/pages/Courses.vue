<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useCoursesStore } from '../stores/courses'
import { useAppStore } from '../stores/app'
import { useSchedulerStore } from '../stores/scheduler'
import CourseOptionsForm from '../components/CourseOptionsForm.vue'
import { ACTION_LABELS, KIND_LABELS, identifyCourse } from '@shared/courses'
import type { CourseInput } from '@shared/types'
const store = useCoursesStore(), run = useAppStore(), scheduler = useSchedulerStore()
const route = useRoute(), router = useRouter()
const uid = useId()
const search = ref(''), focusedId = ref(String(route.query.id ?? store.library.selectedCourseId ?? ''))
const focused = computed(() => store.library.courses.find(c => c.id === focusedId.value) ?? null)
const filtered = computed(() => store.library.courses.filter(c => c.name.toLowerCase().includes(search.value.toLowerCase())))
const busy = ref(false), error = ref(''), message = ref(''), duplicateId = ref('')
const editingId = ref<string | null>(null), modal = ref(false)
const draft = ref<CourseInput>({ name: '', url: '', options: { ...store.library.defaults } })
const baseline = ref(''), urlInput = ref<HTMLInputElement | null>(null), dialog = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
const dirty = computed(() => modal.value && JSON.stringify(draft.value) !== baseline.value)
const parsed = computed(() => { try { return identifyCourse(draft.value.url) } catch { return null } })
const parseError = computed(() => { if (!draft.value.url) return ''; try { identifyCourse(draft.value.url); return '' } catch(e) { return String(e).replace(/^Error: /, '') } })
const locked = computed(() => run.isRunning && run.status.courseId === focusedId.value)
watch(() => parsed.value?.kind, kind => { if (kind === 'map' && draft.value.options.action === 'transcribe') draft.value.options.action = 'learn' })
function mayLeave(): boolean { return !dirty.value || window.confirm('还有未保存的修改，确定放弃吗？') }
onBeforeRouteLeave(() => mayLeave())
function beforeUnload(event: BeforeUnloadEvent): void { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
async function openForm(edit = false): Promise<void> {
  previousFocus = document.activeElement as HTMLElement
  editingId.value = edit ? focused.value?.id ?? null : null
  draft.value = edit && focused.value ? { name: focused.value.name, url: focused.value.url, options: { ...focused.value.options } } : { name: '', url: '', options: { ...store.library.defaults } }
  baseline.value = JSON.stringify(draft.value); error.value = ''; duplicateId.value = ''; modal.value = true
  await nextTick(); urlInput.value?.focus()
}
function closeForm(): void { if (!busy.value && mayLeave()) { modal.value = false; error.value = ''; previousFocus?.focus() } }
function trap(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); closeForm() }
  if (event.key !== 'Tab') return
  const nodes = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') ?? [])
  const first = nodes[0], last = nodes[nodes.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
async function save(): Promise<void> {
  busy.value = true; error.value = ''; duplicateId.value = ''
  try {
    const input = JSON.parse(JSON.stringify(draft.value)) as CourseInput
    const result = store.accept(editingId.value ? await window.appApi.courses.update(editingId.value, input) : await window.appApi.courses.create(input))
    if (!result.ok) { error.value = result.message; duplicateId.value = result.existingCourseId ?? ''; return }
    focusedId.value = result.courseId ?? focusedId.value; modal.value = false; message.value = '课程已保存'; previousFocus?.focus()
  } catch(e) { error.value = `保存失败，输入已保留：${String(e)}` }
  finally { busy.value = false }
}
async function selectCurrent(): Promise<void> {
  try { await store.select(focusedId.value); message.value = '已设为本次课程' } catch(e) { error.value = String(e) }
}
async function start(): Promise<void> {
  if (!focused.value) return
  await selectCurrent()
  if (await run.start(focused.value.id)) await router.push('/run')
}
async function remove(): Promise<void> {
  const course = focused.value; if (!course) return
  const scheduled = scheduler.status?.config.courseId === course.id
  if (!window.confirm(`移除“${course.name}”？学习进度和转录文件会保留。${scheduled ? '该课程的自动调度也将停用。' : ''}`)) return
  try {
    const result = store.accept(await window.appApi.courses.remove(course.id))
    if (!result.ok) { error.value = result.message; return }
    focusedId.value = store.library.selectedCourseId ?? ''; message.value = '课程已移除，进度已保留'
  } catch(e) { error.value = String(e) }
}
async function copyUrl(): Promise<void> { try { await navigator.clipboard.writeText(focused.value?.url ?? ''); message.value = '地址已复制' } catch { error.value = '复制失败，请在课程详情中选中地址复制' } }
function openExisting(): void { focusedId.value = duplicateId.value; modal.value = false; error.value = '' }
const lastRun = (date: string | null): string => date ? new Date(date).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未运行'
</script>
<template>
  <div class="page courses-page">
    <header class="page-header"><h1>我的课程</h1><button class="primary" @click="openForm()">＋ 添加课程</button></header>
    <div v-if="!modal && (error || run.error || store.error)" class="notice error" role="alert">{{ error || run.error || store.error }} <button v-if="store.error" @click="store.load">重新加载</button></div>
    <div v-if="message" class="notice success" role="status">{{ message }}</div>
    <div v-if="store.loading" class="empty" role="status">正在加载课程…</div>
    <div v-else-if="!store.library.courses.length" class="panel empty"><h2>从第一门课程开始</h2><p>粘贴课程学习页地址，为它取一个容易找到的名字。</p><p class="small">支持智慧树传统课和图谱课，每次运行一门。</p><button class="primary" @click="openForm()">添加第一门课程</button></div>
    <div v-else class="course-layout">
      <section class="course-list" aria-label="课程列表"><div class="list-header"><strong>全部课程 <span class="muted">{{ store.library.courses.length }}</span></strong><input v-model="search" type="search" aria-label="搜索课程" placeholder="搜索课程名称" /></div>
        <div class="course-rows"><div v-if="!filtered.length" class="empty">没有匹配的课程</div>
        <button v-for="course in filtered" :key="course.id" class="course-row" :class="{ active: course.id === focusedId }" :aria-pressed="course.id === focusedId" @click="focusedId = course.id; message = ''; error = ''">
          <div class="course-row-content"><strong :title="course.name">{{ course.name }}</strong><div><span>{{ KIND_LABELS[course.kind] }}</span> · {{ lastRun(course.lastRunAt) }}</div></div>
          <span v-if="run.isRunning && run.status.courseId === course.id" class="badge green">运行中</span><span v-else-if="course.id === store.library.selectedCourseId" class="selected-dot" title="本次课程" aria-label="本次课程"></span>
        </button></div>
      </section>
      <section v-if="focused" class="course-detail" aria-label="课程详情">
        <div class="detail-top"><span class="badge blue">{{ KIND_LABELS[focused.kind] }}</span><div class="actions"><button class="quiet" :disabled="locked" @click="openForm(true)">编辑</button><button class="quiet danger" :disabled="locked" @click="remove">移除</button></div></div>
        <h2 class="course-name">{{ focused.name }}</h2><p class="muted small">最近运行 · {{ lastRun(focused.lastRunAt) }}</p>
        <div v-if="locked" class="notice">这门课程正在运行。停止任务后可编辑或移除。</div>
        <div v-if="focused.progressWarning" class="notice warning">{{ focused.progressWarning }}</div>
        <div class="divider"></div><h3>运行配置</h3>
        <dl class="detail-grid"><div><dt>运行方式</dt><dd>{{ ACTION_LABELS[focused.options.action] }}</dd></div><div><dt>起始位置</dt><dd>{{ focused.options.startPosition === 'resume' ? '从上次位置继续' : '从课程开头' }}</dd></div><div><dt>已完成内容</dt><dd>{{ focused.options.skipCompleted ? '自动跳过' : '仍然处理' }}</dd></div><div><dt>单次时长</dt><dd>{{ focused.options.timeLimitMinutes ? `${focused.options.timeLimitMinutes} 分钟` : '不限时长' }}</dd></div></dl>
        <div class="last-position"><span class="muted small">上次完成的位置</span><p>{{ focused.lastVideoTitle || '暂无记录，完成内容后会自动保存' }}</p></div>
        <div class="divider"></div><div class="address-header"><h3>课程地址</h3><button class="quiet" @click="copyUrl">复制</button></div><p class="course-url">{{ focused.url }}</p>
        <div class="detail-footer"><button :disabled="store.library.selectedCourseId === focused.id" @click="selectCurrent">{{ store.library.selectedCourseId === focused.id ? '已设为本次课程' : '设为本次课程' }}</button><button class="primary" :disabled="!run.canStart || focused.kind === 'unknown'" @click="start">{{ run.isRunning ? '已有任务运行中' : '开始运行 →' }}</button></div>
      </section><section v-else class="empty"><h2>选择一门课程</h2><p>点击左侧课程，查看配置和上次进度。</p></section>
    </div>
    <Teleport to="body"><div v-if="modal" class="modal-backdrop" @click.self="closeForm"><form ref="dialog" class="modal stack" role="dialog" aria-modal="true" aria-labelledby="course-form-title" @submit.prevent="save" @keydown="trap">
      <header><h2 id="course-form-title">{{ editingId ? '编辑课程' : '添加课程' }}</h2><p class="muted">{{ editingId ? '修改只应用于这门课程。' : '保存后可随时开始，不会自动运行。' }}</p></header>
      <div v-if="error" class="notice error" role="alert">{{ error }}<button v-if="duplicateId" type="button" @click="openExisting">打开已有课程</button></div>
      <div class="field"><label :for="`${uid}-url`">课程地址</label><input :id="`${uid}-url`" ref="urlInput" v-model="draft.url" type="url" placeholder="粘贴课程学习页链接" required /><small v-if="parsed">已识别为{{ KIND_LABELS[parsed.kind] }}</small><small v-else-if="parseError" class="error-text">{{ parseError }}</small></div>
      <div class="field"><label :for="`${uid}-name`">课程名称</label><input :id="`${uid}-name`" v-model="draft.name" placeholder="例如：艺术与审美" required maxlength="120" /></div>
      <div><h3>这门课程的运行配置</h3><p class="muted small">新课程继承默认配置；在这里修改不会影响其他课程。</p></div><CourseOptionsForm v-model="draft.options" :kind="parsed?.kind" :disabled="busy" />
      <p v-if="parsed?.kind === 'map'" class="muted small">图谱课提供学习、学习并转录两种方式。</p>
      <footer><button type="button" :disabled="busy" @click="closeForm">取消</button><button class="primary" type="submit" :disabled="busy || !parsed || !draft.name.trim()">{{ busy ? '正在保存…' : '保存课程' }}</button></footer>
    </form></div></Teleport>
  </div>
</template>
<style scoped>
.courses-page { display: flex; flex-direction: column; overflow: hidden; }
.course-layout { display: grid; grid-template-columns: 280px minmax(0,1fr); flex: 1; min-height: 0; border: 1px solid var(--line); border-radius: var(--r-panel); background: var(--surface); overflow: hidden; }
.course-list { min-width: 0; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); }
.list-header { padding: 8px; display: grid; gap: 8px; border-bottom: 1px solid var(--line); }
.course-rows { overflow: auto; min-height: 0; flex: 1; }
.course-row { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line-soft); border-radius: 0; height: 48px; padding: 5px 10px; font-weight: 400; }
.course-row.active { background: var(--sky-dim); box-shadow: inset 2px 0 var(--sky); }
.course-row-content { min-width: 0; flex: 1; }
.course-row-content strong { font-weight: 600; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.course-row-content div { font-size: var(--fs-micro); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.selected-dot { width: 6px; height: 6px; background: var(--sky); border-radius: 50%; flex-shrink: 0; }
.course-detail { padding: 12px; overflow: auto; min-width: 0; }
.detail-top,.address-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.course-name { font-size: var(--fs-title); margin: 8px 0 4px; overflow-wrap: anywhere; }
.course-detail>.notice { margin-top: 8px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin: 8px 0; }
.detail-grid>div { display: flex; gap: 8px; flex-wrap: wrap; }
dt { color: var(--text-3); } dd { margin: 0; font-weight: 550; }
.last-position { padding-top: 8px; overflow-wrap: anywhere; }
.last-position p { margin-top: 4px; }
.course-url { color: var(--text-3); overflow-wrap: anywhere; user-select: text; }
.detail-footer { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; position: sticky; bottom: -12px; background: var(--surface); padding: 8px 0; border-top: 1px solid var(--line-soft); }
.error-text { color: var(--clay); }
.modal header,.modal footer { margin: 0; }
.modal .notice { margin: 0; }
@container(max-width:623px) { .course-layout { grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(120px,180px) minmax(0,1fr); } .course-list { border-right: 0; border-bottom: 1px solid var(--line); } .detail-grid { grid-template-columns: 1fr; } }
</style>
