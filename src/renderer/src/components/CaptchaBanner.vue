<script setup lang="ts">
/**
 * 验证码提示条。
 *
 * 全应用唯一允许「响」的地方 —— 只在需要人介入时出现。
 * 入场动效刻意只给这一个元素：它必须把人从别的窗口拉回来。
 */
import { computed } from 'vue'
import { formatClock } from '../lib/format'
import type { CaptchaRequiredEvent } from '@shared/types'

const props = defineProps<{ event: CaptchaRequiredEvent }>()
const emit = defineEmits<{ confirm: [] }>()

const sceneLabel = computed(() => {
  switch (props.event.scene) {
    case 'login':
      return '登录'
    case 'course':
      return '页面'
    default:
      return '播放中'
  }
})
</script>

<template>
  <div class="banner" role="alert">
    <span class="pulse" aria-hidden="true" />
    <div class="banner-text">
      <div class="banner-title">{{ event.message }}</div>
      <div class="banner-meta">
        {{ sceneLabel }} 场景 · 触发于 <span class="num">{{ formatClock(event.at) }}</span>
      </div>
    </div>
    <button type="button" class="confirm" @click="emit('confirm')">已完成验证，继续</button>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-6);
  background: var(--clay-dim);
  border-bottom: 1px solid var(--clay);
  animation: slide-in var(--motion-base) ease-out;
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .banner {
    animation: none;
  }
}

.pulse {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--clay);
  box-shadow: 0 0 0 0 var(--clay);
  animation: pulse 1.8s ease-out infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(222, 106, 98, 0.55);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(222, 106, 98, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(222, 106, 98, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pulse {
    animation: none;
  }
}

.banner-text {
  flex: 1 1 auto;
  min-width: 0;
}

.banner-title {
  font-size: var(--fs-base);
  color: var(--text);
}

.banner-meta {
  font-size: var(--fs-small);
  color: var(--text-2);
}

.confirm {
  flex: none;
  padding: 6px 14px;
  border: 1px solid var(--clay);
  border-radius: var(--r-control);
  background: var(--ground);
  color: var(--text);
  font-size: var(--fs-small);
  transition: background var(--motion-fast) ease;
}

.confirm:hover {
  background: var(--surface-3);
}
</style>
