/**
 * PoC 实验 1c：绕过 Playwright，直接用裸 CDP 探针问 Electron 支持哪些 Domain。
 *
 * 目的是搞清楚 connectOverCDP 到底卡在哪一步：
 *   - Electron 是否支持浏览器级 Target.getTargets / attachToTarget？
 *   - 是否支持 Target.setAutoAttach（Playwright 依赖它）？
 *   - Runtime.evaluate 能不能在 attach 出来的 session 上正常执行？
 *
 * 用法：node scripts/poc/01c-raw-cdp-probe.mjs
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

const PORT = 9336
const TARGET = 'https://example.com/'

const userDataDir = mkdtempSync(join(tmpdir(), 'poc-probe-'))
const child = spawn(
  electronBin,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    join(root, 'scripts', 'poc', 'electron-host.cjs'),
    TARGET
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
)
child.stdout.on('data', (d) => process.stdout.write(`  [electron] ${String(d).trim()}\n`))
child.stderr.on('data', (d) => {
  const t = String(d).trim()
  if (t && !/DevTools listening/.test(t) && !/Warning|IMK|GPU/.test(t)) process.stderr.write(`  [err] ${t}\n`)
})

/** 极简 CDP 客户端：发命令、按 id 配对响应、收集事件。 */
class CdpSession {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          msg.error ? p.reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : p.resolve(msg.result)
        }
      } else {
        this.events.push(msg)
      }
    })
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 超时（10s）`))
      }, 10_000)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      this.ws.send(JSON.stringify(payload))
    })
  }

  waitForEvent(method, timeoutMs = 5_000) {
    const found = this.events.find((e) => e.method === method)
    if (found) return Promise.resolve(found)
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs
      const poll = setInterval(() => {
        const hit = this.events.find((e) => e.method === method)
        if (hit || Date.now() > deadline) {
          clearInterval(poll)
          resolve(hit ?? null)
        }
      }, 50)
    })
  }
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

let ws
try {
  // 等端口就绪
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
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!version) throw new Error('CDP 端口未就绪')

  ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('websocket 连接失败')), { once: true })
  })
  const cdp = new CdpSession(ws)

  // --- 1. 浏览器级目标管理 ---
  let targets = []
  try {
    const r = await cdp.send('Target.getTargets')
    targets = r.targetInfos ?? []
    record('Target.getTargets', true, `${targets.length} 个目标`)
    for (const t of targets) {
      console.log(`    · ${t.type} | ${t.url || '(空)'} | attached=${t.attached}`)
    }
  } catch (e) {
    record('Target.getTargets', false, e.message)
  }

  // --- 2. setAutoAttach（Playwright 依赖的能力）---
  try {
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    })
    const evt = await cdp.waitForEvent('Target.attachedToTarget', 4_000)
    record(
      'Target.setAutoAttach + attachedToTarget 事件',
      !!evt,
      evt ? '收到事件' : '命令被接受但 4s 内没有派发任何 attachedToTarget —— 这正是 Playwright 卡住的原因'
    )
  } catch (e) {
    record('Target.setAutoAttach', false, e.message)
  }

  // --- 3. 手动 attach 到页面 target ---
  const pageTarget = targets.find((t) => t.type === 'page')
  let sessionId = null
  if (pageTarget) {
    try {
      const r = await cdp.send('Target.attachToTarget', {
        targetId: pageTarget.targetId,
        flatten: true
      })
      sessionId = r.sessionId
      record('Target.attachToTarget(flatten)', true, `sessionId=${sessionId.slice(0, 12)}…`)
    } catch (e) {
      record('Target.attachToTarget(flatten)', false, e.message)
    }
  } else {
    record('找到 page target', false)
  }

  // --- 3.5 关键：setAutoAttach 带 waitForDebuggerOnStart 会让渲染器停在启动前，
  //         必须先放行，否则后续任何 Runtime.evaluate 都会挂住。---
  if (sessionId) {
    try {
      await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId)
      record('Runtime.runIfWaitingForDebugger', true)
    } catch (e) {
      record('Runtime.runIfWaitingForDebugger', false, e.message)
    }
  }

  // --- 4. 在 session 上跑 Runtime.evaluate ---
  if (sessionId) {
    try {
      const r = await cdp.send(
        'Runtime.evaluate',
        { expression: 'document.title + "|" + location.href', returnByValue: true },
        sessionId
      )
      record('session 上 Runtime.evaluate', true, JSON.stringify(r.result?.value))
    } catch (e) {
      record('session 上 Runtime.evaluate', false, e.message)
    }

    // --- 5. Playwright 真正需要的：DOM 查询 + 可交互性 ---
    try {
      const r = await cdp.send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const el = document.querySelector('h1');
            return el ? el.textContent.trim() : '(无 h1)';
          })()`,
          returnByValue: true
        },
        sessionId
      )
      record('DOM 查询', true, JSON.stringify(r.result?.value))
    } catch (e) {
      record('DOM 查询', false, e.message)
    }
  }

  console.log('\n--- 事件样本 ---')
  for (const e of cdp.events.slice(0, 8)) console.log(`  ${e.method} ${JSON.stringify(e.params ?? {}).slice(0, 120)}`)
} catch (error) {
  record('探针运行', false, error instanceof Error ? error.message : String(error))
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  child.kill('SIGKILL')
}

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
process.exitCode = failed.length ? 1 : 0
