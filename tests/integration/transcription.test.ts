/**
 * 转录链路端到端测试。
 *
 * 用**假的 Python worker**（一个几十行的脚本，协议完全一致）替换 SenseVoice，
 * 这样整条链路 —— 页面录音 → 分批取块 → 落盘 → ffmpeg → 写 txt ——
 * 都能在没有模型、没有网络的情况下真实跑一遍。
 *
 * 真实模型只在人工冒烟时验证。
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { EventBus } from '../../src/main/services/event-bus'
import { TranscriptionService } from '../../src/main/services/transcription-service'
import { SttWorker, findPython } from '../../src/main/services/stt-worker'
import { findFfmpeg } from '../../src/main/services/media'
import { DEFAULT_SETTINGS } from '../../src/main/services/settings-service'
import type { AppSettings } from '../../src/shared/types'
import { RECORDING_DRAIN_TEST_JS } from './helpers/recording-js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, '..', 'fixtures')

const python = findPython()
const ffmpeg = findFfmpeg()

/** 假 worker：协议与 worker.py 完全一致，只是不做推理 */
function writeFakeWorker(path: string, text = '假转写结果'): void {
  writeFileSync(
    path,
    [
      'import sys, json',
      'print(json.dumps({"type": "ready", "model": "FakeModel", "device": "cpu"}), flush=True)',
      'for line in sys.stdin:',
      '    line = line.strip()',
      '    if not line:',
      '        continue',
      '    msg = json.loads(line)',
      '    if msg.get("type") == "shutdown":',
      '        break',
      '    print(json.dumps({"id": msg["id"], "success": True, "text": "' + text + '"}), flush=True)',
      ''
    ].join('\n'),
    'utf8'
  )
}

let workDir: string
let serveDir: string
let server: FixtureServer
let browser: Browser
let page: Page
let session: BrowserSession

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'ac-stt-'))
  serveDir = join(workDir, 'serve')
  cpSync(fixturesDir, serveDir, { recursive: true })

  // 生成一个 >1 MiB 的音频文件 —— 「仅转录」模式有「小于 1 MiB 视为鉴权失败」
  // 的判据，夹具里那个 9KB 的 tiny.webm 会被正确地拒绝。
  if (ffmpeg) {
    spawnSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=60',
        '-c:a',
        'libopus',
        '-b:a',
        '160k',
        join(serveDir, 'assets', 'long-audio.webm')
      ],
      { timeout: 60_000 }
    )
  }

  server = await startFixtureServer(serveDir)
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
  session = new BrowserSession(page, () => {})
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
  rmSync(workDir, { recursive: true, force: true })
})

// ============================================================================
// Worker 协议
// ============================================================================

describe('SttWorker 协议', () => {
  it('能启动 worker 并完成一次转写往返', async () => {
    if (!python) {
      expect.unreachable('未找到 Python 解释器')
    }
    const script = join(workDir, 'fake-worker.py')
    writeFakeWorker(script, '协议往返成功')

    const worker = new SttWorker({ pythonPath: python, scriptPath: script })
    try {
      await worker.start()
      expect(worker.getStatus().ready).toBe(true)

      const text = await worker.transcribe('/tmp/dummy.wav')
      expect(text).toBe('协议往返成功')
    } finally {
      await worker.stop()
    }
  }, 60_000)

  it('并发提交多个任务，结果各自对应', async () => {
    if (!python) expect.unreachable('未找到 Python 解释器')
    const script = join(workDir, 'fake-worker-2.py')
    writeFakeWorker(script, 'X')

    const worker = new SttWorker({ pythonPath: python, scriptPath: script })
    try {
      await worker.start()
      const results = await Promise.all([
        worker.transcribe('/a.wav'),
        worker.transcribe('/b.wav'),
        worker.transcribe('/c.wav')
      ])
      expect(results).toEqual(['X', 'X', 'X'])
    } finally {
      await worker.stop()
    }
  }, 60_000)

  it('模型加载失败时给出致命状态而不是静默失败', async () => {
    if (!python) expect.unreachable('未找到 Python 解释器')
    const script = join(workDir, 'fatal-worker.py')
    writeFileSync(
      script,
      'import sys, json\nprint(json.dumps({"type": "fatal", "error": "模型加载失败: 测试"}), flush=True)\n',
      'utf8'
    )

    const worker = new SttWorker({ pythonPath: python, scriptPath: script })
    await expect(worker.start()).rejects.toThrow(/模型加载失败/)
    expect(worker.getStatus().available).toBe(false)
    await worker.stop()
  }, 60_000)

  it('未找到 Python 时状态里明说不可用', () => {
    const worker = new SttWorker({ pythonPath: null, scriptPath: '/nope/worker.py' })
    const status = worker.getStatus()
    expect(status.available).toBe(false)
    expect(status.message).toContain('Python')
  })

  it('脚本不存在时状态里明说不可用', () => {
    const worker = new SttWorker({ pythonPath: python, scriptPath: '/definitely/not/here.py' })
    expect(worker.getStatus().available).toBe(false)
    expect(worker.getStatus().message).toContain('worker 脚本')
  })
})

