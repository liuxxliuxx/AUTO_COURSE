<script setup lang="ts">
defineProps<{ name: string }>()

const fallbackPaths: Record<string, string> = {
  back: 'm14 5-7 7 7 7',
  save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8'
}
</script>

<template>
  <span class="ui-icon-box" :class="`icon-${name}`" aria-hidden="true">
    <!-- 1. 课程：书本图标，悬停选项超 0.5s 书本合上再张开 -->
    <svg
      v-if="name === 'courses'"
      class="ui-icon courses-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path class="book-left" d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path class="book-right" d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>

    <!-- 2. 关于与帮助：问号图标，悬停选项超 0.5s 歪一下再回去 -->
    <svg
      v-else-if="name === 'about'"
      class="ui-icon about-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <g class="about-mark">
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <circle cx="12" cy="17" r="0.5" fill="currentColor" />
      </g>
    </svg>

    <!-- 3. 账号：小人图标，悬停选项超 0.5s 头部点头致意 -->
    <svg
      v-else-if="name === 'accounts' || name === 'user'"
      class="ui-icon accounts-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path class="account-body" d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle class="account-head" cx="12" cy="7" r="4" />
    </svg>

    <!-- 4. 任务列表：步骤节点图标，悬停选项超 0.5s 错位微移 -->
    <svg
      v-else-if="name === 'workflows'"
      class="ui-icon workflows-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect class="wf-node wf-node-1" x="3" y="3" width="7" height="7" rx="1.5" />
      <rect class="wf-node wf-node-2" x="14" y="14" width="7" height="7" rx="1.5" />
      <path class="wf-flow" d="M6.5 10v6a1.5 1.5 0 0 0 1.5 1.5H14" />
    </svg>

    <!-- 5. 运行：播放键图标，悬停选项超 0.5s 向前推按一下再回来 -->
    <svg
      v-else-if="name === 'run' || name === 'play'"
      class="ui-icon run-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polygon class="run-triangle" points="6 4 20 12 6 20 6 4" />
    </svg>

    <!-- 6. 设置：齿轮图标，悬停选项超 0.5s 齿轮转一下 -->
    <svg
      v-else-if="name === 'settings'"
      class="ui-icon settings-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <g class="settings-gear">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </g>
    </svg>

    <!-- 7. 添加：加号图标，悬停超 0.5s 顺时针转动 90 度 -->
    <svg
      v-else-if="name === 'add'"
      class="ui-icon add-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path class="add-path" d="M12 5v14M5 12h14" />
    </svg>

    <!-- 8. 复制：纸张图标，悬停超 0.5s 后层纸张轻微滑动 -->
    <svg
      v-else-if="name === 'copy'"
      class="ui-icon copy-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect class="copy-back" x="8" y="8" width="13" height="13" rx="2" />
      <path class="copy-front" d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>

    <!-- 9. 编辑：铅笔图标，悬停超 0.5s 笔尖轻微倾斜 -->
    <svg
      v-else-if="name === 'edit'"
      class="ui-icon edit-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path class="edit-path" d="m4 16 12-12 4 4-12 12H4v-4Z" />
    </svg>

    <!-- 10. 停止：方块图标，悬停超 0.5s 微抖动 -->
    <svg
      v-else-if="name === 'stop'"
      class="ui-icon stop-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect class="stop-box" x="5" y="5" width="14" height="14" rx="2" />
    </svg>

    <!-- 兜底通用图标 -->
    <svg
      v-else
      class="ui-icon fallback-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path :d="fallbackPaths[name] || fallbackPaths.add" />
    </svg>
  </span>
</template>

<style scoped>
/* 严格保持标准 16px 尺寸，绝无压缩、绝无整体缩放 */
.ui-icon-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  min-width: 16px;
  min-height: 16px;
  flex-shrink: 0;
  vertical-align: middle;
  position: relative;
  transition: color 0.15s ease;
}

.ui-icon {
  width: 16px;
  height: 16px;
  min-width: 16px;
  min-height: 16px;
  display: block;
  flex-shrink: 0;
  overflow: visible;
}

/* 1. 课程：书本“合上再张开”（无任何 scale 放大缩小，只有两页翻合） */
.book-left {
  transform-origin: 12px 18px;
  transform-box: view-box;
}
.book-right {
  transform-origin: 12px 18px;
  transform-box: view-box;
}

/* 保留后代选择器的 scoped 标记，让整行悬停只触发图标内部动画。 */
:is(a:hover, button:enabled:hover) .icon-courses .book-left {
  animation: book-close-open-left 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s;
}

:is(a:hover, button:enabled:hover) .icon-courses .book-right {
  animation: book-close-open-right 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s;
}

