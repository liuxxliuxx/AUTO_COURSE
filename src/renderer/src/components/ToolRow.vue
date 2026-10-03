<script setup lang="ts">
defineProps<{ selected?: boolean; title?: string }>()
function navigate(event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
  const button = event.currentTarget as HTMLButtonElement
  const rows = Array.from(button.parentElement?.querySelectorAll<HTMLButtonElement>('button.tool-row:not(:disabled)') ?? [])
  const index = rows.indexOf(button)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
  event.preventDefault()
  rows[next]?.focus()
  rows[next]?.click()
}
</script>
<template>
  <button class="tool-row" :class="{ selected }" :aria-pressed="selected" :title="title" @keydown="navigate"><slot /></button>
</template>
<style scoped>
.tool-row { width: calc(100% - 16px); margin: 2px 8px; min-height: var(--list-row-height); text-align: left; border: 1px solid transparent; border-radius: var(--r-control); padding: 4px 10px; display: flex; align-items: center; gap: 10px; overflow: hidden; background: transparent; }
.tool-row:hover:not(:disabled) { background: var(--surface-2); border-color: transparent; }
.tool-row.selected,.tool-row.selected:hover:not(:disabled) { background: var(--selection); border-color: transparent; color: var(--text); }
.tool-row :deep(strong) { display: block; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-row :deep(small) { display: block; margin-top: 2px; color: var(--text-3); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tool-row :deep(.row-text) { min-width: 0; flex: 1; }
</style>
