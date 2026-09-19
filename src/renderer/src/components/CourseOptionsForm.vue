<script setup lang="ts">
import { useId } from 'vue'
import type { CourseRunOptions } from '@shared/types'
const options = defineModel<CourseRunOptions>({ required: true })
defineProps<{ kind?: string; disabled?: boolean }>()
const uid = useId()
</script>
<template>
  <fieldset class="options-grid" :disabled="disabled">
    <div class="field"><label :for="`${uid}-action`">运行方式</label>
      <select :id="`${uid}-action`" v-model="options.action"><option value="learn">学习</option><option v-if="kind !== 'mastery'" value="learn-transcribe">学习并转录</option><option v-if="kind === 'classic' || !kind" value="transcribe">仅转录</option></select>
    </div>
    <div class="field"><label :for="`${uid}-start`">起始位置</label>
      <select :id="`${uid}-start`" v-model="options.startPosition"><option value="beginning">从课程开头</option><option value="resume">从上次位置继续</option></select>
    </div>
    <div class="field"><label :for="`${uid}-limit`">单次时长</label>
      <select :id="`${uid}-limit`" :value="options.timeLimitMinutes === 0 ? 'unlimited' : 'limited'" @change="options.timeLimitMinutes = ($event.target as HTMLSelectElement).value === 'unlimited' ? 0 : 60"><option value="unlimited">不限时长</option><option value="limited">指定分钟数</option></select>
    </div>
    <div v-if="options.timeLimitMinutes > 0" class="field"><label :for="`${uid}-minutes`">分钟数</label><input :id="`${uid}-minutes`" v-model.number="options.timeLimitMinutes" type="number" min="1" step="1" required /></div>
    <label class="check-row"><input v-model="options.skipCompleted" type="checkbox" /> 跳过已完成的内容</label>
  </fieldset>
</template>
