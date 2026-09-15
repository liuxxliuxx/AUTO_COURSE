/**
 * PoC 实验 1d：Electron 的 Target session 到底能不能跑渲染器层命令？
 *
 * 1c 已确认：浏览器级 Target.getTargets / setAutoAttach / attachToTarget 都成立，
 * 但拿到的 sessionId 发 Runtime.* 一律超时。
 * 这里把几种可能的路由方式都试一遍，确认这不是用法问题。
 *
 * 用法：node scripts/poc/01d-session-routing.mjs
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const electronBin = require('electron')

const PORT = 9337
const userDataDir = mkdtempSync(join(tmpdir(), 'poc-route-'))
const child = spawn(
  electronBin,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    join(root, 'scripts', 'poc', 'electron-host.cjs'),
    'https://example.com/'
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
)
child.stderr.on('data', () => {})

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 1
    this.pending = new Map()
    this.events = []
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id !== undefined) {
        const p = this.pending.get(m.id)
        if (p) {
          this.pending.delete(m.id)
          m.error ? p.reject(new Error(`${m.error.code}: ${m.error.message}`)) : p.resolve(m.result)
        }
      } else this.events.push(m)
    })
  }
  send(method, params = {}, sessionId, timeoutMs = 4_000) {
    const id = this.id++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('超时'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(t), resolve(v)),
        reject: (e) => (clearTimeout(t), reject(e))
      })
      this.ws.send(JSON.stringify(payload))
    })
  }
}

const rows = []
const tryIt = async (label, fn) => {
  try {
    const r = await fn()
    rows.push([label, 'OK', JSON.stringify(r).slice(0, 90)])
  } catch (e) {
    rows.push([label, 'FAIL', e.message])
  }
}

let ws
try {
  let version
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) {
        version = await res.json()
        break
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('ws 失败')), { once: true })
  })
  const cdp = new Cdp(ws)

  const { targetInfos } = await cdp.send('Target.getTargets')
  const page = targetInfos.find((t) => t.type === 'page')
  console.log(`page target: ${page?.targetId}\n`)

  // A. flatten session（1c 已验证超时）
  let flatSession = null
  await tryIt('A. attachToTarget(flatten:true)', async () => {
    const r = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
    flatSession = r.sessionId
    return { sessionId: r.sessionId.slice(0, 10) }
  })

  await tryIt('A2. session → Runtime.enable', () => cdp.send('Runtime.enable', {}, flatSession))
  await tryIt('A3. session → Page.enable', () => cdp.send('Page.enable', {}, flatSession))
  await tryIt('A4. session → Runtime.evaluate', () =>
    cdp.send('Runtime.evaluate', { expression: '1+1', returnByValue: true }, flatSession)
  )

  // B. 非 flatten：用 Target.sendMessageToTarget 转发
  await tryIt('B. attachToTarget(flatten:false)', async () => {
    const r = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: false })
    return { sessionId: r.sessionId.slice(0, 10) }
  })

  // C. 直接连页面级 websocket，跑渲染器命令
  const listRes = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const list = await listRes.json()
  const pageWs = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
  if (pageWs) {
    const ws2 = new WebSocket(pageWs)
    await new Promise((res, rej) => {
      ws2.addEventListener('open', res, { once: true })
      ws2.addEventListener('error', () => rej(new Error('页面 ws 失败')), { once: true })
    })
    const cdp2 = new Cdp(ws2)
    await tryIt('C. 页面级 ws → Runtime.evaluate', () =>
      cdp2.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
    )
    await tryIt('C2. 页面级 ws → DOM 查询', () =>
      cdp2.send('Runtime.evaluate', {
        expression: "document.querySelector('h1')?.textContent",
        returnByValue: true
      })
    )
    ws2.close()
  } else {
    rows.push(['C. 页面级 ws', 'FAIL', '/json/list 无 page 端点'])
  }
} catch (e) {
  rows.push(['探针', 'FAIL', e.message])
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  child.kill('SIGKILL')
}

console.log('结果:')
for (const [label, status, detail] of rows) {
  console.log(`  ${status === 'OK' ? '✓' : '✗'} ${label.padEnd(34)} ${detail}`)
}
