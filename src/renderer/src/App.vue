<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { useAppStore } from './stores/app'

const app = useAppStore()
const version = ref('')
const platform = ref('')

// 事件订阅与初始快照由 App 持有：切到「设置」页时也要继续接收状态推送，
// 所以这里不随页面卸载而 dispose。
onMounted(async () => {
  void app.hydrate()
  try {
    const info = await window.appApi.app.version()
    version.value = `v${info.version}`
    platform.value = info.platform
  } catch {
    version.value = ''
  }
})
</script>

<template>
  <div class="shell" :data-platform="platform">
    <header class="topbar">
      <div class="brand">智慧树自动刷课</div>

      <nav class="tabs" aria-label="主导航">
        <RouterLink to="/" class="tab" active-class="active">运行</RouterLink>
        <RouterLink to="/settings" class="tab" active-class="active">设置</RouterLink>
      </nav>

      <div class="right">
        <span v-if="app.migration?.imported" class="migrated" :title="app.migration.message">
          已导入旧数据
        </span>
        <span v-if="version" class="version num">{{ version }}</span>
      </div>
    </header>

    <main class="view">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  height: 42px;
  padding: 0 var(--sp-6);
  border-bottom: 1px solid var(--line-soft);
  background: var(--ground);
  -webkit-app-region: drag;
}

/* macOS 使用 hiddenInset 标题栏，给红黄绿按钮让出位置 */
.shell[data-platform='darwin'] .topbar {
  padding-left: 82px;
}

.brand {
  font-size: var(--fs-base);
  color: var(--text);
  letter-spacing: 0.01em;
}

.tabs {
  display: flex;
  gap: var(--sp-1);
  -webkit-app-region: no-drag;
}

.tab {
  padding: 3px 10px;
  border-radius: var(--r-control);
  font-size: var(--fs-small);
  color: var(--text-3);
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease;
}

.tab:hover {
  color: var(--text-2);
  background: var(--surface);
}

.tab.active {
  color: var(--text);
  background: var(--surface-2);
}

.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  -webkit-app-region: no-drag;
}

.migrated {
  font-size: var(--fs-micro);
  color: var(--brass);
  border: 1px solid var(--brass-dim);
  border-radius: var(--r-control);
  padding: 1px 7px;
}

.version {
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.view {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
