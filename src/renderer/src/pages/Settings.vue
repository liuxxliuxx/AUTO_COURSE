<script setup lang="ts">
import WorkspaceToolbar from '../components/WorkspaceToolbar.vue'
import ChoiceButtons from '../components/ChoiceButtons.vue'
import { onBeforeUnmount, onMounted, ref, computed, useId } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useCoursesStore } from '../stores/courses'
import { accentLightness } from '../lib/appearance'
import { ACCENT_COLORS, DEFAULT_ACCENT, accentHue } from '@shared/appearance'
import CourseOptionsForm from '../components/CourseOptionsForm.vue'
import type { CourseRunOptions } from '@shared/types'
const settings = useSettingsStore(), courses = useCoursesStore()
const uid = useId()
type Section = 'defaults' | 'transcription' | 'appearance' | 'cache'
const sections: Array<{ id: Section; label: string; description: string }> = [
  { id: 'defaults', label: '课程默认配置', description: '仅用于之后添加的新课程' },
  { id: 'transcription', label: '转录', description: '设置转录文件的保存位置' },
  { id: 'appearance', label: '外观', description: '调整适合自己的界面大小' },
  { id: 'cache', label: '缓存', description: '清理网页缓存和临时下载文件' }
]
const section = ref<Section>('defaults'), loading = ref(true), loaded=ref(false), saving = ref(false), error = ref(''), success = ref('')
const clearingCache = ref(false)
const globalDraft = ref({ transcribeBaseDir: '', uiScale: 1, accentColor: DEFAULT_ACCENT })
const defaults = ref<CourseRunOptions>({ ...courses.library.defaults })
const baseline = ref<Record<Section,string>>({ defaults:'', transcription:'', appearance:'', cache:'' })
function serialize(id: Section): string {
  if (id==='cache') return ''
  if (id==='defaults') return JSON.stringify(defaults.value)
  if (id==='transcription') return JSON.stringify({transcribeBaseDir:globalDraft.value.transcribeBaseDir})
  return JSON.stringify({uiScale:globalDraft.value.uiScale,accentColor:globalDraft.value.accentColor})
}
const dirtySections = computed(()=>!loaded.value ? [] : sections.filter(item=>serialize(item.id)!==baseline.value[item.id]))
const dirty = computed(()=>dirtySections.value.some(item=>item.id===section.value))
function mayLeave(): boolean { if (clearingCache.value) return false; return !dirtySections.value.length || window.confirm(`“${dirtySections.value.map(item=>item.label).join('、')}”有未保存的设置，确定放弃修改吗？`) }
function cancelSection(): void {
  if (saving.value || !dirty.value) return
  const saved = JSON.parse(baseline.value[section.value])
  if (section.value==='defaults') defaults.value=saved
  else Object.assign(globalDraft.value,saved)
  error.value='';success.value='已取消当前分类的修改'
}
onBeforeRouteLeave(() => mayLeave())
function beforeUnload(e: BeforeUnloadEvent): void { if (dirtySections.value.length) { e.preventDefault(); e.returnValue = '' } }
async function load(): Promise<void> {
  loading.value = true; error.value = ''
  try {
    await Promise.all([settings.load(), courses.load()])
    if(settings.error || courses.error)throw Error(settings.error || courses.error)
    if (!settings.settings) throw new Error(settings.error || '设置加载失败')
    const s = settings.settings
    globalDraft.value = { transcribeBaseDir: s.transcribeBaseDir, uiScale: s.uiScale, accentColor: s.accentColor }
    defaults.value = { ...courses.library.defaults }
    for (const item of sections) baseline.value[item.id] = serialize(item.id)
    loaded.value=true
  } catch(e) { error.value = String(e) }
  finally { loading.value = false }
}
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
function changeSection(id: Section): void { if (saving.value || clearingCache.value || !loaded.value || id===section.value) return; section.value=id;error.value='';success.value='' }
async function save(): Promise<void> {
  if (saving.value || !dirty.value) return
  saving.value = true; error.value = ''; success.value = ''
  try {
    switch(section.value) {
      case 'defaults': {
        const result = courses.accept(await window.appApi.courses.defaults({ ...defaults.value }))
        if (!result.ok) throw new Error(result.message)
        break
      }
      case 'transcription': await settings.save({ transcribeBaseDir: globalDraft.value.transcribeBaseDir }); break
      case 'appearance': await settings.save({ uiScale: globalDraft.value.uiScale, accentColor: globalDraft.value.accentColor }); break
    }
    baseline.value[section.value] = serialize(section.value); success.value = '当前分类设置已保存'
  } catch(e) { error.value = String(e).replace(/^Error: /, '') }
  finally { saving.value = false }
}
async function clearCache(): Promise<void> {
  if (clearingCache.value) return
  clearingCache.value = true; error.value = ''; success.value = ''
  try {
    const { bytes } = await window.appApi.settings.clearCache()
    const amount = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`
    success.value = bytes ? `缓存清理完成，已清理临时文件和课程网页缓存 ${amount}` : '缓存清理完成'
  } catch (e) { error.value = String(e).replace(/^Error: /, '') }
  finally { clearingCache.value = false }
}
async function pickDirectory(): Promise<void> { if (saving.value) return; try { const dir = await window.appApi.dialog.pickDirectory(); if (dir) globalDraft.value.transcribeBaseDir = dir } catch(e) { error.value = String(e) } }
</script>
<template>
  <div class="page">
    <WorkspaceToolbar title="设置"></WorkspaceToolbar>
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类"><button v-for="item in sections" :key="item.id" :aria-label="item.label" :class="{ active: section === item.id }" :disabled="saving || clearingCache || !loaded" :title="dirtySections.some(s=>s.id===item.id) ? item.label+'：有未保存的修改' : item.description" :aria-current="section === item.id ? 'page' : undefined" @click="changeSection(item.id)">{{ item.label }}<span v-if="dirtySections.some(s=>s.id===item.id)" class="dirty-mark" aria-label="未保存">•</span></button><RouterLink to="/accounts" class="course-link">管理账号</RouterLink><RouterLink to="/courses" class="course-link">管理我的课程</RouterLink></nav>
      <section class="settings-panel">
        <div v-if="loading" class="empty" role="status">正在加载设置…</div>
        <div v-else-if="!loaded" class="notice error" role="alert">{{error}} <button @click="load">重新加载</button></div>
        <form v-else class="stack" @submit.prevent="save">
          <header><h2>{{ sections.find(s => s.id === section)?.label }}</h2></header>
          <div v-if="error" class="notice error" role="alert">{{ error }}</div><div v-if="success" class="notice success" role="status">{{ success }}</div>
          <fieldset class="stack" :disabled="saving">
          <template v-if="section === 'defaults'"><div class="notice">这些配置只会复制给新课程。已有课程请在课程详情中编辑。</div><CourseOptionsForm v-model="defaults" /><p class="muted small">图谱课不支持仅转录，添加图谱课时会改用“学习”。</p></template>
          <template v-else-if="section === 'transcription'"><div class="field"><label :for="`${uid}-dir`">输出目录</label><div class="directory-row"><input :id="`${uid}-dir`" v-model="globalDraft.transcribeBaseDir" placeholder="请选择文件夹" /><button type="button" @click="pickDirectory">选择文件夹</button></div><small>是否转录由每门课程的运行方式决定。</small></div><div class="notice">修改目录对下一次运行生效，不会移动已有文件。</div></template>
          <template v-else-if="section === 'cache'">
            <p class="muted">清除课程网页缓存和临时下载文件。下次打开课程时会重新加载网页资源。</p>
            <div class="notice">保留登录状态、账号设置、课程进度、题库、转录文件和已下载的转录模型。</div>
            <p class="muted small">请先停止所有运行中的任务，等待课程窗口关闭后再清理。</p>
            <div><button type="button" :disabled="clearingCache" @click="clearCache">{{ clearingCache ? '正在清理…' : '清理缓存' }}</button></div>
          </template>
          <template v-else><div class="field"><label :for="`${uid}-scale`">界面缩放</label><ChoiceButtons :id="`${uid}-scale`" v-model="globalDraft.uiScale" label="界面缩放" :disabled="saving" :choices="[{value:.9,label:'90%'},{value:1,label:'100%'},{value:1.1,label:'110%'},{value:1.2,label:'120%'},{value:1.3,label:'130%'}]" /></div><fieldset class="accent-options" :disabled="saving"><legend>强调色</legend>
            <div class="accent-swatches"><label v-for="color in ACCENT_COLORS" :key="color.id" class="accent-option" :class="{ selected: globalDraft.accentColor === color.id }" :style="{ '--swatch-hue': color.hue, '--swatch-lightness': `${accentLightness(color.id)}%` }">
              <input v-model="globalDraft.accentColor" type="radio" :name="`${uid}-accent`" :value="color.id" /><span class="swatch" aria-hidden="true"></span><span>{{ color.label }}</span>
            </label></div><p class="muted small">保存后应用到整个界面，重启后保留。</p>
            <div class="accent-preview" :style="{ '--preview-hue': accentHue(globalDraft.accentColor), '--preview-lightness': `${accentLightness(globalDraft.accentColor)}%` }" aria-label="强调色预览"><span class="preview-selection">选中项</span><span class="preview-action">主要操作</span><span class="preview-link">链接文字</span></div>
          </fieldset><div class="theme-row"><span>主题</span><span>浅色</span></div></template>
          </fieldset>
          <footer v-if="section !== 'cache'" class="settings-footer"><span class="muted small">{{ dirty ? '当前分类有未保存的修改' : dirtySections.length ? '其他分类还有未保存的修改' : '所有设置已保存' }}</span><div class="actions"><button type="button" :disabled="saving || !dirty" :title="'只取消'+sections.find(s=>s.id===section)?.label+'的修改'" @click="cancelSection">取消修改</button><button type="submit" class="primary" :disabled="saving || !dirty">{{ saving ? '正在保存…' : '保存当前分类' }}</button></div></footer>
        </form>
      </section>
    </div>
  </div>
</template>
<style scoped>
.settings-layout { display: grid; grid-template-columns: 140px minmax(0,620px); gap: 24px; align-items: start; padding: 24px; }
.settings-nav { display: grid; gap: 6px; }
.dirty-mark { color:var(--accent);margin-left:auto; }
.settings-nav button { display:flex;align-items:center;gap:4px;text-align: left; border: 0; background: transparent; color: var(--text-2); }
.settings-nav button.active { background: var(--selection); color: var(--accent); font-weight: 550;  }
.course-link { padding: 8px; margin-top: 4px; border-top: 1px solid var(--line); }
.settings-panel { min-width: 0; padding: 0 0 0 24px; border-left: 1px solid var(--line); }
.settings-panel header { padding: 0 0 4px; }
.settings-panel .notice { margin: 0; }
.settings-panel :deep(.field) { display: grid; grid-template-columns: 110px minmax(0,1fr); align-items: start; gap: 4px 8px; }
.settings-panel :deep(.field>label) { padding-top: 6px; font-weight: 400; color: var(--text-2); }
.settings-panel :deep(.field>small) { grid-column: 2; }
.settings-panel :deep(.options-grid) { grid-template-columns: 1fr; }
.settings-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--line); padding-top: 16px; flex-wrap: wrap; }
.saved-password { font-size: var(--fs-micro); color: var(--jade); font-weight: 400; }
.directory-row { display: flex; gap: 8px; min-width: 0; }
.directory-row button { flex-shrink: 0; }
.accent-options legend { padding: 0; margin-bottom: 8px; color: var(--text-2); }
.accent-swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.accent-option { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--line); cursor: pointer; }
.accent-option.selected { border-color: hsl(var(--swatch-hue) 58% var(--swatch-lightness)); background: hsl(var(--swatch-hue) 85% 95%); }
.accent-option input[type=radio] { position: absolute; opacity: 0; width: 1px; height: 1px; min-height: 0; padding: 0; }
.accent-option:has(:focus-visible) { outline: 2px solid var(--accent-focus); outline-offset: 2px; }
.swatch { width: 12px; height: 12px; background: hsl(var(--swatch-hue) 68% 66%); }
.accent-option.selected .swatch::after { content: '✓'; display: block; color: #182538; text-align: center; font-size: 10px; line-height: 12px; }
.accent-preview { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 12px; padding: 12px; background: var(--ground); color: hsl(var(--preview-hue) 58% var(--preview-lightness)); }
.preview-selection { padding: 4px 8px; background: hsl(var(--preview-hue) 85% 95%); border-radius:var(--r-control); }
.preview-action { padding: 4px 8px; background: hsl(var(--preview-hue) 58% var(--preview-lightness));color:#fff;border:1px solid transparent;border-radius:var(--r-control); }
.theme-row { display: grid; grid-template-columns: 100px 1fr; gap: 8px; }
@container(max-width:700px) { .settings-layout { grid-template-columns: 1fr;padding:16px;gap:20px; } .settings-nav { display: flex; flex-wrap: wrap; gap: 4px; } .course-link { margin: 0; border: 0; padding: 4px 8px; } .settings-panel { border-left: 0; padding: 0; } .settings-panel :deep(.field) { grid-template-columns: 1fr; } .settings-panel :deep(.field>small) { grid-column: 1; } }
</style>
