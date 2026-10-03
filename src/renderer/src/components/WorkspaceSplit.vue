<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
const props = defineProps<{ detailKey?: string }>()
const detail = ref<HTMLElement | null>(null)
watch(() => props.detailKey, async () => {
  await nextTick()
  if (detail.value) detail.value.scrollTop = 0
})
</script>
<template>
  <div class="workspace-split"><aside class="workspace-list"><slot name="list" /></aside><section ref="detail" class="workspace-detail"><slot /></section></div>
</template>
<style scoped>
.workspace-split { display: grid; grid-template-columns: 300px minmax(0,1fr); flex: 1; min-height: 0; overflow: hidden; }
.workspace-list { border-right: 1px solid var(--line); overflow: auto; min-height: 0; min-width: 0; background: var(--list-surface); padding-bottom: 8px; scroll-padding-top:56px; }
.workspace-detail { overflow: auto; min-height: 0; min-width: 0; padding: 20px; }
@container(max-width:700px) { .workspace-split { grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(120px,30%) minmax(0,1fr); } .workspace-list { border-right: 0; border-bottom: 1px solid var(--line); } .workspace-detail { padding: 16px; } }
</style>
