/**
 * PoC 用的最小 Electron 宿主。
 *
 * 只做一件事：按 webPreferences 安全要求开一个 BrowserWindow 并加载 argv 里的 URL。
 * 把「Playwright 能不能驱动 Electron 的 Chromium」这个问题从主程序里隔离出来验证。
 *
 * 用法：electron scripts/poc/electron-host.cjs [--secure|--insecure] <url>
 */

const { app, BrowserWindow } = require('electron')

const args = process.argv.slice(2)
const insecure = args.includes('--insecure')
const url = args.find((a) => !a.startsWith('--')) || 'about:blank'

// 与 docs/v2_handoff.md §7 要求一致：远程内容一律无 Node 权限
const webPreferences = insecure
  ? { nodeIntegration: true, contextIsolation: false, sandbox: false }
  : { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false }

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences })
  win.loadURL(url)

  win.webContents.on('did-finish-load', () => {
    // 让外部脚本知道页面已经就绪
    console.log(`[host] loaded: ${win.webContents.getURL()}`)
  })
})

app.on('window-all-closed', () => app.quit())
