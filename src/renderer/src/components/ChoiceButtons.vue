<script setup lang="ts" generic="T extends string | number">
import { ref } from 'vue'
const props = defineProps<{ label: string; id?: string; disabled?: boolean; choices: { value:T; label:string; hint?:string }[] }>()
const value = defineModel<T>({ required:true })
const group = ref<HTMLElement | null>(null)
function navigate(event: KeyboardEvent, index: number): void {
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key) || props.disabled || event.altKey || event.ctrlKey || event.metaKey) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? props.choices.length-1
    : (index + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1) + props.choices.length) % props.choices.length
  value.value = props.choices[next].value
  group.value?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
}
</script>
<template>
  <div :id="id" ref="group" class="choice-buttons" role="radiogroup" :aria-label="label" tabindex="-1">
    <button v-for="(choice,index) in choices" :key="choice.value" type="button" role="radio" :aria-checked="value===choice.value"
      :disabled="disabled" :tabindex="value===choice.value || (!choices.some(c=>c.value===value) && index===0) ? 0 : -1"
      :title="choice.hint" @click="value=choice.value" @keydown="navigate($event,index)">{{choice.label}}</button>
  </div>
</template>
<style scoped>
.choice-buttons { display:flex;flex-wrap:wrap;gap:4px;min-width:0;align-items:center; }
button { min-height:28px;padding:4px 8px;font-size:12px;font-weight:400; }
button[aria-checked=true] { color:var(--accent);background:var(--selection);border-color:var(--accent); }
</style>
