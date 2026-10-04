<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import ChoiceButtons from './ChoiceButtons.vue'
import type { WorkflowSchedule } from '@shared/workflows'

defineProps<{ disabled: boolean }>()
const schedule = defineModel<WorkflowSchedule | null>({ required: true })
const uid = useId()
const timeInput = ref<HTMLInputElement | null>(null)
const zoneInput = ref<HTMLInputElement | null>(null)
const zone=Intl.DateTimeFormat().resolvedOptions().timeZone
const cached=ref<Record<string,WorkflowSchedule>>({})
const triggerPreview=computed(()=>{if(!schedule.value?.time)return '';try{return schedule.value.kind==='daily' ? `每天 ${schedule.value.time}（${schedule.value.timeZone}）` : new Date(schedule.value.time).toLocaleString('zh-CN',{timeZone:schedule.value.timeZone})+`（${schedule.value.timeZone}）`}catch{return ''}})
const kind = computed({
  get: () => schedule.value?.kind ?? 'none',
  set: (value: string) => {
    if(schedule.value)cached.value[schedule.value.kind]={...schedule.value}
    schedule.value = value === 'none' ? null : cached.value[value] ? {...cached.value[value],nextAt:null} : {
      kind: value as 'once' | 'daily', enabled:true,
      timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      time:value === 'daily' ? '09:00' : '', nextAt:null
    }
  }
})
const localTime = computed({
  get: () => {
    if (!schedule.value?.time) return ''
    const date = new Date(schedule.value.time)
    return Number.isNaN(date.getTime()) ? ''
      : new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16)
  },
  set: (value: string) => {
    if (!schedule.value) return
    const date = new Date(value)
    schedule.value.time = Number.isNaN(date.getTime()) ? '' : date.toISOString()
    schedule.value.nextAt = null
  }
})
defineExpose({ focusInvalid: (field: 'time' | 'zone') => (field === 'time' ? timeInput.value : zoneInput.value)?.focus() })
</script>

<template>
  <section class="schedule-config" aria-label="定时配置">
    <div class="field"><label :for="`${uid}-kind`">触发方式</label>
      <ChoiceButtons :id="`${uid}-kind`" v-model="kind" label="触发方式" :disabled="disabled" :choices="[{value:'none',label:'仅手动'},{value:'once',label:'单次定时'},{value:'daily',label:'每日定时'}]" />
    </div>
    <template v-if="schedule">
      <label class="check-row"><input v-model="schedule.enabled" :disabled="disabled" type="checkbox" @change="schedule.nextAt=null" />启用定时</label>
      <div class="field"><label :for="`${uid}-time`">{{ kind === 'daily' ? '每日开始时间' : '运行日期时间（本地）' }}</label>
        <input v-if="kind === 'daily'" :id="`${uid}-time`" ref="timeInput" v-model="schedule.time" :disabled="disabled" type="time" @input="schedule.nextAt=null" />
        <input v-else :id="`${uid}-time`" ref="timeInput" v-model="localTime" :disabled="disabled" type="datetime-local" />
      </div>
      <div class="field"><label :for="`${uid}-zone`">{{kind==='daily'?'时区':'显示时区'}}</label><input :id="`${uid}-zone`" ref="zoneInput" v-model="schedule.timeZone" :disabled="disabled" :list="`${uid}-zones`" title="使用地区/城市格式，例如 Asia/Shanghai" @input="schedule.nextAt=null" /></div>
    </template>
    <datalist :id="`${uid}-zones`"><option v-for="item in [...new Set([zone,'Asia/Shanghai','Asia/Tokyo','Europe/London','America/New_York','UTC'])]" :key="item" :value="item" /></datalist>
    <small v-if="schedule">{{kind==='once' ? '日期输入按电脑时区 '+zone+' 解释；修改显示时区不会移动触发时刻。' : ''}}<span v-if="triggerPreview">{{schedule.enabled?'预定触发：':'规则已停用：'}}{{triggerPreview}}</span></small>
    <small>应用运行时检查定时；错过后补跑最近一次；课程冲突则拒绝本次启动。</small>
  </section>
</template>

<style scoped>
.schedule-config { display:flex;gap:8px;align-items:end;padding:12px 16px;flex-wrap:wrap;max-height:32%;overflow:auto;flex-shrink:0;border-bottom:1px solid var(--line); }
.field { flex:1;min-width:140px; }
small { width:100%;color:var(--text-3); }
</style>
