<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed, useId } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useAccountStore } from '../stores/account'
import { useCoursesStore } from '../stores/courses'
import { ACCENT_COLORS, DEFAULT_ACCENT, accentHue } from '@shared/appearance'
import CourseOptionsForm from '../components/CourseOptionsForm.vue'
import type { CourseRunOptions, LoginMethod } from '@shared/types'
const settings = useSettingsStore(), account = useAccountStore(), courses = useCoursesStore()
const uid = useId()
type Section = 'account' | 'defaults' | 'transcription' | 'appearance'
const sections: Array<{ id: Section; label: string; description: string }> = [
  { id: 'account', label: '账号与登录', description: '管理登录账号和认证方式' },
  { id: 'defaults', label: '课程默认配置', description: '仅用于之后添加的新课程' },
  { id: 'transcription', label: '转录', description: '设置转录文件的保存位置' },
  { id: 'appearance', label: '外观', description: '调整适合自己的界面大小' }
]
const section = ref<Section>('account'), loading = ref(true), saving = ref(false), error = ref(''), success = ref('')
const username = ref(''), password = ref('')
const globalDraft = ref({ loginMethod: 'zhihuishu' as LoginMethod, loggedUrl: '', transcribeBaseDir: '', uiScale: 1, accentColor: DEFAULT_ACCENT })
const defaults = ref<CourseRunOptions>({ ...courses.library.defaults })
const baseline = ref('')
function serialize(): string { return JSON.stringify({ username: username.value, password: password.value, global: globalDraft.value, defaults: defaults.value }) }
const dirty = computed(() => !loading.value && serialize() !== baseline.value)
function mayLeave(): boolean { return !dirty.value || window.confirm('有未保存的设置，确定放弃修改吗？') }
onBeforeRouteLeave(() => mayLeave())
function beforeUnload(e: BeforeUnloadEvent): void { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
async function load(): Promise<void> {
  loading.value = true; error.value = ''
  try {
    await Promise.all([settings.load(), account.load(), courses.load()])
    if (!settings.settings) throw new Error(settings.error || '设置加载失败')
    const s = settings.settings
    globalDraft.value = { loginMethod: s.loginMethod, loggedUrl: s.loggedUrl, transcribeBaseDir: s.transcribeBaseDir, uiScale: s.uiScale, accentColor: s.accentColor }
    username.value = account.username; password.value = ''; defaults.value = { ...courses.library.defaults }
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
      case 'appearance': await settings.save({ uiScale: globalDraft.value.uiScale, accentColor: globalDraft.value.accentColor }); break
    }
    baseline.value = serialize(); success.value = '设置已保存'
  } catch(e) { error.value = String(e).replace(/^Error: /, '') }
  finally { saving.value = false }
}
async function pickDirectory(): Promise<void> { try { const dir = await window.appApi.dialog.pickDirectory(); if (dir) globalDraft.value.transcribeBaseDir = dir } catch(e) { error.value = String(e) } }
</script>
<template>
  <div class="page">
    <header class="page-header"><h1>设置</h1></header>
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类"><button v-for="item in sections" :key="item.id" :class="{ active: section === item.id }" :aria-current="section === item.id ? 'page' : undefined" @click="changeSection(item.id)">{{ item.label }}</button><RouterLink to="/courses" class="course-link">管理我的课程</RouterLink></nav>
      <section class="settings-panel">
        <div v-if="loading" class="empty" role="status">正在加载设置…</div>
        <form v-else class="stack" @submit.prevent="save">
          <header><h2>{{ sections.find(s => s.id === section)?.label }}</h2></header>
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
          <template v-else><div class="field"><label :for="`${uid}-scale`">界面缩放</label><select :id="`${uid}-scale`" v-model.number="globalDraft.uiScale"><option :value=".9">90%</option><option :value="1">100%（默认）</option><option :value="1.1">110%</option><option :value="1.2">120%</option><option :value="1.3">130%</option></select></div><fieldset class="accent-options" :disabled="saving"><legend>强调色</legend>
            <div class="accent-swatches"><label v-for="color in ACCENT_COLORS" :key="color.id" class="accent-option" :class="{ selected: globalDraft.accentColor === color.id }" :style="{ '--swatch-hue': color.hue }">
              <input v-model="globalDraft.accentColor" type="radio" :name="`${uid}-accent`" :value="color.id" /><span class="swatch" aria-hidden="true"></span><span>{{ color.label }}</span>
            </label></div><p class="muted small">保存后应用到整个界面，重启后保留。</p>
            <div class="accent-preview" :style="{ '--preview-hue': accentHue(globalDraft.accentColor) }" aria-label="强调色预览"><span class="preview-selection">选中项</span><span class="preview-action">主要操作</span><span class="preview-link">链接文字</span></div>
          </fieldset><div class="theme-row"><span>主题</span><span>浅色</span></div></template>
          <footer class="settings-footer"><span class="muted small">{{ dirty ? '有未保存的修改' : '修改后点击保存' }}</span><div class="actions"><button type="button" :disabled="saving || !dirty" @click="load">取消修改</button><button type="submit" class="primary" :disabled="saving || !dirty">{{ saving ? '正在保存…' : '保存设置' }}</button></div></footer>
        </form>
      </section>
    </div>
  </div>
