/**
 * 回归测试：课程窗口不许抢焦点。
 *
 * 线上问题（2026-09-16）：课程窗口是自动打开的（每次运行、每次宿主重启都会开），
 * 但它用 `show: true` + `window.show()` 创建，会把用户当前 App 的焦点抢走。
 * 真机实测：前台是「访达」时打开课程窗口，前台立刻变成 Electron。
 *
 * 修复后的约定：
 *   - 自动路径（宿主启动 / 运行开始 / 宿主重启）只 `showInactive()`；
 *   - 只有用户主动点「打开课程窗口 / 验证窗口 / 登录窗口」才显式 focus。
 *
 * 为什么这里断言源码而不是行为：焦点是操作系统级状态，在单元测试里观察不到；
 * 行为验证放在 scripts/poc/focus-probe.mjs（需要图形会话，手动跑）。
 * 这条测试只负责钉住「谁有权聚焦」这条边界，防止以后又加回自动聚焦。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mainDir = join(root, 'src', 'main')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

const files = walk(mainDir).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const hostSource = files.find((file) => file.path.endsWith(join('automation', 'browser-host.ts')))!
const runtime = files.find((file) => file.path.endsWith(join('workflows', 'workflow-runtime.ts')))!
/** 注释里可以随便提历史写法，这里只钉代码本身 */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('课程窗口焦点策略', () => {
  it('宿主开窗只用 showInactive，不用会抢焦点的 show', () => {
    const source = code(hostSource.text)
    expect(source).toContain('showInactive()')
    expect(source).not.toMatch(/show:\s*true/)
    expect(source).not.toMatch(/window\.show\(\)/)
  })

  it('只有「打开课程窗口」这个用户主动入口会聚焦窗口', () => {
    const callers = files
      .filter((file) => file.text.includes('focusCourseWindow'))
      .map((file) => relative(root, file.path).replaceAll('\\', '/'))
    expect(callers.sort()).toEqual([
      'src/main/automation/browser-service.ts',
      'src/main/services/course-discovery-service.ts',
      'src/main/workflows/workflow-runtime.ts'
    ])
    expect(runtime.text).toContain('await current.browser.ensureSession();await current.browser.focusCourseWindow()')
  })
})
