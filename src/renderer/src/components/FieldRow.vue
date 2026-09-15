<script setup lang="ts">
/**
 * 设置项行：左标签 + 说明，右控件。
 * 用细线分隔而不是卡片 —— 整个 Settings 页面没有任何卡片容器。
 */
defineProps<{
  label: string
  hint?: string
  /** 控件过宽（如路径输入）时切换为上下堆叠 */
  stacked?: boolean
}>()
</script>

<template>
  <div class="field" :class="{ stacked }">
    <div class="field-text">
      <div class="field-label">{{ label }}</div>
      <div v-if="hint" class="field-hint">{{ hint }}</div>
    </div>
    <div class="field-control">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
  padding: var(--sp-3) 0;
  border-bottom: 1px solid var(--line-soft);
}

.field:last-child {
  border-bottom: 0;
}

.field.stacked {
  flex-direction: column;
  align-items: stretch;
  gap: var(--sp-2);
}

.field-text {
  min-width: 0;
}

.field-label {
  font-size: var(--fs-base);
  color: var(--text);
}

.field-hint {
  margin-top: 2px;
  font-size: var(--fs-small);
  color: var(--text-3);
  max-width: 46ch;
}

.field-control {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.field.stacked .field-control {
  flex: 1 1 auto;
}
</style>
