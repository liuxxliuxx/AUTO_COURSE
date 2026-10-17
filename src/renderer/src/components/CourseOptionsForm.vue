<script setup lang="ts">
import { ACTION_LABELS } from '@shared/courses'
import { START_LABELS, COMPLETED_LABELS } from '../lib/ui-copy'
import { computed, ref, useId, watch } from 'vue'
import ChoiceButtons from './ChoiceButtons.vue'
import type { CourseRunOptions } from '@shared/types'
const options = defineModel<CourseRunOptions>({ required: true })
const props = defineProps<{ kind?: string; disabled?: boolean }>()
const uid = useId()
const rememberedMinutes = ref(options.value.timeLimitMinutes > 0 ? options.value.timeLimitMinutes : 60)
watch(() => options.value.timeLimitMinutes, value => { if (value > 0) rememberedMinutes.value = value })
const limit = computed({ get:()=>options.value.timeLimitMinutes===0 ? 'unlimited' : 'limited', set:(value:string)=>{ options.value.timeLimitMinutes=value==='unlimited' ? 0 : rememberedMinutes.value } })
const actions = computed(()=>[{value:'learn' as const,label:ACTION_LABELS.learn,hint:'只学习课程内容'}, ...(props.kind !== 'mastery' ? [{value:'learn-transcribe' as const,label:ACTION_LABELS['learn-transcribe'],hint:'学习的同时生成转录文件'}] : []), ...(props.kind==='classic'||!props.kind ? [{value:'transcribe' as const,label:ACTION_LABELS.transcribe,hint:'转录课程内容，不累计学习时长'}] : [])])
const form = ref<HTMLFieldSetElement | null>(null)
function focusInvalid(): void {
  const value = options.value
  let field = 'action'
  if (!['learn', 'learn-transcribe', 'transcribe'].includes(value.action)) field = 'action'
  else if (!['beginning', 'resume'].includes(value.startPosition)) field = 'start'
  else if (typeof value.skipCompleted !== 'boolean') field = 'skip'
  else if (!Number.isFinite(value.timeLimitMinutes) || value.timeLimitMinutes < 0 || !Number.isInteger(value.timeLimitMinutes)) field = 'minutes'
  else if ((props.kind === 'mastery' && value.action !== 'learn')
    || (props.kind === 'map' && value.action === 'transcribe')) field = 'action'
  form.value?.querySelector<HTMLElement>(`[id="${uid}-${field}"]`)?.focus()
}
defineExpose({ focusInvalid })
</script>
<template>
  <fieldset ref="form" class="options-grid" :disabled="disabled">
    <div class="field"><label :for="`${uid}-action`">运行方式</label>
      <ChoiceButtons :id="`${uid}-action`" v-model="options.action" label="运行方式" :choices="actions" :disabled="disabled" />
    </div>
    <div class="field"><label :for="`${uid}-start`">起始位置</label>
      <ChoiceButtons :id="`${uid}-start`" v-model="options.startPosition" label="起始位置" :choices="[{value:'beginning',label:START_LABELS.beginning},{value:'resume',label:START_LABELS.resume}]" :disabled="disabled" />
    </div>
    <div class="field"><label :for="`${uid}-limit`">单次时长</label>
      <ChoiceButtons :id="`${uid}-limit`" v-model="limit" label="单次时长" :choices="[{value:'unlimited',label:'不限时长'},{value:'limited',label:'指定分钟'}]" :disabled="disabled" />
    </div>
    <div v-if="options.timeLimitMinutes !== 0" class="field"><label :for="`${uid}-minutes`">分钟数</label><input :id="`${uid}-minutes`" v-model.number="options.timeLimitMinutes" type="number" min="1" step="1" required /></div>
    <label class="check-row"><input :id="`${uid}-skip`" v-model="options.skipCompleted" type="checkbox" /> {{ COMPLETED_LABELS.skip }}</label>
  </fieldset>
</template>
