/**
 * 应用菜单。
 *
 * 只保留最小集合：开发工具、重载、退出。
 * 业务操作全部在 Vue 界面里，不放菜单。
 */

import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { openSupport, openProjectLink } from './support'
import { isDev } from './app-main'

export function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 AUTO_COURSE', click: () => app.showAboutPanel() },
        { label: '用户文档', click: () => { void openSupport('guide').catch(() => {}) } },
        { label: '第三方许可证', click: () => { void openSupport('licenses').catch(() => {}) } },
        { label: '项目主页', click: () => { void openProjectLink('homepage').catch(() => {}) } },
        { label: '查看发布版本', click: () => { void openProjectLink('releases').catch(() => {}) } }
      ]
    }
  ]

  if (!isDev) {
    // 生产环境隐藏重载/开发者工具入口
    const viewMenu = template.find((item) => item.label === '视图')
    if (viewMenu && Array.isArray(viewMenu.submenu)) {
      viewMenu.submenu = [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }]
    }
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
