<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed, useId } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useAccountStore } from '../stores/account'
import { useCoursesStore } from '../stores/courses'
import { useSchedulerStore } from '../stores/scheduler'
import CourseOptionsForm from '../components/CourseOptionsForm.vue'
import type { CourseRunOptions, LoginMethod, SchedulerConfig } from '@shared/types'
const settings = useSettingsStore(), account = useAccountStore(), courses = useCoursesStore(), scheduler = useSchedulerStore()
const uid = useId()
type Section = 'account' | 'defaults' | 'transcription' | 'schedule' | 'appearance'
const sections: Array<{ id: Section; label: string; description: string }> = [
  { id: 'account', label: '账号与登录', description: '管理登录账号和认证方式' },
  { id: 'defaults', label: '课程默认配置', description: '仅用于之后添加的新课程' },
  { id: 'transcription', label: '转录', description: '设置转录文件的保存位置' },
  { id: 'schedule', label: '自动调度', description: '在允许时段运行指定课程' },
  { id: 'appearance', label: '外观', description: '调整适合自己的界面大小' }
]
const section = ref<Section>('account'), loading = ref(true), saving = ref(false), error = ref(''), success = ref('')
const username = ref(''), password = ref('')
const globalDraft = ref({ loginMethod: 'zhihuishu' as LoginMethod, loggedUrl: '', transcribeBaseDir: '', uiScale: 1 })
const defaults = ref<CourseRunOptions>({ ...courses.library.defaults })
const schedule = ref<SchedulerConfig>({ enabled: false, courseId: null, startTime: '06:00', endTime: '23:00', allDay: false, dailyLimitMinutes: 0 })
const baseline = ref('')
function serialize(): string { return JSON.stringify({ username: username.value, password: password.value, global: globalDraft.value, defaults: defaults.value, schedule: schedule.value }) }
const dirty = computed(() => !loading.value && serialize() !== baseline.value)
function mayLeave(): boolean { return !dirty.value || window.confirm('有未保存的设置，确定放弃修改吗？') }
onBeforeRouteLeave(() => mayLeave())
function beforeUnload(e: BeforeUnloadEvent): void { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
async function load(): Promise<void> {
  loading.value = true; error.value = ''
  try {
    await Promise.all([settings.load(), account.load(), scheduler.load(), courses.load()])
    if (!settings.settings) throw new Error(settings.error || '设置加载失败')
    const s = settings.settings
    globalDraft.value = { loginMethod: s.loginMethod, loggedUrl: s.loggedUrl, transcribeBaseDir: s.transcribeBaseDir, uiScale: s.uiScale }
    username.value = account.username; password.value = ''; defaults.value = { ...courses.library.defaults }
    if (scheduler.status) schedule.value = { ...scheduler.status.config }
    baseline.value = serialize()
  } catch(e) { error.value = String(e) }
  finally { loading.value = false }
}
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
async function changeSection(id: Section): Promise<void> { if (id === section.value || !mayLeave()) return; if (dirty.value) await load(); section.value = id; error.value = ''; success.value = '' }
async function save(): Promise<void> {
  saving.value = true; error.value = ''; success.value = ''
  try {
    switch(section.value) {
      case 'account':
        if (!username.value.trim()) throw new Error('请输入账号')
        if (!password.value && !account.state.hasPassword) throw new Error('请输入密码')
        if (globalDraft.value.loginMethod === 'upc' && !globalDraft.value.loggedUrl.trim()) throw new Error('旧门户登录需要填写登录跳转 URL')
        await account.save({ username: username.value.trim(), ...(password.value ? { password: password.value } : {}) })
        await settings.save({ loginMethod: globalDraft.value.loginMethod, loggedUrl: globalDraft.value.loggedUrl })
        password.value = ''; break
      case 'defaults': {
        const result = courses.accept(await window.appApi.courses.defaults({ ...defaults.value }))
        if (!result.ok) throw new Error(result.message)
        break
      }
      case 'transcription': await settings.save({ transcribeBaseDir: globalDraft.value.transcribeBaseDir }); break
      case 'appearance': await settings.save({ uiScale: globalDraft.value.uiScale }); break
      case 'schedule': await scheduler.save({ ...schedule.value }); break
    }
    baseline.value = serialize(); success.value = '设置已保存'
  } catch(e) { error.value = String(e).replace(/^Error: /, '') }
  finally { saving.value = false }
}
async function pickDirectory(): Promise<void> { try { const dir = await window.appApi.dialog.pickDirectory(); if (dir) globalDraft.value.transcribeBaseDir = dir } catch(e) { error.value = String(e) } }
</script>
<template>
  <div class="page">
    <header class="page-header"><div><div class="eyebrow">PREFERENCES</div><h1>设置</h1><p>把常用选项设好，让每次开始更简单。</p></div></header>
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类"><button v-for="item in sections" :key="item.id" :class="{ active: section === item.id }" :aria-current="section === item.id ? 'page' : undefined" @click="changeSection(item.id)">{{ item.label }}</button><RouterLink to="/courses" class="course-link">管理我的课程 ↗</RouterLink></nav>
      <section class="panel settings-panel">
        <div v-if="loading" class="empty" role="status">正在加载设置…</div>
        <form v-else class="stack" @submit.prevent="save">
          <header><h2>{{ sections.find(s => s.id === section)?.label }}</h2><p class="muted">{{ sections.find(s => s.id === section)?.description }}</p></header>
          <div v-if="error" class="notice error" role="alert">{{ error }}</div><div v-if="success" class="notice success" role="status">{{ success }}</div>
          <template v-if="section === 'account'">
            <div v-if="!account.state.encryptionAvailable" class="notice warning">系统加密不可用，凭据仅在本次会话保留，退出后不会保存。</div>
            <div class="field"><label :for="`${uid}-method`">登录方式</label><select :id="`${uid}-method`" v-model="globalDraft.loginMethod"><option value="zhihuishu">智慧树账号</option><option value="upc-institution">数字石大 · 机构 SSO</option><option value="upc">数字石大 · 旧门户</option></select><small>三种方式独立运行，不会在失败后自动切换。</small></div>
            <div class="field"><label :for="`${uid}-username`">账号</label><input :id="`${uid}-username`" v-model="username" autocomplete="username" required placeholder="手机号或统一认证账号" /></div>
            <div class="field"><label :for="`${uid}-password`">密码<span v-if="account.state.hasPassword" class="saved-password"> 已保存</span></label><input :id="`${uid}-password`" v-model="password" type="password" autocomplete="new-password" :placeholder="account.state.hasPassword ? '留空保留已保存的密码' : '输入密码'" /><small>更换账号时需要重新输入密码。</small></div>
            <div v-if="globalDraft.loginMethod === 'upc'" class="field"><label :for="`${uid}-logged-url`">登录跳转 URL</label><input :id="`${uid}-logged-url`" v-model="globalDraft.loggedUrl" type="url" required placeholder="https://…" /><small>仅旧门户使用：登录后工作台的目标地址。</small></div>
          </template>
          <template v-else-if="section === 'defaults'"><div class="notice">这些配置只会复制给新课程。已有课程请在课程详情中编辑。</div><CourseOptionsForm v-model="defaults" /><p class="muted small">图谱课不支持仅转录，添加图谱课时会改用“学习”。</p></template>
          <template v-else-if="section === 'transcription'"><div class="field"><label :for="`${uid}-dir`">输出目录</label><div class="directory-row"><input :id="`${uid}-dir`" v-model="globalDraft.transcribeBaseDir" placeholder="请选择文件夹" /><button type="button" @click="pickDirectory">选择文件夹</button></div><small>是否转录由每门课程的运行方式决定。</small></div><div class="notice">修改目录对下一次运行生效，不会移动已有文件。</div></template>
          <template v-else-if="section === 'schedule'">
            <div v-if="scheduler.status?.pausedReason" class="notice warning">自动调度已暂停：{{ scheduler.status.pausedReason }}。处理后保存设置即可恢复。</div>
            <label class="check-row"><input v-model="schedule.enabled" type="checkbox" /> 启用自动调度</label>
            <div class="field"><label :for="`${uid}-schedule-course`">调度课程</label><select :id="`${uid}-schedule-course`" v-model="schedule.courseId" :required="schedule.enabled"><option :value="null">选择一门课程</option><option v-for="course in courses.library.courses" :key="course.id" :value="course.id">{{ course.name }}</option></select><small>切换“本次课程”不会改变这里的调度目标。</small></div>
            <label class="check-row"><input v-model="schedule.allDay" type="checkbox" /> 全天允许运行</label>
            <div v-if="!schedule.allDay" class="options-grid"><div class="field"><label :for="`${uid}-start`">开始时间</label><input :id="`${uid}-start`" v-model="schedule.startTime" type="time" required /></div><div class="field"><label :for="`${uid}-end`">结束时间</label><input :id="`${uid}-end`" v-model="schedule.endTime" type="time" required /></div></div>
            <div class="field"><label :for="`${uid}-daily`">每日目标（分钟）</label><input :id="`${uid}-daily`" v-model.number="schedule.dailyLimitMinutes" type="number" min="0" step="1" required /><small>0 表示不限；结束早于开始时按跨午夜计算。</small></div>
            <p class="muted small">登录或执行失败后暂停自动重试。手动任务不会被调度时间段抢占。</p>
          </template>
          <template v-else><div class="field"><label :for="`${uid}-scale`">界面缩放</label><select :id="`${uid}-scale`" v-model.number="globalDraft.uiScale"><option :value=".9">90%</option><option :value="1">100%（默认）</option><option :value="1.1">110%</option><option :value="1.2">120%</option><option :value="1.3">130%</option></select></div><div class="theme-preview"><span>浅色</span><div><i></i><i></i><i></i></div><small>清晰、轻盈的桌面工作空间</small></div></template>
          <footer class="settings-footer"><span class="muted small">{{ dirty ? '有未保存的修改' : '修改后点击保存' }}</span><div class="actions"><button type="button" :disabled="saving || !dirty" @click="load">取消修改</button><button type="submit" class="primary" :disabled="saving || (!dirty && !(section === 'schedule' && scheduler.status?.pausedReason))">{{ saving ? '正在保存…' : section === 'schedule' && scheduler.status?.pausedReason ? '保存并恢复调度' : '保存设置' }}</button></div></footer>
        </form>
      </section>
    </div>
  </div>
</template>
<style scoped>
.settings-layout{display:grid;grid-template-columns:165px minmax(0,700px);gap:26px;align-items:start}.settings-nav{display:grid;gap:6px}.settings-nav button{text-align:left;border:0;background:transparent;color:var(--text-2)}.settings-nav button.active{background:#e8eefb;color:var(--sky)}.course-link{padding:16px 13px;margin-top:10px;border-top:1px solid var(--line);font-size:13px}.settings-panel{padding:28px}.settings-panel header p{font-size:13px;margin-top:5px}.settings-panel .notice{margin:0}.settings-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line-soft);padding-top:24px;margin-top:6px;flex-wrap:wrap}.saved-password{font-size:12px;color:var(--jade);font-weight:400}.directory-row{display:flex;gap:8px}.directory-row button{flex-shrink:0}.theme-preview{padding:22px;border:1px solid var(--line);background:#f5f7fb;border-radius:12px;max-width:310px}.theme-preview>span{font-weight:600}.theme-preview>div{display:flex;gap:9px;margin:14px 0}.theme-preview i{width:48px;height:34px;border-radius:7px;background:white;border:1px solid var(--line)}.theme-preview i:last-child{background:var(--sky)}.theme-preview small{color:var(--text-3)}
@media(max-width:850px){.settings-layout{grid-template-columns:1fr}.settings-nav{display:flex;flex-wrap:wrap}.course-link{margin:0;border:0;padding:8px 12px}.settings-panel{padding:20px}}
</style>
