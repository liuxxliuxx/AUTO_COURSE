<script setup lang="ts">
/** 顶栏状态条：状态点 + 文案 + 当前课程 + 启动/停止。 */
import { computed } from 'vue'
import { TASK_MODE_LABEL } from '@shared/ipc'
import type { BotStatus, CourseItem } from '@shared/types'

const props = defineProps<{
  status: BotStatus
  course: CourseItem | null
  canStart: boolean
  canStop: boolean
}>()

defineEmits<{ start: []; stop: [] }>()

const toneVar = computed(() => {
  switch (props.status.tone) {
    case 'success':
      return 'var(--jade)'
    case 'warning':
      return 'var(--brass)'
    case 'danger':
      return 'var(--clay)'
    default:
      return 'var(--text-3)'
  }
})

const modeLabel = computed(() =>
  props.status.mode ? TASK_MODE_LABEL[props.status.mode] : null
)
</script>

<template>
  <div class="rail">
    <span class="dot" :style="{ background: toneVar }" aria-hidden="true" />

    <div class="rail-text">
      <span class="status" :style="{ color: toneVar }">{{ status.message }}</span>
      <span v-if="modeLabel" class="chip">{{ modeLabel }}</span>
    </div>

    <div class="rail-course">
      <template v-if="status.currentTitle">
        <span class="course-note">正在处理</span>
        <span class="course-title" :title="status.currentTitle">{{ status.currentTitle }}</span>
      </template>
      <template v-else-if="course">
        <!-- 侧边栏已经完整显示 URL 了，这里只放课程名，避免顶栏被地址撑满 -->
        <span class="course-title" :title="course.url">{{ course.note || course.url }}</span>
      </template>
      <template v-else>
        <span class="course-note">未选择课程</span>
      </template>
    </div>

    <div class="rail-actions">
      <span v-if="status.completedCount > 0" class="counter num">
        本次完成 {{ status.completedCount }}
      </span>
      <button v-if="canStop" type="button" class="btn stop" @click="$emit('stop')">停止</button>
      <button v-else type="button" class="btn start" :disabled="!canStart" @click="$emit('start')">
        开始刷课
      </button>
    </div>
  </div>
</template>

<style scoped>
.rail {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: 0 var(--sp-6);
  height: var(--rail-height);
  border-bottom: 1px solid var(--line-soft);
  background: var(--surface);
}

.dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
}

.rail-text {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: none;
}

.status {
  font-size: var(--fs-base);
  white-space: nowrap;
}

.chip {
  padding: 1px 7px;
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  font-size: var(--fs-micro);
  color: var(--text-2);
}

.rail-course {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  padding-left: var(--sp-4);
  border-left: 1px solid var(--line-soft);
  overflow: hidden;
}

.course-note {
  flex: none;
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.course-title {
  font-size: var(--fs-small);
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rail-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.counter {
  font-size: var(--fs-small);
  color: var(--text-3);
}

.btn {
  padding: 6px 18px;
  border-radius: var(--r-control);
  border: 1px solid var(--line);
  font-size: var(--fs-base);
  transition: background var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.btn.start {
  border-color: var(--jade);
  color: var(--jade);
}

.btn.start:hover:not(:disabled) {
  background: var(--jade-dim);
}

.btn.start:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn.stop {
  border-color: var(--clay);
  color: var(--clay);
}

.btn.stop:hover {
  background: var(--clay-dim);
}
</style>
