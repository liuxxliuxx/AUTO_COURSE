/**
 * Main 进程入口 —— 只做一件事：分流。
 *
 * 同一个 Electron 二进制承担两种角色：
 *   --browser-host  →  Browser Host（Playwright 驱动的纯窗口进程）
 *   默认            →  应用本体（Vue 控制面板 + 全部 Service）
 *
 * 分流必须发生在任何重模块加载之前：
 *  - 应用本体会抢 userData 排他锁，宿主不能再抢一次；
 *  - 宿主不该加载 SQLite / BotService / IPC。
 * 所以两边都用动态 import。
 */

const IS_BROWSER_HOST = process.argv.includes('--browser-host')

if (IS_BROWSER_HOST) {
  void import('./automation/browser-host').then((mod) => mod.startBrowserHost())
} else {
  void import('./app-main').then((mod) => mod.startApplication())
}
