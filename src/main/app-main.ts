/**
 * 应用本体启动流程。
 *
 * 职责：
 *  - 创建应用窗口（Vue 控制面板）
 *  - 装配 Service 容器并注册 typed IPC
 *  - 保证退出时清理所有子进程 / 浏览器 / WASM worker
 *
 * 业务逻辑不在这个文件里，全部委托给 services/ 与 automation/。
 */

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { userDataDirectory } from './util/user-data'
import metadata from '../../package.json'
import { appInfo } from './support'
import { ServiceContainer } from './services/container'
import { registerIpcHandlers } from './ipc'
import { installApplicationMenu } from './menu'
import { createLogger } from './services/logger'
import { ClassicCourseRunner } from './automation/classic/classic-course-runner'
import { MapCourseRunner } from './automation/map/map-course-runner'
import { MasteryCourseRunner } from './automation/mastery/mastery-course-runner'
import type { TaskMode } from '@shared/types'
import type { CourseRunner, RunnerContext } from './automation/runner'

const logger = createLogger('app')

/** 开发模式下 electron-vite 注入的 renderer dev server 地址 */
const rendererDevUrl = process.env['ELECTRON_RENDERER_URL']

export const isDev = !app.isPackaged

/**
 * 构建产物路径。
 *
 * 不能写成 `join(__dirname, '../renderer/...')`：主进程被 rollup 拆成了
 * `out/main/index.js` + `out/main/chunks/*.js`，`__dirname` 会随代码落在哪个
 * chunk 而变。统一相对 app 根目录解析，dev 与 packaged 都成立。
 */
const appRoot = app.getAppPath()
const PRELOAD_ENTRY = join(appRoot, 'out', 'preload', 'index.js')
const RENDERER_ENTRY = join(appRoot, 'out', 'renderer', 'index.html')

let mainWindow: BrowserWindow | null = null
let container: ServiceContainer | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getContainer(): ServiceContainer {
  if (!container) {
    throw new Error('ServiceContainer accessed before app.whenReady()')
  }
  return container
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: metadata.productName,
    backgroundColor: '#f5f7fb',
    autoHideMenuBar: true,
    // macOS 下把系统标题栏内嵌，让红黄绿按钮浮在自己的顶栏上，
    // 避免「系统标题栏 + 应用顶栏」两层 chrome。
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: PRELOAD_ENTRY,
      // 控制面板窗口不加载远程内容，但仍然禁止 Node 直达渲染层。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // 支持鼠标侧键及系统前进/后退快捷操作
  window.on('app-command', (_event, cmd) => {
    if (cmd === 'browser-backward') {
      if (window.webContents.navigationHistory.canGoBack()) {
        window.webContents.navigationHistory.goBack()
      }
    } else if (cmd === 'browser-forward') {
      if (window.webContents.navigationHistory.canGoForward()) {
        window.webContents.navigationHistory.goForward()
      }
    }
  })

  // 外部链接一律交给系统浏览器，应用窗口本身永不导航到外部站点。
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (rendererDevUrl) {
    void window.loadURL(rendererDevUrl)
  } else {
    void window.loadFile(RENDERER_ENTRY)
  }

  window.on('closed', () => {
    mainWindow = null
  })

  return window
}

async function shutdown(): Promise<void> {
  logger.info('应用退出中，正在清理资源...')
  try {
    await container?.dispose()
    logger.info('资源清理完成')
  } catch (error) {
    logger.exception('资源清理出错', error)
  }
}

export function startApplication(): void {
  // v3 starts independently; honour isolated test profiles.
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    const base = app.getPath('appData')
    const directory = userDataDirectory(base)
    mkdirSync(directory, { recursive: true })
    app.setPath('userData', directory)
    app.setPath('sessionData', directory)
  }
  app.setName(metadata.productName)
  if (process.platform === 'win32') app.setAppUserModelId('com.autocourse.zhihuishu')
  app.setAboutPanelOptions({ applicationName: metadata.productName, applicationVersion: app.getVersion(),
    version: appInfo().commit, copyright: '© 2026 liuxxliuxx and InvalidNamee', website: metadata.homepage })

  // 单实例：第二个实例直接把已存在的窗口拉到前台。
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    container = new ServiceContainer()

    // Runner 选择：三类课程各自实现 CourseRunner，保持执行链隔离。
    container.setRunnerFactory((mode: TaskMode, _ctx: RunnerContext): CourseRunner => {
      if (mode === 'map') return new MapCourseRunner()
      if (mode === 'mastery') return new MasteryCourseRunner()
      // 'classic' 与 'transcribe-only' 共用传统课程流程：
      // 仅转录只是「不播放视频、直接下载音轨」，导航与列表解析完全一致
      // （v1 bot_core.py 里也是同一段循环，靠 _transcribe_only 分支区分）。
      return new ClassicCourseRunner()
    })

    await container.initialize()
    registerIpcHandlers(container)
    installApplicationMenu()

    mainWindow = createMainWindow()
    if (mainWindow) container.attachMainWindow(mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
        if (mainWindow) container?.attachMainWindow(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    // macOS 下保持常驻；其他平台直接退出。
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  let shuttingDown = false

  app.on('before-quit', (event) => {
    if (shuttingDown) return
    shuttingDown = true
    event.preventDefault()
    void shutdown().finally(() => app.exit(0))
  })
}
