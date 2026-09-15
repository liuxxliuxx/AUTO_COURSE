/**
 * 应用本体启动流程。
 *
 * 职责：
 *  - 创建应用窗口（Vue 控制面板）
 *  - 装配 Service 容器并注册 typed IPC
 *  - 保证退出时清理所有子进程 / 浏览器 / Python worker
 *
 * 业务逻辑不在这个文件里，全部委托给 services/ 与 automation/。
 */

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { ServiceContainer } from './services/container'
import { registerIpcHandlers } from './ipc'
import { installApplicationMenu } from './menu'
import { createLogger } from './services/logger'

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
    title: '智慧树自动刷课',
    backgroundColor: '#0e191b',
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
