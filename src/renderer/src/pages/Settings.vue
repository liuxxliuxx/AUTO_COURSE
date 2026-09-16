<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import FieldRow from '../components/FieldRow.vue'
import AppSwitch from '../components/AppSwitch.vue'
import { isValidTime } from '../lib/format'
import type { LoginMethod } from '@shared/types'

const store = useSettingsStore()

type SectionId = 'account' | 'course' | 'brush' | 'transcribe' | 'schedule' | 'appearance'

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'account', label: '账号' },
  { id: 'course', label: '课程' },
  { id: 'brush', label: '刷课' },
  { id: 'transcribe', label: '转录' },
  { id: 'schedule', label: '自动调度' },
  { id: 'appearance', label: '外观' }
]

const section = ref<SectionId>('account')
const savedFlash = ref(false)

onMounted(() => void store.load())

const s = computed(() => store.settings)

/** 图谱模式必须配图谱课 URL —— 校验规则与 v1 bridge._validate_start 一致 */
const mapUrlLooksWrong = computed(
  () => s.value.mapMode && !s.value.videoUrl.includes('ai-smart-course-student-pro')
)

/** 关闭刷课即进入仅转录模式（v1 bridge.py:274 的同一条推导） */
const transcribeOnly = computed(() => !s.value.brushEnabled && !s.value.mapMode)

const timeRangeInvalid = computed(
  () =>
    !s.value.autoAllDay &&
    s.value.autoStartTime !== '' &&
    s.value.autoEndTime !== '' &&
    (!isValidTime(s.value.autoStartTime) || !isValidTime(s.value.autoEndTime))
)

async function saveCredentials(): Promise<void> {
  await store.saveCredentials({ ...store.credentials })
  savedFlash.value = true
  window.setTimeout(() => (savedFlash.value = false), 1600)
}

async function pickDirectory(): Promise<void> {
  const dir = await window.appApi.dialog.pickDirectory()
  if (dir) await store.update('transcribeBaseDir', dir)
}

const loginOptions: Array<{ value: LoginMethod; label: string }> = [
  { value: 'zhihuishu', label: '智慧树账号' },
  { value: 'upc-institution', label: '数字石大 · 机构 SSO（新）' },
  { value: 'upc', label: '数字石大 · 旧门户（兼容）' }
]
</script>