@keyframes book-close-open-left {
  0% { transform: rotate(0deg); }
  45% { transform: rotate(26deg); } /* 书页翻向中轴合上 */
  100% { transform: rotate(0deg); } /* 重新张开 */
}

@keyframes book-close-open-right {
  0% { transform: rotate(0deg); }
  45% { transform: rotate(-26deg); } /* 书页翻向中轴合上 */
  100% { transform: rotate(0deg); } /* 重新张开 */
}

/* 2. 设置：齿轮“转一下”（顺时针自转，无任何 scale 缩放） */
.settings-gear {
  transform-origin: 12px 12px;
  transform-box: view-box;
}

:is(a:hover, button:enabled:hover) .icon-settings .settings-gear {
  animation: gear-spin-once 0.65s cubic-bezier(0.25, 1, 0.5, 1) 0.5s;
}

@keyframes gear-spin-once {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(180deg); }
}

/* 3. 关于与帮助：图标“歪一下再回去”（内部问号歪头，无任何 scale 缩放） */
.about-mark {
  transform-origin: 12px 18px;
  transform-box: view-box;
}

:is(a:hover, button:enabled:hover) .icon-about .about-mark {
  animation: icon-tilt-back 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s;
}

@keyframes icon-tilt-back {
  0% { transform: rotate(0deg); }
  35% { transform: rotate(-22deg); } /* 歪一下 */
  70% { transform: rotate(6deg); }
  100% { transform: rotate(0deg); } /* 回正 */
}

/* 4. 账号：小人点头（头部轻微上下点头，无任何 scale 缩放） */
.account-head {
  transform-origin: 12px 7px;
  transform-box: view-box;
}

:is(a:hover, button:enabled:hover) .icon-accounts .account-head {
  animation: account-nod 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s;
}

@keyframes account-nod {
  0% { transform: translateY(0); }
  35% { transform: translateY(-2.5px); }
  70% { transform: translateY(0.8px); }
  100% { transform: translateY(0); }
}

/* 5. 任务列表：步骤方块微移（无任何 scale 缩放） */
.wf-node-1, .wf-node-2 {
  transform-origin: center center;
  transform-box: fill-box;
}

:is(a:hover, button:enabled:hover) .icon-workflows .wf-node-1 {
  animation: wf-step-1 0.45s ease 0.5s;
}

:is(a:hover, button:enabled:hover) .icon-workflows .wf-node-2 {
  animation: wf-step-2 0.45s ease 0.55s;
}

@keyframes wf-step-1 {
  0%, 100% { transform: translateY(0); }
  45% { transform: translateY(-1.5px); }
}

@keyframes wf-step-2 {
  0%, 100% { transform: translateY(0); }
  45% { transform: translateY(1.5px); }
}

/* 6. 运行：播放键向右平移推按（纯平移，无任何 scale 缩放） */
.run-triangle {
  transform-origin: 12px 12px;
  transform-box: view-box;
}

:is(a:hover, button:enabled:hover) .icon-run .run-triangle {
  animation: run-press 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s;
}

@keyframes run-press {
  0% { transform: translateX(0); }
  45% { transform: translateX(2.5px); }
  100% { transform: translateX(0); }
}

/* 7. 添加：加号顺时针转动 90 度（无 scale） */
.add-path {
  transform-origin: 12px 12px;
  transform-box: view-box;
}

button:enabled:hover .icon-add .add-path {
  animation: add-spin 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s;
}

@keyframes add-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(90deg); }
}

/* 8. 复制：后层纸张向右上滑出再归位（无 scale） */
.copy-back {
  transform-box: fill-box;
  transform-origin: center center;
}

button:enabled:hover .icon-copy .copy-back {
  animation: copy-slide 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s;
}

@keyframes copy-slide {
  0%, 100% { transform: translate(0, 0); }
  45% { transform: translate(2px, -2px); }
}

/* 9. 编辑：笔尖微倾斜（无 scale） */
.edit-path {
  transform-origin: bottom left;
  transform-box: view-box;
}

button:enabled:hover .icon-edit .edit-path {
  animation: edit-tilt 0.45s ease 0.5s;
}

@keyframes edit-tilt {
  0%, 100% { transform: rotate(0deg); }
  45% { transform: rotate(-14deg); }
}

/* 10. 停止：方块微抖动（无 scale） */
.stop-box {
  transform-origin: center center;
  transform-box: view-box;
}

button:enabled:hover .icon-stop .stop-box {
  animation: stop-shake 0.45s ease 0.5s;
}

@keyframes stop-shake {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-6deg); }
  75% { transform: rotate(6deg); }
}

/* 无障碍：尊重系统减弱动画设置 */
@media (prefers-reduced-motion: reduce) {
  .ui-icon-box,
  .ui-icon-box * {
    animation: none !important;
    transition: none !important;
  }
}
</style>
