import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearApplicationCache } from '../../src/main/services/cache-service'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function root(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'ac-cache-')); roots.push(path); return path }
async function file(base: string, path: string, value = 'saved'): Promise<void> {
  const full = join(base, path)
  await mkdir(join(full, '..'), { recursive: true }); await writeFile(full, value)
}
const exists = async (path: string): Promise<boolean> => lstat(path).then(() => true, () => false)

describe('cache cleanup boundaries', () => {
  it('removes all workflow and legacy caches/downloads while preserving application data and login state', async () => {
    const base = await root(), clearUi = vi.fn(async () => {})
    const caches = ['browser-profile/Cache/data', 'browser-profile/Code Cache/js/data',
      'account-profiles/a/GPUCache/data', 'account-profiles/b/Cache/data',
      'account-profiles/b/Service Worker/CacheStorage/data', 'downloads/media.webm', 'workflow-downloads/run/media.mp4']
    const saved = ['credentials.bin', 'auto_course.db', 'models/sensevoice/model.onnx',
      'browser-profile/Cookies', 'browser-profile/Local Storage/leveldb/data', 'account-profiles/a/Network/Cookies',
      'account-profiles/b/IndexedDB/data', '课程录音/课程/结果.txt', 'settings.json', 'account-profiles/b/Preferences']
    for (const path of [...caches, ...saved]) await file(base, path)
    expect(await clearApplicationCache(base, clearUi)).toEqual({ bytes: caches.length * 5 })
    expect(clearUi).toHaveBeenCalledOnce()
    for (const path of caches) expect(await exists(join(base, path))).toBe(false)
    for (const path of saved) expect(await readFile(join(base, path), 'utf8')).toBe('saved')
  })
  it('is safe to repeat and does not create missing profile directories', async () => {
    const base = await root()
    expect(await clearApplicationCache(base, async () => {})).toEqual({ bytes: 0 })
    expect(await clearApplicationCache(base, async () => {})).toEqual({ bytes: 0 })
    expect(await exists(join(base, 'workflow-profiles'))).toBe(false)
  })
  it('does not traverse symlinked profiles, service worker directories or cache contents', async () => {
    const base = await root(), outside = await root()
    await file(outside, 'Cache/protected', 'keep')
    await file(base, 'account-profiles/local/Cache/normal')
    await symlink(outside, join(base, 'browser-profile'))
    await symlink(outside, join(base, 'account-profiles/linked'))
    await symlink(outside, join(base, 'account-profiles/local/Service Worker'))
    await symlink(outside, join(base, 'account-profiles/local/Cache/linked'))
    await clearApplicationCache(base, async () => {})
    expect(await readFile(join(outside, 'Cache/protected'), 'utf8')).toBe('keep')
    expect(await exists(join(base, 'account-profiles/local/Cache'))).toBe(false)
  })
  it('propagates cleanup failures without reporting success or deleting downloads', async () => {
    const base = await root()
    await file(base, 'downloads/media')
    await expect(clearApplicationCache(base, async () => { throw Error('缓存被占用') })).rejects.toThrow('缓存被占用')
    expect(await readFile(join(base, 'downloads/media'), 'utf8')).toBe('saved')
  })
})
