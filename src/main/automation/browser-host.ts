/**
 * Browser Host —— 由 Playwright 启动的「纯窗口」Electron 进程。
 *
 * 为什么需要它：
 *   Electron 通过 `--remote-debugging-port` 暴露的 CDP **不提供 Runtime domain**
 *   （Target.* 和 Page.* 正常，Runtime.* 永不回应），而 Playwright 的
 *   locator / click / fill / waitFor 全部建立在 Runtime.evaluate 之上。
 *   因此 Playwright 无法接管应用自身的 BrowserWindow。
 *   详见 docs/PLAYWRIGHT_POC.md。
 *
 * 解法：主应用用同一个 Electron 二进制再起一个进程，加 `--browser-host` 标志。
 * 该进程**只负责持有一个 BrowserWindow**，其余全部交给 Playwright 驱动。
 *
 * 这个进程里不存在：数据库、调度器、BotService、IPC、Python worker。
 * 它就是一块画布。
 */

import { app, BrowserWindow, session, shell } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** 主应用与宿主共享同一个二进制，靠这个标志分流。 */
export const BROWSER_HOST_FLAG = '--browser-host'

/** 课程窗口的默认尺寸 */
const WINDOW_WIDTH = 1360
const WINDOW_HEIGHT = 900

/**
 * 下载落盘目录。
 *
 * 为什么下载要由宿主自己接：
 *   Playwright 的 page.waitForEvent('download') 在 Electron 里**不会触发** ——
 *   Electron 把下载走的是 session 的 will-download，而不是 Playwright 依赖的
 *   Browser.downloadWillBegin CDP 事件。所以下载必须在宿主侧接住，
 *   落盘后由 BrowserService 读索引文件取结果。
 */
function downloadDir(): string {
  const arg = process.argv.find((a) => a.startsWith('--download-dir='))
  if (arg) return arg.slice('--download-dir='.length)
  return join(tmpdir(), 'auto-course-browser-host', 'downloads')
}

/**
 * 宿主 profile 目录（cookie / localStorage / 登录态都在这儿）。
 *
 * 由主进程传进来，落在应用数据目录下 —— 这样**会话能跨应用重启保留**，
 * 不用每次开课都重新登录。以前用的是系统临时目录，macOS 会定期清理，
 * 用户第二天打开就得重登一次。
 * 没传时退回临时目录（只在手工直连宿主调试时发生）。
 */
function profileDir(): string {
  const arg = process.argv.find((a) => a.startsWith('--profile-dir='))
  if (arg) return arg.slice('--profile-dir='.length)
  return join(tmpdir(), 'auto-course-browser-host')
}

export async function startBrowserHost(): Promise<void> {
  // 必须换一个 userData 目录：Electron 对 userData 有排他锁，
  // 沿用主应用的目录会让宿主起不来。
  app.setPath('userData', profileDir())

  app.commandLine.appendSwitch('disable-features', 'MediaRouter')

  await app.whenReady()

  const dir = downloadDir()
  mkdirSync(dir, { recursive: true })
  installDownloadHandler(dir)

  const window = createCourseWindow()

  // Playwright 通过 firstWindow() 拿到这个窗口；窗口全部关闭即退出宿主。
  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    if (!window.isDestroyed()) window.destroy()
  })
}

/** 把页面发起的所有下载固定落到 dir，并追加一条索引记录。 */
function installDownloadHandler(dir: string): void {
  const indexPath = join(dir, '_index.jsonl')

  session.defaultSession.on('will-download', (_event, item) => {
    const filename = item.getFilename() || `download-${Date.now()}`
    const target = join(dir, filename)
    item.setSavePath(target)

    item.once('done', (_e, state) => {
      appendFileSync(
        indexPath,
        `${JSON.stringify({
          filename,
          path: target,
          state,
          bytes: item.getReceivedBytes(),
          at: Date.now()
        })}\n`,
        'utf8'
      )
    })
  })
}

function createCourseWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    // 不要 show: true —— 课程窗口是自动打开的（每次运行、每次宿主重启都会开），
    // 抢走用户当前 App 的焦点会直接打断人家正在做的事。
    show: false,
    title: '课程窗口',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      // docs/v2_handoff.md §7：远程内容不得获得任何本地能力。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      // 课程页有音视频，且需要 MediaRecorder 可用（实时录音模式）。
      backgroundThrottling: false
    }
  })

  // showInactive：窗口照常出现，但不激活本进程、不抢键盘焦点。
  // 需要用户动手时（点「打开课程窗口 / 验证窗口 / 登录窗口」）由主应用显式 focus。
  window.on('ready-to-show', () => window.showInactive())

  // 远程页面自己发起的 window.open 一律拒绝：多窗口由 BrowserService 显式管理，
  // 不能让网页凭空多开一个无受控的窗口。
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url, { activate: false })
    return { action: 'deny' }
  })

  void window.loadURL('about:blank')

  return window
}
