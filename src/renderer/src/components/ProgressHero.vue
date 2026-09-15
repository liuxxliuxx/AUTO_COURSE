<script setup lang="ts">
/**
 * 今日进度 —— Dashboard 的主角。
 *
 * 读数用等宽表格数字（逐秒跳动时表宽不抖），
 * 下方进度条同时充当本区与下方的分隔线，因此整页不需要额外的横线。
 */
import { computed } from 'vue'
import { clampPercent, formatDuration } from '../lib/format'
import type { ProgressSnapshot } from '@shared/types'

const props = defineProps<{
  progress: ProgressSnapshot
  tone: string
}>()

const watched = computed(() => props.progress.today.watchedSeconds)
const targetMinutes = computed(() => props.progress.targetMinutes)
const hasTarget = computed(() => targetMinutes.value > 0)

const percent = computed<number | null>(() => {
  if (!hasTarget.value) return null
  return clampPercent((watched.value / (targetMinutes.value * 60)) * 100)
})

const reached = computed(() => percent.value !== null && percent.value >= 100)
</script>

<template>
  <section class="hero">
    <div class="hero-top">
      <div class="hero-main">
        <div class="hero-label">今日已刷</div>
        <div class="hero-value num">{{ formatDuration(watched) }}</div>
      </div>

      <dl class="hero-stats">
        <div class="stat">
          <dt>本次运行</dt>
          <dd class="num">{{ formatDuration(progress.sessionSeconds) }}</dd>
        </div>
        <div class="stat">
          <dt>每日目标</dt>
          <dd class="num">{{ hasTarget ? formatDuration(targetMinutes * 60) : '不限' }}</dd>
        </div>
        <div v-if="percent !== null" class="stat">
          <dt>完成度</dt>
          <dd class="num" :style="{ color: reached ? 'var(--jade)' : 'var(--text)' }">
            {{ percent }}%
          </dd>
        </div>
      </dl>
    </div>

    <!-- 进度条兼作分隔线：没有目标时退化为一条安静的细线 -->
    <div
      class="gauge"
      :class="{ idle: percent === null }"
      role="progressbar"
      :aria-valuenow="percent ?? undefined"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="hasTarget ? '今日刷课进度' : '今日已刷时长（未设置目标）'"
    >
      <div
        v-if="percent !== null"
        class="gauge-fill"
        :style="{ width: `${percent}%`, background: reached ? 'var(--jade)' : tone }"
      />
    </div>
  </section>
</template>

<style scoped>
.hero {
  padding: var(--sp-5) var(--sp-6) 0;
}

.hero-top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--sp-6);
  flex-wrap: wrap;
  padding-bottom: var(--sp-4);
}

.hero-label {
  font-size: var(--fs-small);
  color: var(--text-3);
  margin-bottom: 2px;
}

.hero-value {
  font-size: var(--fs-readout);
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--text);
  font-weight: 400;
}

.hero-stats {
  display: flex;
  gap: var(--sp-6);
  margin: 0;
  padding-bottom: 4px;
}

.stat {
  text-align: right;
}

.stat dt {
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.stat dd {
  margin: 2px 0 0;
  font-size: 15px;
  color: var(--text-2);
}

.gauge {
  position: relative;
  height: 3px;
  background: var(--line-soft);
}

.gauge.idle {
  background: var(--line-soft);
}

.gauge-fill {
  height: 100%;
  transition: width var(--motion-base) ease, background var(--motion-base) ease;
}
</style>
