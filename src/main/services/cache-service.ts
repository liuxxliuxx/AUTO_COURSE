import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

// Explicit Chromium cache directories; cookies, local storage and preferences are preserved.
const PROFILE_CACHES = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache']

async function directory(path: string): Promise<boolean> {
  try { return (await lstat(path)).isDirectory() } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
async function size(path: string): Promise<number> {
  try {
    const info = await lstat(path)
    if (!info.isDirectory()) return info.size // Never follow symbolic links.
    const sizes = await Promise.all((await readdir(path)).map(name => size(join(path, name))))
    return sizes.reduce((sum, bytes) => sum + bytes, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

/** Called only while workflow launches are locked and all Browser Hosts have exited. */
export async function clearApplicationCache(userData: string, clearUiCache: () => Promise<void>): Promise<{ bytes: number }> {
  await clearUiCache()
  const targets = ['downloads', 'workflow-downloads'].map(name => join(userData, name))
  const profiles = [join(userData, 'browser-profile')]
  const workflows = join(userData, 'workflow-profiles')
  if (await directory(workflows)) {
    for (const name of await readdir(workflows)) profiles.push(join(workflows, name))
  }
  for (const profile of profiles) {
    if (!await directory(profile)) continue
    targets.push(...PROFILE_CACHES.map(name => join(profile, name)))
    const workers = join(profile, 'Service Worker')
    if (await directory(workers)) targets.push(join(workers, 'CacheStorage'), join(workers, 'ScriptCache'))
  }
  let bytes = 0
  for (const target of targets) {
    const removed = await size(target)
    await rm(target, { recursive: true, force: true })
    bytes += removed
  }
  return { bytes }
}