<template>
  <div class="settings">
    <nav class="nav" aria-label="设置分类">
      <button
        v-for="item in SECTIONS"
        :key="item.id"
        type="button"
        class="nav-item"
        :class="{ active: section === item.id }"
        :aria-current="section === item.id ? 'true' : undefined"
        @click="section = item.id"
      >
        {{ item.label }}
      </button>
    </nav>

    <div class="content">
      <div v-if="!store.credentialState.encryptionAvailable" class="notice danger">
        当前系统无法安全加密凭据，账号密码将不会保存。
      </div>
      <div v-if="timeRangeInvalid" class="notice danger">时间段格式应为 HH:mm。</div>

      <!-- ============ 账号 ============ -->
      <section v-show="section === 'account'" class="group">
        <h2 class="group-title">账号</h2>

        <FieldRow label="登录方式">
          <select
            class="select"
            :value="s.loginMethod"
            @change="store.update('loginMethod', ($event.target as HTMLSelectElement).value as LoginMethod)"
          >
            <option v-for="opt in loginOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </FieldRow>

        <FieldRow label="账号" hint="智慧树为手机号；数字石大为统一认证账号。">
          <input
            v-model="store.credentials.username"
            class="input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            @blur="saveCredentials"
          />
        </FieldRow>

        <FieldRow label="密码">
          <input
            v-model="store.credentials.password"
            class="input"
            type="password"
            autocomplete="off"
            @blur="saveCredentials"
          />
          <span v-if="savedFlash" class="flash">已保存</span>
        </FieldRow>

        <FieldRow
          label="登录跳转 URL"
          :hint="
            s.loginMethod === 'upc'
              ? '旧门户流程必填，用于判断门户跳转是否完成。'
              : '机构 SSO 与智慧树账号登录通常无需填写。'
          "
          stacked
        >
          <input
            class="input grow mono"
            :value="s.loggedUrl"
            placeholder="https://..."
            spellcheck="false"
            @change="store.update('loggedUrl', ($event.target as HTMLInputElement).value)"
          />
        </FieldRow>
      </section>

      <!-- ============ 课程 ============ -->
      <section v-show="section === 'course'" class="group">
        <h2 class="group-title">课程</h2>

        <FieldRow
          label="课程地址"
          :hint="
            s.mapMode
              ? '图谱刷课需要 ai-smart-course-student-pro.zhihuishu.com 开头的地址。'
              : '传统课程填课程学习页地址即可。'
          "
          stacked
        >
          <input
            class="input grow mono"
            :value="s.videoUrl"
            placeholder="https://..."
            spellcheck="false"
            @change="store.update('videoUrl', ($event.target as HTMLInputElement).value)"
          />
        </FieldRow>

        <p v-if="mapUrlLooksWrong" class="notice danger inline">
          已开启图谱刷课，但地址不是图谱课地址。
        </p>

        <FieldRow label="课程备注" hint="用于区分同名课程，同时作为「从上次进度继续」的记录键。" stacked>
          <input
            class="input grow"
            :value="s.courseNote"
            placeholder="例如：艺术与审美"
            @change="store.update('courseNote', ($event.target as HTMLInputElement).value)"
          />
        </FieldRow>

        <div v-if="store.courses.length" class="history">
          <div class="history-title">最近使用</div>
          <ul class="history-list">
            <li v-for="item in store.courses" :key="item.url">
              <button
                type="button"
                class="history-item"
                :class="{ active: item.url === s.videoUrl }"
                @click="store.selectCourse(item.url, item.note)"
              >
                <span class="history-note">{{ item.note || '未命名课程' }}</span>
                <span class="history-url">{{ item.url }}</span>
              </button>
            </li>
          </ul>
        </div>
      </section>

      <!-- ============ 刷课 ============ -->
      <section v-show="section === 'brush'" class="group">
        <h2 class="group-title">刷课</h2>

        <FieldRow label="启用刷课" hint="关闭后仅做语音转文字，不累计刷课时长。">
          <AppSwitch
            :model-value="s.brushEnabled"
            label="启用刷课"
            @update:model-value="store.update('brushEnabled', $event)"
          />
        </FieldRow>

        <FieldRow label="图谱刷课" hint="新版知识图谱课程。与普通刷课是两套独立流程。">
          <AppSwitch
            :model-value="s.mapMode"
            label="图谱刷课"
            @update:model-value="store.update('mapMode', $event)"
          />
        </FieldRow>

        <FieldRow label="跳过已完成的视频">
          <AppSwitch
            :model-value="s.skipCompleted"
            label="跳过已完成的视频"
            @update:model-value="store.update('skipCompleted', $event)"
          />
        </FieldRow>

        <FieldRow label="从上次进度继续" hint="从该课程上次完成的那个视频之后开始。">
          <AppSwitch
            :model-value="s.fromLastProgress"
            label="从上次进度继续"
            @update:model-value="store.update('fromLastProgress', $event)"
          />
        </FieldRow>

        <FieldRow label="单次运行时长上限" hint="分钟。0 表示不限制。">
          <input
            class="input narrow num"
            type="number"
            min="0"
            step="10"
            :value="s.timeLimitMinutes"
            @change="
              store.update('timeLimitMinutes', Number(($event.target as HTMLInputElement).value) || 0)
            "
          />
          <span class="unit">分钟</span>
        </FieldRow>
      </section>

      <!-- ============ 转录 ============ -->
      <section v-show="section === 'transcribe'" class="group">
        <h2 class="group-title">语音转文字</h2>

        <div v-if="transcribeOnly" class="notice">
          已关闭刷课，当前为<b>仅转录</b>模式：直接下载音轨转写，不播放视频。
        </div>

        <FieldRow label="启用语音转文字" hint="需要系统已安装 ffmpeg。">
          <AppSwitch
            :model-value="s.transcribeEnabled || transcribeOnly"
            :disabled="transcribeOnly"
            label="启用语音转文字"
            @update:model-value="store.update('transcribeEnabled', $event)"
          />
        </FieldRow>

        <FieldRow label="保存路径" hint="转写结果保存在该目录下的「课程录音」文件夹。" stacked>
          <div class="row">
            <input
              class="input grow mono"
              :value="s.transcribeBaseDir"
              placeholder="选择保存目录"
              spellcheck="false"
              @change="store.update('transcribeBaseDir', ($event.target as HTMLInputElement).value)"
            />
            <button type="button" class="btn-quiet" @click="pickDirectory">选择…</button>
          </div>
        </FieldRow>
      </section>

      <!-- ============ 自动调度 ============ -->
      <section v-show="section === 'schedule'" class="group">
        <h2 class="group-title">自动调度</h2>

        <FieldRow label="启用自动调度" hint="到达时间段且今日未达标时自动开始，达标或超时自动停止。">
          <AppSwitch
            :model-value="s.autoMode"
            label="启用自动调度"
            @update:model-value="store.update('autoMode', $event)"
          />
        </FieldRow>

        <FieldRow label="全天允许" hint="勾选后忽略下方时间段。">
          <AppSwitch
            :model-value="s.autoAllDay"
            :disabled="!s.autoMode"
            label="全天允许"
            @update:model-value="store.update('autoAllDay', $event)"
          />
        </FieldRow>

        <FieldRow label="允许时间段" hint="开始时间晚于结束时间表示跨午夜。">
          <input
            class="input time num"
            type="time"
            :value="s.autoStartTime"
            :disabled="!s.autoMode || s.autoAllDay"
            @change="store.update('autoStartTime', ($event.target as HTMLInputElement).value)"
          />
          <span class="unit">至</span>
          <input
            class="input time num"
            type="time"
            :value="s.autoEndTime"
            :disabled="!s.autoMode || s.autoAllDay"
            @change="store.update('autoEndTime', ($event.target as HTMLInputElement).value)"
          />
        </FieldRow>

        <FieldRow label="每日目标时长" hint="分钟。达到后当天自动停止；0 表示不限制。">
          <input
            class="input narrow num"
            type="number"
            min="0"
            step="10"
            :value="s.autoLimitMinutes"
            :disabled="!s.autoMode"
            @change="
              store.update('autoLimitMinutes', Number(($event.target as HTMLInputElement).value) || 0)
            "
          />
          <span class="unit">分钟</span>
        </FieldRow>
      </section>

      <!-- ============ 外观 ============ -->
      <section v-show="section === 'appearance'" class="group">
        <h2 class="group-title">外观</h2>

        <FieldRow label="界面缩放" hint="屏幕较小时可以调小。">
          <select
            class="select"
            :value="String(s.uiScale)"
            @change="store.update('uiScale', Number(($event.target as HTMLSelectElement).value))"
          >
            <option value="0.9">90%</option>
            <option value="1">100%</option>
            <option value="1.15">115%</option>
            <option value="1.3">130%</option>
          </select>
        </FieldRow>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  height: 100%;
  min-height: 0;
}

