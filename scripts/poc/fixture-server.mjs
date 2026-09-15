/**
 * 夹具静态服务器。
 *
 * 用 http:// 而不是 file:// 提供夹具，原因：
 *  - file:// 是不透明源，cookie / localStorage / download 行为与真实站点不一致；
 *  - Playwright 在 file:// 页面上的 download 事件不可靠。
 * 真实目标站点全部是 https，所以 http 服务是更忠实的近似。
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8'
}

export async function startFixtureServer(rootDir) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')

      // 附件下载端点：用于验证宿主侧的 will-download 落盘
      // （Playwright 的 download 事件在 Electron 下不可用，见 fixture 说明）
      if (url.pathname.startsWith('/attachment/')) {
        const name = url.pathname.slice('/attachment/'.length) || 'sample.bin'
        const body = Buffer.from(`attachment payload for ${name}`.repeat(64))
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${name}"`
        })
        res.end(body)
        return
      }

      // 防目录穿越
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
      const file = join(rootDir, rel === '/' ? 'index.html' : rel)
      const body = await readFile(file)
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store'
      })
      res.end(body)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}
