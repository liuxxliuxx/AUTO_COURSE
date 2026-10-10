import { app, shell } from 'electron'
import { join } from 'node:path'
import metadata from '../../package.json'
import type { AppInfo, SupportResource } from '@shared/app-info'
export function appInfo(): AppInfo {
  return { name: metadata.productName, version: app.getVersion(), commit: __BUILD_COMMIT__, builtAt: __BUILD_TIME__,
    electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    platform: process.platform, arch: process.arch, homepage: metadata.homepage, issues: metadata.bugs.url,
    releases: `${metadata.homepage}/releases`, author: metadata.author, license: metadata.license, packaged: app.isPackaged }
}
export async function openSupport(resource: SupportResource): Promise<void> {
  if (resource === 'guide') {
    await shell.openExternal(metadata.documentation)
    return
  }
  if (resource === 'project') {
    await shell.openExternal(`${metadata.documentation.replace('/tree/', '/blob/')}/PROJECT.md`)
    return
  }
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const paths = { licenses: join(root, 'THIRD_PARTY_NOTICES.txt'), data: app.getPath('userData') }
  if (!Object.hasOwn(paths, resource)) throw new Error('未知帮助资源')
  const error = await shell.openPath(paths[resource])
  if (error) throw new Error(error)
}
export async function openProjectLink(resource: 'homepage' | 'issues' | 'releases'): Promise<void> {
  const links = { homepage: metadata.homepage, issues: metadata.bugs.url, releases: `${metadata.homepage}/releases` }
  if (!Object.hasOwn(links, resource)) throw new Error('未知项目链接')
  await shell.openExternal(links[resource])
}
