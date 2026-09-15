<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  disabled?: boolean
  label: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle(): void {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    class="switch"
    :class="{ on: modelValue }"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="knob" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  width: 38px;
  height: 21px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--surface-2);
  transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.switch.on {
  background: var(--jade-dim);
  border-color: var(--jade);
}

.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--text-3);
  transition: transform var(--motion-fast) ease, background var(--motion-fast) ease;
}

.switch.on .knob {
  transform: translateX(17px);
  background: var(--jade);
}
</style>
