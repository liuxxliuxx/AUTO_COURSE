<script setup lang="ts">
/**
 * 日志面板。
 *
 * 默认跟随最新一条；用户往上翻时自动暂停跟随，并给出「回到最新」入口，
 * 而不是强行把视图拽回底部。
 */
import { nextTick, onMounted, ref, watch } from 'vue'
import { formatClock } from '../lib/format'
import type { LogEntry, LogLevel } from '@shared/types'

const props = defineProps<{ logs: LogEntry[] }>()

const scroller = ref<HTMLElement | null>(null)
const following = ref(true)

const LEVEL_VAR: Record<LogLevel, string> = {
  debug: 'var(--text-3)',
  info: 'var(--text-2)',
  warning: 'var(--brass)',
  error: 'var(--clay)'
}

function scrollToBottom(): void {
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  following.value = distance < 24
}

function resume(): void {
  following.value = true
  void nextTick(scrollToBottom)
}

watch(
  () => props.logs.length,
  () => {
    if (following.value) void nextTick(scrollToBottom)
  }
)

onMounted(() => void nextTick(scrollToBottom))
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2 class="panel-title">运行日志</h2>
      <button v-if="!following" type="button" class="resume" @click="resume">回到最新</button>
    </header>

    <div ref="scroller" class="scroller" @scroll="onScroll">
      <p v-if="logs.length === 0" class="empty">
        还没有日志。点击「开始刷课」后，这里会实时显示运行过程。
      </p>
      <ol v-else class="lines">
        <li v-for="(entry, i) in logs" :key="i" class="line">
          <span class="time num">{{ formatClock(entry.time) }}</span>
          <span class="msg" :style="{ color: LEVEL_VAR[entry.level] }">{{ entry.message }}</span>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-4) var(--sp-2);
  flex: none;
}

.panel-title {
  font-size: var(--fs-small);
  color: var(--text-3);
}

.resume {
  font-size: var(--fs-micro);
  color: var(--sky);
  border-bottom: 1px solid transparent;
}

.resume:hover {
  border-bottom-color: var(--sky);
}

.scroller {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--sp-4) var(--sp-4);
  user-select: text;
}

.empty {
  color: var(--text-3);
  font-size: var(--fs-small);
  padding: var(--sp-3) 0;
  max-width: 52ch;
}

.lines {
  list-style: none;
  margin: 0;
  padding: 0;
}

.line {
  display: flex;
  gap: var(--sp-3);
  padding: 2px 0;
  font-size: var(--fs-small);
  line-height: 1.5;
}

.time {
  flex: none;
  color: var(--text-3);
  font-size: var(--fs-micro);
  padding-top: 1px;
}

.msg {
  min-width: 0;
  word-break: break-word;
}
</style>
