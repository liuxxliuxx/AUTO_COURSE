<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppInfo, SupportResource } from '@shared/app-info'
const info = ref<AppInfo>(), diagnostics = ref(''), error = ref(''), copied = ref(false)
async function action(fn: () => Promise<unknown>): Promise<void> {
  error.value = ''; try { await fn() } catch (e) { error.value = String(e) }
}
onMounted(() => void action(async () => { info.value = await window.appApi.app.version(); diagnostics.value = await window.appApi.app.diagnostics() }))
function open(resource: SupportResource): void { void action(() => window.appApi.app.openSupport(resource)) }
function link(resource: 'homepage' | 'issues' | 'releases'): void { void action(() => window.appApi.app.openLink(resource)) }
async function copy(): Promise<void> { copied.value = false; await action(async () => { await navigator.clipboard.writeText(diagnostics.value); copied.value = true }) }
</script>
<template>
  <div class="page support-page">
    <h1>关于与帮助</h1>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <section v-if="info">
      <h2>{{ info.name }} {{ info.version }}</h2>
      <p>课程学习与工作流桌面客户端</p>
      <dl><dt>构建</dt><dd>{{ info.commit }} · {{ info.builtAt }}</dd><dt>运行环境</dt><dd>{{ info.platform }} / {{ info.arch }} · Electron {{ info.electron }} · Chromium {{ info.chrome }} · Node {{ info.node }}</dd><dt>开发者</dt><dd>{{ info.author }}</dd><dt>项目许可证</dt><dd>{{ info.license === 'UNLICENSED' ? '尚未授予开源许可' : info.license }}</dd></dl>
      <div class="actions"><button @click="open('project')">项目与开发者信息</button><button @click="open('licenses')">第三方许可证</button></div>
    </section>
    <section><h2>使用帮助</h2><p>安装、快速上手、常见问题、故障排除和 v1 → v2 迁移说明保存在仓库文档目录，点击后在浏览器中阅读。</p>
      <div class="actions"><button @click="open('guide')">打开用户文档</button><button @click="open('data')">打开数据目录</button><button @click="link('issues')">反馈问题</button><button @click="link('releases')">查看发布版本</button></div>
    </section>
    <section><h2>诊断信息</h2><p>仅包含版本和运行环境。请在反馈问题时附上；运行日志可在运行页查看。</p>
      <textarea aria-label="诊断信息" readonly :value="diagnostics" rows="12"></textarea>
      <button :disabled="!diagnostics" @click="copy">{{ copied ? '已复制' : '复制诊断信息' }}</button>
    </section>
  </div>
</template>
<style scoped>
.support-page { overflow:auto; max-width:960px; width:100%; padding:24px; }
section { padding:20px 0; border-bottom:1px solid var(--line); }
h2 { margin-bottom:12px; } p { margin:12px 0; color:var(--text-2); }
dl { display:grid; grid-template-columns:100px 1fr; gap:10px; } dd { margin:0; overflow-wrap:anywhere; }
.actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:16px; }
textarea { width:100%; resize:vertical; margin:12px 0; font-family:monospace; }
</style>