// ============================================================================
// 页面录音 → 取块 → 落盘
// ============================================================================

/** 页面侧录音脚本必须先验证可用（headless 与 Electron 行为可能不同） */
describe('页面侧录音能力', () => {
  it('captureStream + MediaRecorder 能录到音轨', async () => {
    await page.goto(`${server.origin}/classic-course.html`)
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#courseVideo') as HTMLVideoElement | null
        return !!v && Number.isFinite(v.duration) && v.duration > 0
      },
      null,
      { timeout: 20_000 }
    )
    await page.locator('#courseVideo').evaluate((el) => (el as HTMLVideoElement).play())
    await page.waitForTimeout(500)

    const bytes = await page.evaluate(RECORDING_DRAIN_TEST_JS)
    expect(bytes, '录到的字节数为 0').toBeGreaterThan(0)
  }, 60_000)
})

// ============================================================================
// TranscriptionService 端到端（假 worker）
// ============================================================================

describe('TranscriptionService', () => {
  const makeService = (settings: Partial<AppSettings> = {}): TranscriptionService => {
    const script = join(workDir, 'svc-worker.py')
    if (!existsSync(script)) writeFakeWorker(script, '端到端转写结果')

    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      transcribeEnabled: true,
      brushEnabled: true,
      transcribeBaseDir: workDir,
      courseNote: '测试课程',
      ...settings
    }

    return new TranscriptionService({
      bus: new EventBus(),
      getSettings: () => merged,
      worker: { pythonPath: python, scriptPath: script }
    })
  }

  it('关闭转录时不会启动 worker', async () => {
    const service = makeService({ transcribeEnabled: false, brushEnabled: true })
    const usable = await service.configure(
      { ...DEFAULT_SETTINGS, transcribeEnabled: false, brushEnabled: true },
      false
    )
    expect(usable).toBe(false)
    expect(service.getStatus().message).toContain('未启用')
    await service.dispose()
  })

  it('仅转录：下载 → 提取音轨 → 转写 → 写出 txt', async () => {
    const service = makeService()
    const settings = {
      ...DEFAULT_SETTINGS,
      transcribeEnabled: true,
      transcribeBaseDir: workDir,
      courseNote: '测试课程'
    }
    const usable = await service.configure(settings, true)
    expect(usable).toBe(true)

    // 夹具页面里的 <video src> 是 http 直链，「仅转录」会去下载它
    await page.goto(`${server.origin}/classic-course.html`)
    await page.locator('#courseVideo').evaluate((el) => {
      ;(el as HTMLVideoElement).setAttribute('src', '/assets/long-audio.webm')
    })
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#courseVideo') as HTMLVideoElement | null
        return !!v && Number.isFinite(v.duration) && v.duration > 0
      },
      null,
      { timeout: 30_000 }
    )

    const ok = await service.transcribeOnly(session, '第 1 讲 绪论')
    expect(ok, service.getStatus().message).toBe(true)

    const txt = join(workDir, '课程录音', '测试课程', '第 1 讲 绪论.txt')
    expect(existsSync(txt)).toBe(true)

    const content = readFileSync(txt, 'utf8')
    expect(content).toContain('# 课程: 测试课程')
    expect(content).toContain('# 课时: 第 1 讲 绪论')
    expect(content).toContain('# 模型: SenseVoiceSmall')
    expect(content).toContain('端到端转写结果')

    await service.dispose()
  }, 180_000)

  it('刷课 + 转录：页面录音 → 取块 → ffmpeg → 转写', async () => {
    const service = makeService()
    const settings = {
      ...DEFAULT_SETTINGS,
      transcribeEnabled: true,
      transcribeBaseDir: workDir,
      courseNote: '录音课程'
    }
    expect(await service.configure(settings, false)).toBe(true)

    await page.goto(`${server.origin}/classic-course.html`)
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#courseVideo') as HTMLVideoElement | null
        return !!v && Number.isFinite(v.duration) && v.duration > 0
      },
      null,
      { timeout: 20_000 }
    )
    await page.locator('#courseVideo').evaluate((el) => (el as HTMLVideoElement).play())
    await page.waitForTimeout(300)

    await service.onVideoBegin(session, '第 2 讲 录音测试')
    await page.waitForTimeout(2000)
    await service.onVideoEnd('第 2 讲 录音测试')

    const txt = join(workDir, '课程录音', '录音课程', '第 2 讲 录音测试.txt')
    expect(existsSync(txt), `状态: ${service.getStatus().message}`).toBe(true)
    expect(readFileSync(txt, 'utf8')).toContain('端到端转写结果')

    await service.dispose()
  }, 180_000)

  it('课程名与课时名会被净化成合法文件名', async () => {
    const service = makeService()
    const settings = {
      ...DEFAULT_SETTINGS,
      transcribeEnabled: true,
      transcribeBaseDir: workDir,
      courseNote: '课程:测试/一'
    }
    expect(await service.configure(settings, true)).toBe(true)

    await page.goto(`${server.origin}/classic-course.html`)
    await page.locator('#courseVideo').evaluate((el) => {
      ;(el as HTMLVideoElement).setAttribute('src', '/assets/long-audio.webm')
    })
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#courseVideo') as HTMLVideoElement | null
        return !!v && Number.isFinite(v.duration) && v.duration > 0
      },
      null,
      { timeout: 30_000 }
    )

    expect(await service.transcribeOnly(session, '第 3 讲: 测试')).toBe(true)

    // '课程:测试/一' → '课程_测试_一'；'第 3 讲: 测试' → '第 3 讲_测试'
    // （':' 变下划线后与后面的空格合成一段，被 [_ ]{2,} 折叠成一个下划线）
    expect(existsSync(join(workDir, '课程录音', '课程_测试_一', '第 3 讲_测试.txt'))).toBe(true)
    await service.dispose()
  }, 180_000)

  it('临时 WAV 在处理完成后被清理（不像 v1 那样永久保留）', async () => {
    const service = makeService()
    const settings = {
      ...DEFAULT_SETTINGS,
      transcribeEnabled: true,
      transcribeBaseDir: workDir,
      courseNote: '临时文件课程'
    }
    expect(await service.configure(settings, true)).toBe(true)

    await page.goto(`${server.origin}/classic-course.html`)
    await page.locator('#courseVideo').evaluate((el) => {
      ;(el as HTMLVideoElement).setAttribute('src', '/assets/long-audio.webm')
    })
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#courseVideo') as HTMLVideoElement | null
        return !!v && Number.isFinite(v.duration) && v.duration > 0
      },
      null,
      { timeout: 30_000 }
    )

    expect(await service.transcribeOnly(session, '第 4 讲')).toBe(true)

    const tempDir = join(workDir, '课程录音', '.temp')
    const leftovers = existsSync(tempDir)
      ? (await import('node:fs')).readdirSync(tempDir).filter((f) => !f.startsWith('.'))
      : []
    expect(leftovers).toEqual([])

    await service.dispose()
  }, 180_000)
})
