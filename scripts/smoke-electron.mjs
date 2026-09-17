/**
 * Electron 启动冒烟测试。
 *
 * 用 Playwright 的 Electron 驱动启动打包后的应用，确认：
 *  1. Electron 能起、主进程 IPC 注册成功
 *  2. Vue Renderer 渲染出 Dashboard
 *  3. typed IPC 往返可用（appApi.app.version）
 *  4. preload 没有把 ipcRenderer 泄漏到 Renderer
 *
 * 用法：node scripts/smoke-electron.mjs
 *
 * 如果本机已经开着开发实例（单实例锁），或不想动真实用户数据，
 * 用 AUTO_COURSE_SMOKE_USER_DATA 指定一个临时目录：
 *   AUTO_COURSE_SMOKE_USER_DATA=/tmp/ac-smoke node scripts/smoke-electron.mjs
 */

import { _electron as electron } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isolatedUserData = process.env.AUTO_COURSE_SMOKE_USER_DATA

function fail(message) {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

function pass(message) {
  console.log(`✓ ${message}`)
}

const app = await electron.launch({
  args: isolatedUserData ? [root, `--user-data-dir=${isolatedUserData}`] : [root],
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production' }
})

try {
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const title = await window.title()
  console.log(`  窗口标题: ${title}`)

  // 1. Vue 是否挂载
  const brand = await window.locator('.brand').textContent({ timeout: 10_000 })
  if (brand?.includes('课程助手')) pass(`Renderer 已渲染: ${brand.trim()}`)
  else fail(`Renderer 未渲染，.brand = ${JSON.stringify(brand)}`)

  // 2. 主进程 IPC 往返
  const info = await window.evaluate(() => window.appApi.app.version())
  if (info?.electron) pass(`typed IPC 往返正常 (electron ${info.electron}, chrome ${info.chrome})`)
  else fail(`typed IPC 返回异常: ${JSON.stringify(info)}`)

  // 3. Renderer 是否被正确隔离
  const leaked = await window.evaluate(() => ({
    require: typeof globalThis.require,
    process: typeof globalThis.process,
    ipcRenderer: typeof globalThis.ipcRenderer
  }))
  if (leaked.require === 'undefined' && leaked.process === 'undefined' && leaked.ipcRenderer === 'undefined') {
    pass('Renderer 隔离正常：无 require / process / ipcRenderer')
  } else {
    fail(`Renderer 隔离被破坏: ${JSON.stringify(leaked)}`)
  }

  // 4. 三个页面都能导航
  for (const [label, heading] of [
    ['课程', '我的课程'],
    ['运行', '运行'],
    ['设置', '设置']
  ]) {
    await window.getByRole('link', { name: label, exact: true }).click()
    await window.getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 10_000 })
    pass(`路由切换正常：${label} 页显示「${heading}」`)
  }

  // 5. Phase 3 服务层：SQLite / 设置 / 凭据 / 调度 / v1 迁移
  const settings = await window.evaluate(() => window.appApi.settings.getAll())
  if (settings && typeof settings.skipCompleted === 'boolean') {
    pass(
      `设置已从 SQLite 读出（登录方式=${settings.loginMethod} 跳过已完成=${settings.skipCompleted}）`
    )
  } else {
    fail(`设置读取异常: ${JSON.stringify(settings)}`)
  }

  const credState = await window.evaluate(() => window.appApi.credentials.state())
  pass(`safeStorage 可用: ${credState.encryptionAvailable}`)

  const sched = await window.evaluate(() => window.appApi.scheduler.get())
  if (sched?.config) pass(`调度器状态就绪（启用=${sched.config.enabled}）`)
  else fail(`调度器状态异常: ${JSON.stringify(sched)}`)

  const progress = await window.evaluate(() => window.appApi.progress.get())
  if (typeof progress?.today?.watchedSeconds === 'number') {
    pass(`今日进度: ${progress.today.date} / ${progress.today.watchedSeconds}s`)
  } else {
    fail(`进度读取异常: ${JSON.stringify(progress)}`)
  }

  const migration = await window.evaluate(() => window.appApi.migration.report())
  pass(`v1 迁移: imported=${migration.imported} — ${migration.message}`)

  const validation = await window.evaluate(() => window.appApi.settings.validate())
  pass(`设置校验返回 ${validation.length} 条违规项`)

  // 课程库契约：每门课程独立配置 + 默认值
  const library = await window.evaluate(() => window.appApi.courses.list())
  if (Array.isArray(library?.courses) && library.defaults?.action) {
    pass(`课程库可读：${library.courses.length} 门课程，默认运行方式=${library.defaults.action}`)
  } else {
    fail(`课程库读取异常: ${JSON.stringify(library)}`)
  }

  // 不存在的课程必须被拒绝，且不得有任何副作用（不建浏览器、不动状态）
  const startResult = await window.evaluate(() => window.appApi.bot.start({ courseId: 'not-a-course' }))
  if (startResult.ok === false && Array.isArray(startResult.errors) && startResult.errors.length) {
    pass(
      `校验不通过时启动被拒绝（${startResult.errors.map((e) => e.field).join(', ')}）`
    )
  } else {
    fail(`启动未被拒绝: ${JSON.stringify(startResult)}`)
  }

  const afterStart = await window.evaluate(() => window.appApi.bot.status())
  if (afterStart.state === 'idle') pass('启动被拒后状态仍为 idle')
  else fail(`启动被拒后状态异常: ${afterStart.state}`)
} catch (error) {
  fail(`冒烟测试异常: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await app.close()
}