</template>
<style scoped>
.settings-layout { display: grid; grid-template-columns: 120px minmax(0,700px); gap: 20px; align-items: start; padding: 16px; }
.settings-nav { display: grid; gap: 4px; }
.settings-nav button { text-align: left; border: 0; background: transparent; color: var(--text-2); }
.settings-nav button.active { background: var(--selection); color: var(--accent); font-weight: 650; box-shadow: inset 2px 0 var(--accent); }
.course-link { padding: 8px; margin-top: 4px; border-top: 1px solid var(--line); }
.settings-panel { min-width: 0; padding: 0 0 0 20px; border-left: 1px solid var(--line); }
.settings-panel header { padding: 4px 0 12px; border-bottom: 1px solid var(--line); }
.settings-panel .notice { margin: 0; }
.settings-panel :deep(.field) { display: grid; grid-template-columns: 100px minmax(0,1fr); align-items: start; gap: 4px 8px; }
.settings-panel :deep(.field>label) { padding-top: 4px; font-weight: 400; color: var(--text-2); }
.settings-panel :deep(.field>small) { grid-column: 2; }
.settings-panel :deep(.options-grid) { grid-template-columns: 1fr; }
.settings-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; flex-wrap: wrap; }
.saved-password { font-size: var(--fs-micro); color: var(--jade); font-weight: 400; }
.directory-row { display: flex; gap: 8px; min-width: 0; }
.directory-row button { flex-shrink: 0; }
.accent-options legend { padding: 0; margin-bottom: 8px; color: var(--text-2); }
.accent-swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.accent-option { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--line); cursor: pointer; }
.accent-option.selected { border-color: hsl(var(--swatch-hue) 52% 45%); background: hsl(var(--swatch-hue) 85% 95%); }
.accent-option input[type=radio] { position: absolute; opacity: 0; width: 1px; height: 1px; min-height: 0; padding: 0; }
.accent-option:has(:focus-visible) { outline: 2px solid var(--accent-focus); outline-offset: 2px; }
.swatch { width: 12px; height: 12px; background: hsl(var(--swatch-hue) 68% 66%); }
.accent-option.selected .swatch::after { content: '✓'; display: block; color: #182538; text-align: center; font-size: 10px; line-height: 12px; }
.accent-preview { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 12px; padding: 12px; background: hsl(var(--preview-hue) 65% 98%); color: hsl(var(--preview-hue) 52% 37%); }
.preview-selection { padding: 4px 8px; background: hsl(var(--preview-hue) 85% 95%); border-left: 2px solid currentColor; }
.preview-action { padding: 4px 8px; background: hsl(var(--preview-hue) 82% 89%); border: 1px solid hsl(var(--preview-hue) 58% 76%); }
.theme-row { display: grid; grid-template-columns: 100px 1fr; gap: 8px; }
@container(max-width:600px) { .settings-layout { grid-template-columns: 1fr; } .settings-nav { display: flex; flex-wrap: wrap; gap: 4px; } .course-link { margin: 0; border: 0; padding: 4px 8px; } .settings-panel { border-left: 0; padding: 0; } .settings-panel :deep(.field) { grid-template-columns: 1fr; } .settings-panel :deep(.field>small) { grid-column: 1; } }
</style>
