import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  ready: undefined as (() => void) | undefined,
  muted: vi.fn(), showInactive: vi.fn()
}))
vi.mock('electron', () => ({
  app: { setPath: vi.fn(), commandLine: { appendSwitch: vi.fn() }, whenReady: async () => {}, on: vi.fn() },
  session: { defaultSession: { on: vi.fn() } },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {
    webContents = { setAudioMuted: host.muted, setWindowOpenHandler: vi.fn() }
    showInactive = host.showInactive
    on(event: string, callback: () => void) { if (event === 'ready-to-show') host.ready = callback }
    loadURL = vi.fn()
  }
}))
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), appendFileSync: vi.fn() }))
import { startBrowserHost } from '../../src/main/automation/browser-host'

const originalArgv = [...process.argv]
beforeEach(() => { process.argv = [...originalArgv]; vi.clearAllMocks(); host.ready = undefined })
afterEach(() => { process.argv = [...originalArgv] })
describe('课程窗口播放与后台设置', () => {
  it.each([
    { background: false, muted: true },
    { background: true, muted: true },
    { background: true, muted: false },
    { background: false, muted: false }
  ])('后台=$background，静音=$muted', async ({ background, muted }) => {
    if (background) process.argv.push('--background-run')
    if (muted) process.argv.push('--mute-playback')
    await startBrowserHost()
    expect(host.muted).toHaveBeenCalledWith(muted)
    expect(host.ready).toBeTypeOf('function')
    host.ready!()
    expect(host.showInactive).toHaveBeenCalledTimes(background ? 0 : 1)
  })
})
