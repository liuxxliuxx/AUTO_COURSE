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
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4'
}

export async function startFixtureServer(rootDir) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')

      // CAS 标准表单夹具：验证“GET execution → POST 凭据 → 302”请求链。
      if (url.pathname === '/login/cas-request') {
        if (req.method === 'POST') {
          let body = ''
          for await (const chunk of req) body += chunk
          const form = new URLSearchParams(body)
          const accepted =
            form.get('username') === '20260001' &&
            form.get('password') === 'Abc123456' &&
            form.get('execution') === 'fixture-execution' &&
            form.get('_eventId') === 'submit'
          if (accepted) {
            res.writeHead(302, {
              Location: '/login/cas-success'
            })
            res.end()
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<form id="loginForm">登录失败</form>')
          }
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<form method="post" id="loginForm">' +
            '<input name="username">' +
            '<input name="password" type="password">' +
            '<input name="execution" value="fixture-execution">' +
            '<input name="_eventId" value="submit">' +
            '</form>'
        )
        return
      }
      if (url.pathname === '/login/cas-success') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': 'fixture-sso=ok; Path=/; HttpOnly'
        })
        res.end('<!doctype html><title>SSO success</title>')
        return
      }

      // 大文件端点：用于测试「下载小于 1 MiB 视为鉴权失败」这条判据
      if (url.pathname.startsWith('/bigfile/')) {
        const size = Number.parseInt(url.searchParams.get('size') ?? '1200000', 10)
        const total = Number.isFinite(size) && size > 0 ? size : 1_200_000
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(total)
        })
        // 分块写出，避免一次性构造大 Buffer
        const chunk = Buffer.alloc(64 * 1024, 0x41)
        let sent = 0
        const pump = () => {
          while (sent < total) {
            const size = Math.min(chunk.length, total - sent)
            sent += size
            if (!res.write(chunk.subarray(0, size))) {
              res.once('drain', pump)
              return
            }
          }
          res.end()
        }
        pump()
        return
      }

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
