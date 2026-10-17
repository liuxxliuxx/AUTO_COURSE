import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {} }))
import { BrowserService } from '../../src/main/automation/browser-service'

describe('课程窗口显示与隐藏', () => {
  it('未启动浏览器时返回不可用，不创建新窗口', async () => {
    const service = new BrowserService({ downloadDir: '/tmp/downloads', profileDir: '/tmp/profile' })
    expect(await service.windowVisibility()).toBeNull()
    expect(await service.windowVisibility(false)).toBeNull()
  })
  it('隐藏保留窗口与会话，最小化视为隐藏，显式打开可恢复', async () => {
    let visible = true, minimized = false
    const window = {
      isDestroyed: () => false, isVisible: () => visible, isMinimized: () => minimized,
      hide: vi.fn(() => { visible = false }),
      restore: vi.fn(() => { minimized = false }), show: vi.fn(() => { visible = true }),
      focus: vi.fn(), moveTop: vi.fn(), destroy: vi.fn(), close: vi.fn()
    }
    const service = new BrowserService({ downloadDir: '/tmp/downloads', profileDir: '/tmp/profile' })
    Object.assign(service, { electronApp: {
      evaluate: async (fn: (electron: unknown, arg?: unknown) => unknown, arg?: unknown) => fn({ BrowserWindow: { getAllWindows: () => [window] } }, arg)
    } })
    expect(await service.windowVisibility()).toBe(true)
    expect(await service.windowVisibility(false)).toBe(false)
    expect(window.close).not.toHaveBeenCalled()
    expect(window.destroy).not.toHaveBeenCalled()
    expect(await service.focusCourseWindow()).toBe(true)
    expect(await service.windowVisibility()).toBe(true)
    minimized = true
    expect(await service.windowVisibility()).toBe(false)
    await service.focusCourseWindow()
    expect(await service.windowVisibility()).toBe(true)
  })
})
