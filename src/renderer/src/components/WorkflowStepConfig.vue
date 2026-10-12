<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Account, AccountCourseProgress } from '@shared/accounts'
import type { Course } from '@shared/types'
import type { WorkflowStep } from '@shared/workflows'
import { unavailableCourse } from '../lib/workflow-editor'
import CourseOptionsForm from './CourseOptionsForm.vue'

const props=defineProps<{ accounts: Account[]; step?: WorkflowStep; course?: Course; disabled: boolean; position:number }>()
const progress = ref<AccountCourseProgress | null>(null), progressError = ref('')
let progressRequest = 0
watch(() => [props.step?.accountId, props.step?.courseId], async () => {
  const request = ++progressRequest
  progress.value = null; progressError.value = ''
  if (!props.step?.accountId) return
  try {
    const records = await window.appApi.accounts.progress(props.step.courseId)
    if (request === progressRequest) progress.value = records.find(p=>p.accountId===props.step?.accountId)??null
  } catch(e) { if (request === progressRequest) progressError.value = String(e) }
}, {immediate:true})
const customized=computed(()=>!!props.step && !!props.course && JSON.stringify(props.step.options)!==JSON.stringify(props.course.options))
const emit = defineEmits<{ restore: [] }>()
const panel = ref<HTMLElement | null>(null)
const form = ref<InstanceType<typeof CourseOptionsForm> | null>(null)
defineExpose({
  focusInvalid: () => { if (props.step && !props.accounts.some(a=>a.id===props.step!.accountId)) panel.value?.querySelector<HTMLSelectElement>('select')?.focus(); else form.value?.focusInvalid() },
  scrollToConfig: () => panel.value?.scrollIntoView({ block:'nearest' })
})
</script>

<template>
  <section ref="panel" class="step-config" aria-label="步骤配置">
    <header><strong>第 {{position}} 步配置 <span v-if="step" class="muted small">{{customized?'已自定义':'与课程配置一致'}}</span></strong><small v-if="step">{{ course?.name ?? '课程已不可用' }}</small></header>
    <div v-if="step" class="config-content">
      <div class="field"><label :for="`step-account-${step.id}`">执行账号</label><select :id="`step-account-${step.id}`" v-model="step.accountId" :disabled="disabled" required><option value="" disabled>请选择账号</option><option v-for="account in accounts" :key="account.id" :value="account.id">{{account.name}}（{{account.username}}）</option></select><small v-if="!accounts.length">请先在<RouterLink to="/accounts">账号页</RouterLink>添加账号。</small></div>
      <p v-if="progressError" class="notice error">进度加载失败：{{progressError}}</p><p v-else class="muted small">此账号上次完成的位置：{{progress?.lastVideoTitle || '暂无记录'}}</p>
      <div v-if="unavailableCourse(course)" class="notice error">{{ unavailableCourse(course) }}，请移除此步骤。</div>
      <CourseOptionsForm :key="step.id" ref="form" v-model="step.options" :kind="course?.kind" :disabled="disabled || !!unavailableCourse(course)" />
      <button type="button" :disabled="disabled || !!unavailableCourse(course) || !customized" title="将课程目前保存的配置复制到当前步骤，保存前可撤销" @click="emit('restore')">恢复课程配置</button>
      <small>只影响当前步骤；编辑运行中的工作流，对下一次运行生效。</small>
    </div>
    <p v-else class="empty">选择步骤查看配置</p>
  </section>
</template>

<style scoped>
.step-config { min-width:0;min-height:0;display:flex;flex-direction:column; }
header { padding:12px 16px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px;overflow-wrap:anywhere; }
header small { color:var(--text-3); }
.config-content { overflow:auto;min-height:0;padding:16px;display:flex;flex-direction:column;gap:16px; }
.config-content>small { color:var(--text-3); }
.config-content :deep(.options-grid) { grid-template-columns:1fr; }
@container(max-width:600px) {
  .step-config { min-height:300px;background:var(--list-surface); }
  header { padding:8px 12px; }
  .config-content { padding:12px;overflow:visible; }
  .config-content :deep(.field) { display:grid;grid-template-columns:90px minmax(0,1fr);align-items:center;gap:8px; }
  .config-content :deep(.options-grid) { gap:10px; }
}
</style>
