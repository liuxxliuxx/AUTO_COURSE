<script setup lang="ts">
import { errorText } from '../lib/ui-copy'
import { nextTick, onMounted, ref, watch } from 'vue'
import type { AppInfo, SupportResource } from '@shared/app-info'
import UiIcon from '../components/UiIcon.vue'

const info = ref<AppInfo>(), diagnostics = ref(''), error = ref(''), copied = ref(false)
const diagTextarea = ref<HTMLTextAreaElement>()

function adjustTextareaHeight(): void {
  if (diagTextarea.value) {
    diagTextarea.value.style.height = 'auto'
    diagTextarea.value.style.height = `${diagTextarea.value.scrollHeight}px`
  }
}

watch(diagnostics, () => {
  void nextTick(adjustTextareaHeight)
})

async function action(operation: string, fn: () => Promise<unknown>): Promise<void> {
  error.value = ''; try { await fn() } catch (e) { error.value = errorText(operation, e) }
}

onMounted(() => void action('加载应用信息', async () => {
  info.value = await window.appApi.app.version()
  diagnostics.value = await window.appApi.app.diagnostics()
  void nextTick(adjustTextareaHeight)
}))

function open(resource: SupportResource): void { void action('打开帮助资源', () => window.appApi.app.openSupport(resource)) }
function link(resource: 'homepage' | 'issues' | 'releases'): void { void action('打开链接', () => window.appApi.app.openLink(resource)) }
async function copy(): Promise<void> {
  copied.value = false
  await action('复制诊断信息', async () => {
    await navigator.clipboard.writeText(diagnostics.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  })
}
</script>

<template>
  <div class="page support-page">
    <header class="page-header">
      <h1><UiIcon name="about"/>关于与帮助</h1>
    </header>

    <div class="support-body">
      <div class="support-content">
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>

        <section v-if="info" class="card-section">
          <div class="section-header">
            <h2>{{ info.name }} <span class="version-badge">v{{ info.version }}</span></h2>
            <p class="section-subtitle">课程学习与自动化桌面客户端</p>
          </div>
          <dl class="info-grid">
            <dt>构建版本</dt><dd class="num">{{ info.commit }} · {{ info.builtAt }}</dd>
            <dt>运行环境</dt><dd>{{ info.platform }} / {{ info.arch }} · Electron {{ info.electron }} · Chrome {{ info.chrome }} · Node {{ info.node }}</dd>
            <dt>开发者</dt><dd>{{ info.author }}</dd>
            <dt>开源许可</dt><dd>{{ info.license === 'UNLICENSED' ? '尚未授予开源许可' : info.license }}</dd>
          </dl>
          <div class="actions">
            <button @click="open('project')">项目与开发者信息</button>
            <button @click="open('licenses')">第三方许可证</button>
          </div>
        </section>

        <section class="card-section">
          <h2>使用帮助</h2>
          <p class="section-desc">安装、快速上手、常见问题、故障排除和迁移说明保存在仓库文档目录，点击后将在系统浏览器中阅读。</p>
          <div class="actions">
            <button class="primary" @click="open('guide')">打开用户文档</button>
            <button @click="open('data')">打开数据目录</button>
            <button @click="link('issues')">反馈问题</button>
            <button @click="link('releases')">查看发布版本</button>
          </div>
        </section>

        <section class="card-section diag-section">
          <div class="diag-header">
            <div>
              <h2>诊断信息</h2>
              <p class="section-desc">包含当前应用版本与软硬件环境，提交反馈时请附上。</p>
            </div>
            <button :disabled="!diagnostics" class="copy-btn" @click="copy">
              {{ copied ? '诊断信息已复制' : '复制诊断信息' }}
            </button>
          </div>
          <div class="diag-box">
            <textarea
              ref="diagTextarea"
              aria-label="诊断信息"
              readonly
              :value="diagnostics"
              spellcheck="false"
            ></textarea>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.support-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
}

.support-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 32px 48px;
}

.support-content {
  max-width: 820px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.card-section {
  padding-bottom: 24px;
  border-bottom: 1px solid var(--line-soft);
  animation: fadeIn 0.25s ease forwards;
}

.card-section:last-child {
  border-bottom: none;
}

.version-badge {
  font-size: var(--fs-micro);
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 2px 8px;
  border-radius: 12px;
  vertical-align: middle;
  margin-left: 6px;
}

.section-subtitle {
  margin-top: 6px;
  color: var(--text-2);
  font-size: var(--fs-base);
}

.section-desc {
  margin: 8px 0 16px;
  color: var(--text-2);
  line-height: 1.5;
}

.info-grid {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 10px 16px;
  margin: 16px 0;
  font-size: var(--fs-base);
}

.info-grid dt {
  color: var(--text-3);
  font-weight: 500;
}

.info-grid dd {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.diag-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.diag-box {
  margin-top: 12px;
}

textarea {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  overflow: hidden; /* 彻底去除 textarea 内部及右侧滚动条 */
  margin: 0;
  font-family: var(--font-num);
  font-size: var(--fs-micro);
  line-height: 1.6;
  padding: 12px 14px;
  background: var(--ground);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  color: var(--text-2);
  outline: none;
  transition: border-color var(--motion-fast);
}

textarea:focus {
  border-color: var(--accent-line);
}

.copy-btn {
  white-space: nowrap;
  flex-shrink: 0;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
