/**
 * 抢焦点回归探针。
 *
 * 背景：课程窗口是自动打开的（每次运行、每次宿主重启都会开），
 * 早期实现用 `show: true` + `window.show()`，会把用户当前 App 的焦点抢走
 * （实测：前台是「访达」时打开课程窗口，前台变成 Electron）。
 *
 * 现在的约定：
 *   - 自动路径（宿主启动 / 运行开始 / 宿主重启）只 `showInactive()`，不抢焦点；
 *   - 只有用户主动点「打开课程窗口 / 验证窗口 / 登录窗口」才显式 focus。
 *
 * 这个探针把两条路径都量一遍（焦点状态只能在真实 GUI 会话里观察，
 * 所以它不进 `npm test`，需要时手动跑）：
 *
 *   node scripts/poc/focus-probe.mjs
 *
 * 需要：macOS、可用的图形会话（`lsappinfo` / `open -a Finder`）、
 * 以及 electron/postinstall 已经就绪（`node_modules/electron/dist` 存在）。
 */

import { _electron as electron } from 'playwright-core'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const electronBinary = resolve(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()
const frontApp = () => {
  const line = sh('lsappinfo info -only name $(lsappinfo front)')
  return (line.match(/"([^"]+)"/) ?? [null, line])[1]
}
const giveFocusTo = (name) => sh(`open -a ${JSON.stringify(name)}`)

if (process.platform !== 'darwin') {
  console.error('这个探针只在 macOS 上有效（依赖 lsappinfo）')
  process.exit(1)
}
if (!existsSync(electronBinary)) {
  console.error(`找不到 Electron 二进制: ${electronBinary}`)
  process.exit(1)
}

const results = []
const record = (name, ok, detail) => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const baseline = frontApp()

// ---------------------------------------------------------------- 自动路径
// 与 BrowserService.launchHost() 同样的启动方式：只开窗口，不该动前台 App。
console.log('\n[1/2] 自动路径：宿主启动开窗')
giveFocusTo('Finder')
await sleep(1500)
const beforeAuto = frontApp()

let host
try {
  host = await electron.launch({
    executablePath: electronBinary,
    args: [
      root,
      '--browser-host',
      '--download-dir=/tmp/ac-focus-probe/downloads',
      '--profile-dir=/tmp/ac-focus-probe/browser-profile'
    ],
    cwd: root
  })
  const page = await host.firstWindow({ timeout: 40_000 })
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await sleep(3000)

  const afterAuto = frontApp()
  const state = await host.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), focused: w.isFocused() }))
  )
  const visible = state.every((w) => w.visible)
  const focused = state.some((w) => w.focused)
  record('课程窗口照常显示', visible, JSON.stringify(state))
  record('前台 App 没有被抢走', afterAuto === beforeAuto, `${beforeAuto} → ${afterAuto}`)
  record('课程窗口没有被聚焦', !focused, JSON.stringify(state))
} catch (error) {
  record('自动路径探针执行失败', false, String(error).slice(0, 160))
} finally {
  await host?.close().catch(() => {})
}

// ---------------------------------------------------------------- 用户主动
// 点「打开课程窗口」时必须真的到前台，否则用户找不到窗口。
console.log('\n[2/2] 用户主动：点「打开课程窗口」')
try {
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [root, '--user-data-dir=/tmp/ac-focus-probe/app-profile'],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production' }
  })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.locator('.brand').waitFor({ timeout: 20_000 })

    giveFocusTo('Finder')
    await sleep(1500)
    const beforeClick = frontApp()

    await window.evaluate(() => window.appApi.browser.openCourseWindow())
    await sleep(6000)
    const afterClick = frontApp()
    record('点击后课程窗口被拉到前台', afterClick !== beforeClick, `${beforeClick} → ${afterClick}`)
  } finally {
    await app.close().catch(() => {})
  }
} catch (error) {
  record('用户主动路径探针执行失败', false, String(error).slice(0, 160))
}

try {
  if (baseline) sh(`osascript -e 'tell application ${JSON.stringify(baseline)} to activate'`)
} catch {
  /* 还原不了就算了，不影响结论 */
}

const failed = results.filter((ok) => !ok).length
console.log(`\n===== ${results.length - failed}/${results.length} 通过 =====`)
process.exitCode = failed ? 1 : 0
