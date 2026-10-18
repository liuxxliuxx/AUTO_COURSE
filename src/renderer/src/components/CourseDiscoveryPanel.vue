<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAccountStore } from '../stores/account'
import { useCoursesStore } from '../stores/courses'
import { currentCourseTerm } from '@shared/course-discovery'
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const accounts = useAccountStore(), courses = useCoursesStore()
const accountId = ref(''), error = ref(''), actionBusy = ref(false)
const active = computed(() => courses.discoveryActive)
watch(() => accounts.accounts, list => {
  if (!list.some(a => a.id === accountId.value)) accountId.value = list[0]?.id ?? ''
}, { immediate: true })
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
async function poll(): Promise<void> {
  try { await courses.refreshDiscovery() } catch (e) { if (!disposed) error.value = `读取获取状态失败：${String(e)}` }
  if (!disposed) timer = setTimeout(() => void poll(), 1000)
}
onMounted(() => { void poll() })
onBeforeUnmount(() => { disposed = true; clearTimeout(timer) })
async function start(): Promise<void> {
  error.value = ''
  try { await courses.discover(accountId.value) } catch (e) { error.value = String(e).replace(/^Error: /, '') }
}
async function control(action: 'confirm' | 'cancel' | 'window'): Promise<void> {
  actionBusy.value = true; error.value = ''
  try {
    if (action === 'confirm') await window.appApi.courses.discoveryConfirm()
    if (action === 'cancel') await window.appApi.courses.discoveryCancel()
    if (action === 'window') await window.appApi.courses.discoveryWindow()
    await courses.refreshDiscovery()
  } catch (e) { error.value = String(e).replace(/^Error: /, '') }
  finally { actionBusy.value = false }
}
</script>
<template>
  <section v-if="open || active" class="discovery-panel stack" aria-label="自动获取可学课程">
    <div class="discovery-heading"><strong>自动获取可学课程</strong><button v-if="!active" class="quiet" @click="emit('close')">收起</button></div>
    <p class="muted small">获取{{ currentCourseTerm() }}的未完成共享课和图谱课。自动登录所选账号，已添加的课程会跳过。</p>
    <div class="discovery-actions">
      <label for="discovery-account">登录账号</label>
      <select id="discovery-account" v-model="accountId" :disabled="active"><option v-for="account in accounts.accounts" :key="account.id" :value="account.id">{{ account.name }}</option></select>
      <button class="primary" :disabled="!accountId || active || actionBusy" @click="start">{{ active ? '正在获取…' : '开始获取' }}</button>
      <template v-if="active">
        <button :disabled="actionBusy || courses.discovery.phase === 'stopping'" @click="control('window')">打开登录 / 课程窗口</button>
        <button v-if="courses.discovery.phase === 'waiting'" :disabled="actionBusy" @click="control('confirm')">已完成验证，继续</button>
        <button :disabled="actionBusy || courses.discovery.phase === 'stopping'" @click="control('cancel')">取消获取</button>
      </template>
    </div>
    <p v-if="!accounts.accounts.length" class="small">请先在<RouterLink to="/accounts">账号管理</RouterLink>添加账号。</p>
    <p v-if="courses.discovery.message" :role="courses.discovery.phase === 'failed' ? 'alert' : 'status'">{{ courses.discovery.message }}</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <details v-if="courses.discovery.warnings.length"><summary>查看 {{ courses.discovery.warnings.length }} 门未导入课程的原因</summary><ul><li v-for="(warning, i) in courses.discovery.warnings" :key="i">{{ warning }}</li></ul></details>
  </section>
</template>
<style scoped>
.discovery-panel { margin:12px 20px;padding:14px;border:1px solid var(--line);border-radius:8px;flex-shrink:0;max-height:45%;overflow:auto;gap:10px; }
.discovery-heading,.discovery-actions { display:flex;align-items:center;gap:8px;flex-wrap:wrap; }
.discovery-heading { justify-content:space-between; }
select { width:220px;min-width:150px;max-width:100%; }
li { overflow-wrap:anywhere; }
</style>
