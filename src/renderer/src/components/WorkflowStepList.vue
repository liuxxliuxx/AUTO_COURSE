<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { Account } from '@shared/accounts'
import type { Course } from '@shared/types'
import type { WorkflowStep } from '@shared/workflows'
import { durationLabel } from '../lib/ui-copy'
import { ACTION_LABELS } from '@shared/courses'
import { unavailableCourse } from '../lib/workflow-editor'

const props = defineProps<{ accounts: Account[]; steps: WorkflowStep[]; courses: Course[]; selected: string; disabled: boolean }>()
const emit = defineEmits<{ select: [id: string]; move: [id: string, index: number]; remove: [id: string] }>()
const dragged = ref('')
const list = ref<HTMLElement | null>(null)
const course = (id: string): Course | undefined => props.courses.find(item => item.id === id)
const name = (step: WorkflowStep): string => course(step.courseId)?.name ?? '课程已不可用'
function revealSelected(): void {
  const row = list.value?.querySelector<HTMLElement>('.editor-step.selected')
  if (!row || !list.value) return
  const bounds = list.value.getBoundingClientRect(), item = row.getBoundingClientRect()
  if (item.bottom > bounds.bottom) list.value.scrollTop += item.bottom - bounds.bottom + 4
  else if (item.top < bounds.top) list.value.scrollTop += item.top - bounds.top - 4
}
function focusSelected():void {list.value?.querySelector<HTMLButtonElement>('.step-select[aria-pressed=true]')?.focus()}
defineExpose({ revealSelected,focusSelected })
async function reorder(id: string, index: number): Promise<void> {
  const focus = document.activeElement as HTMLButtonElement | null
  emit('move', id, index)
  await nextTick()
  if (focus?.isConnected && !focus.disabled) focus.focus()
  else Array.from(list.value?.querySelectorAll<HTMLElement>('[data-step-id]') ?? [])
    .find(row => row.dataset.stepId === id)?.querySelector<HTMLButtonElement>('.step-select')?.focus()
}
async function removeStep(id: string): Promise<void> {
  emit('remove', id)
  await nextTick()
  list.value?.querySelector<HTMLButtonElement>('.step-select[aria-pressed=true]')?.focus()
}
function navigate(event: KeyboardEvent, index: number): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
  const to = event.key === 'Home' ? 0 : event.key === 'End' ? props.steps.length - 1
    : Math.max(0, Math.min(props.steps.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
  event.preventDefault()
  emit('select', props.steps[to].id)
  list.value?.querySelectorAll<HTMLButtonElement>('.step-select')[to]?.focus()
}
</script>

<template>
  <section class="step-list" aria-label="任务步骤">
    <header><strong>执行顺序</strong><small>配置按步骤独立保存，可重复添加课程</small></header>
    <div ref="list" class="step-rows">
      <article v-for="(step, index) in steps" :key="step.id" :data-step-id="step.id" class="editor-step" :class="{ selected:step.id===selected }" :draggable="!disabled"
        @dragstart="dragged=step.id; $event.dataTransfer?.setData('text/plain',step.id)" @dragend="dragged=''" @dragover.prevent @drop.prevent="emit('move',dragged,index)">
        <button type="button" class="step-select" :aria-pressed="step.id===selected" :title="name(step)" @click="emit('select',step.id)" @keydown="navigate($event,index)">
          <span class="step-number">{{ index+1 }}</span>
          <span class="step-text"><strong>{{ name(step) }}</strong><small>{{ accounts.find(a=>a.id===step.accountId)?.name || '未选择账号' }}</small><small>{{ unavailableCourse(course(step.courseId)) || `${ACTION_LABELS[step.options.action]} · ${durationLabel(step.options.timeLimitMinutes)}` }}</small></span>
        </button>
        <div class="step-tools">
          <button type="button" :disabled="disabled||index===0" :title="index===0?'已是第一步':'将此步骤提前，配置随步骤一起移动'" :aria-label="`上移步骤 ${index+1}`" @click="reorder(step.id,index-1)">↑</button>
          <button type="button" :disabled="disabled||index===steps.length-1" :title="index===steps.length-1?'已是最后一步':'将此步骤延后，配置随步骤一起移动'" :aria-label="`下移步骤 ${index+1}`" @click="reorder(step.id,index+1)">↓</button>
          <button type="button" :disabled="disabled" title="只移除此步骤，不删除课程；移除后可撤销" :aria-label="`移除步骤 ${index+1}`" @click="removeStep(step.id)">移除</button>
        </div>
      </article>
      <p v-if="!steps.length" class="empty">从课程库添加第一步</p>
    </div>
  </section>
</template>

<style scoped>
.step-list { min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--line); }
header { padding:12px 16px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px; }
header small { color:var(--text-3); }
.step-rows { overflow:auto;min-height:0; }
.editor-step { margin:4px 8px;border-radius:6px;padding:6px;display:flex;align-items:center;min-height:56px;gap:6px; }
.editor-step.selected { background:var(--selection); }
.step-select { border:0;background:transparent;display:flex;flex:1;min-width:0;text-align:left;align-items:center;gap:4px; }
.step-text { min-width:0; }
.step-text strong { display:block;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.step-text small { display:block;color:var(--text-3); }
.step-number { color:var(--accent);width:22px;flex-shrink:0; }
.step-tools { flex-shrink:0;display:flex;gap:4px; }
.step-tools button { min-height:28px;padding:0 6px;border-color:transparent;background:transparent;color:var(--text-3); }
.step-tools button:hover:not(:disabled) { background:var(--surface);color:var(--text); }
@container(max-width:600px) { .step-list { height:200px;border-right:0;border-bottom:1px solid var(--line); } header { padding:8px 12px; } header small { display:none; } }
</style>
