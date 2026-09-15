<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'
import { formatDuration } from '../lib/format'
import StatusRail from '../components/StatusRail.vue'
import CaptchaBanner from '../components/CaptchaBanner.vue'
import ProgressHero from '../components/ProgressHero.vue'
import LogPanel from '../components/LogPanel.vue'

const app = useAppStore()

const transcriptionColor = computed(() => app.toneColor(app.transcription.tone))

const scheduler = computed(() => app.scheduler)
const schedulerLabel = computed(() => {
  const s = scheduler.value
  if (!s) return '未启用'
  if (!s.config.enabled) return '未启用'
  if (s.config.allDay) return '全天允许'
  return `${s.config.startTime} – ${s.config.endTime}`
})
</script>

<template>
  <div class="dashboard">
    <StatusRail
      :status="app.status"
      :course="app.currentCourse"
      :can-start="app.canStart"
      :can-stop="app.canStop"
      @start="app.start()"
      @stop="app.stop()"
    />

    <CaptchaBanner v-if="app.captcha" :event="app.captcha" @confirm="app.confirmCaptcha()" />

    <ProgressHero :progress="app.progress" tone="var(--jade)" />

    <div class="body">
      <aside class="side">
        <section class="block">
          <h2 class="block-title">语音转文字</h2>
          <p class="block-value" :style="{ color: transcriptionColor }">
            {{ app.transcription.message }}
          </p>
          <p v-if="app.transcription.completed || app.transcription.failed" class="block-meta">
            已完成 <span class="num">{{ app.transcription.completed }}</span> 节 · 失败
            <span class="num">{{ app.transcription.failed }}</span> 节
          </p>
        </section>

        <section class="block">
          <h2 class="block-title">自动调度</h2>
          <p class="block-value">
            {{ schedulerLabel }}
            <span
              v-if="scheduler?.config.enabled"
              class="range-dot"
              :style="{ background: scheduler.inRange ? 'var(--jade)' : 'var(--text-3)' }"
            />
          </p>
          <p class="block-meta">
            今日目标
            <span class="num">{{
              scheduler && scheduler.config.dailyLimitMinutes > 0
                ? formatDuration(scheduler.config.dailyLimitMinutes * 60)
                : '不限'
            }}</span>
          </p>
        </section>

        <section class="block">
          <h2 class="block-title">当前课程</h2>
          <p v-if="app.currentCourse" class="block-value wrap">
            {{ app.currentCourse.note || '未命名课程' }}
          </p>
          <p v-if="app.currentCourse" class="block-meta wrap">{{ app.currentCourse.url }}</p>
          <p v-else class="block-value muted">未选择。到「设置 · 课程」里填一个课程地址。</p>
        </section>
      </aside>

      <LogPanel :logs="app.logs" class="log" />
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.side {
  flex: none;
  width: 268px;
  border-right: 1px solid var(--line-soft);
  padding: var(--sp-5) var(--sp-4) var(--sp-5) var(--sp-6);
  overflow-y: auto;
}

.block + .block {
  margin-top: var(--sp-5);
}

.block-title {
  font-size: var(--fs-micro);
  color: var(--text-3);
  margin-bottom: var(--sp-1);
}

.block-value {
  font-size: var(--fs-base);
  color: var(--text);
}

.block-value.muted {
  color: var(--text-3);
  font-size: var(--fs-small);
  max-width: 32ch;
}

.block-value.wrap,
.block-meta.wrap {
  overflow-wrap: anywhere;
}

.block-meta {
  margin-top: 2px;
  font-size: var(--fs-small);
  color: var(--text-3);
}

.range-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-left: var(--sp-2);
  vertical-align: middle;
}

.log {
  min-width: 0;
  padding-top: var(--sp-4);
}
</style>