.nav {
  flex: none;
  width: 132px;
  padding: var(--sp-4) var(--sp-2) var(--sp-4) var(--sp-4);
  border-right: 1px solid var(--line-soft);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nav-item {
  text-align: left;
  padding: 6px 10px;
  border-radius: var(--r-control);
  font-size: var(--fs-base);
  color: var(--text-2);
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease;
}

.nav-item:hover {
  background: var(--surface);
  color: var(--text);
}

.nav-item.active {
  background: var(--surface-2);
  color: var(--text);
}

.content {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  padding: var(--sp-5) var(--sp-6) var(--sp-6);
}

.group {
  max-width: 720px;
}

.group-title {
  font-size: var(--fs-title);
  color: var(--text);
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line);
  margin-bottom: var(--sp-1);
}

.row {
  display: flex;
  gap: var(--sp-2);
  width: 100%;
}

.unit {
  flex: none;
  font-size: var(--fs-small);
  color: var(--text-3);
}

.flash {
  flex: none;
  font-size: var(--fs-micro);
  color: var(--jade);
}

.notice {
  margin: var(--sp-3) 0;
  padding: var(--sp-2) var(--sp-3);
  border-left: 2px solid var(--sky);
  background: var(--surface);
  font-size: var(--fs-small);
  color: var(--text-2);
  max-width: 66ch;
}

.notice.danger {
  border-left-color: var(--clay);
}

.notice.inline {
  margin-top: calc(var(--sp-2) * -1);
}

.history {
  margin-top: var(--sp-5);
}

.history-title {
  font-size: var(--fs-micro);
  color: var(--text-3);
  margin-bottom: var(--sp-2);
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line-soft);
}

.history-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  text-align: left;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line-soft);
  transition: background var(--motion-fast) ease;
}

.history-item:hover {
  background: var(--surface);
}

.history-item.active {
  background: var(--surface-2);
}

.history-note {
  font-size: var(--fs-base);
  color: var(--text);
}

.history-url {
  font-family: var(--font-num);
  font-size: var(--fs-micro);
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
