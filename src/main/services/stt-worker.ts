/**
 * Python STT Worker 的 Node 侧桥接。
 *
 * 协议见 python/transcriber/worker.py 与 handoff §20：stdin/stdout NDJSON。
 * 进程常驻，模型只加载一次。
 *
 * 这个文件对 worker 的唯一假设是「喂 WAV 拿文本」——
 * 它不知道 WAV 是怎么来的，也不知道课程、验证码、数据库的存在。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { createLogger } from './logger'

const logger = createLogger('stt-worker')

/** 单条任务的超时：一节课最长按 30 分钟算 */
const JOB_TIMEOUT_MS = 30 * 60 * 1000

/** 等待模型加载的上限（首次运行可能要下载权重） */
const READY_TIMEOUT_MS = 10 * 60 * 1000

interface PendingJob {
  resolve: (text: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface SttStatus {
  available: boolean
  ready: boolean
  message: string
  pythonPath: string | null
  model: string | null
}

/** 按平台找 Python 解释器。 */
export function findPython(): string | null {
  const names =
    process.platform === 'win32' ? ['python.exe', 'python3.exe', 'py.exe'] : ['python3', 'python']

  const pathEntries = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  for (const name of names) {
    for (const dir of pathEntries) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }

  // macOS 上常见的几个固定位置
  if (process.platform === 'darwin') {
    for (const candidate of [
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3'
    ]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

export class SttWorker {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, PendingJob>()
  private nextId = 1
  private buffer = ''
  private ready = false
  private fatal: string | null = null
  private starting: Promise<void> | null = null
  private disposed = false

  private statusListeners = new Set<(status: SttStatus) => void>()
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = []

  readonly pythonPath: string | null
  readonly scriptPath: string

  /**
   * 路径由调用方注入（Electron 侧才知道 app 路径与 resources 路径），
   * 这样本模块不 import electron，可以在普通 Node 里被测试。
   */
  constructor(options: { pythonPath: string | null; scriptPath: string }) {
    this.pythonPath = options.pythonPath
    this.scriptPath = options.scriptPath
  }

  getStatus(): SttStatus {
    if (!this.pythonPath) {
      return {
        available: false,
        ready: false,
        message: '未找到 Python 解释器，语音转文字不可用',
        pythonPath: null,
        model: null
      }
    }
    if (!existsSync(this.scriptPath)) {
      return {
        available: false,
        ready: false,
        message: `未找到 STT worker 脚本: ${this.scriptPath}`,
        pythonPath: this.pythonPath,
        model: null
      }
    }
    if (this.fatal) {
      return {
        available: false,
        ready: false,
        message: this.fatal,
        pythonPath: this.pythonPath,
        model: null
      }
    }
    return {
      available: true,
      ready: this.ready,
      message: this.ready ? '转录就绪' : '正在加载语音模型...',
      pythonPath: this.pythonPath,
      model: this.ready ? 'SenseVoiceSmall' : null
    }
  }

  onStatus(listener: (status: SttStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private emitStatus(): void {
    const status = this.getStatus()
    for (const listener of this.statusListeners) {
      try {
        listener(status)
      } catch {
        /* 订阅者自身的问题 */
      }
    }
  }

  // ---------------------------------------------------------------- 生命周期

  /** 启动 worker 并等待模型就绪。重复调用是幂等的。 */
  async start(): Promise<void> {
    if (this.ready) return
    if (this.starting) return this.starting
    this.starting = this.spawnAndWait().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async spawnAndWait(): Promise<void> {
    if (this.disposed) throw new Error('SttWorker 已关闭')

    const status = this.getStatus()
    if (!status.available) {
      throw new Error(status.message)
    }

    logger.info(`启动 STT Worker: ${this.pythonPath} ${this.scriptPath}`)

    const child = spawn(this.pythonPath as string, ['-u', this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // 强制 UTF-8，避免 Windows 上中文乱码
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
    })
    this.child = child

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk))

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        const text = line.trim()
        if (text) logger.info(`[stt] ${text}`)
      }
    })

    child.on('exit', (code, signal) => {
      logger.warn(`STT Worker 退出 code=${code} signal=${signal}`)
      this.ready = false
      this.child = null
      const error = new Error('STT Worker 进程已退出')
      for (const job of this.pending.values()) {
        clearTimeout(job.timer)
        job.reject(error)
      }
      this.pending.clear()
      for (const waiter of this.readyWaiters) waiter.reject(error)
      this.readyWaiters = []
      this.emitStatus()
    })

    child.on('error', (error) => {
      logger.exception('STT Worker 启动失败', error)
      this.fatal = `STT Worker 启动失败: ${error.message}`
      this.emitStatus()
    })

    this.emitStatus()

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`等待语音模型加载超时（${READY_TIMEOUT_MS / 1000}s）`))
      }, READY_TIMEOUT_MS)

      this.readyWaiters.push({
        resolve: () => {
          clearTimeout(timer)
          this.ready = true
          this.emitStatus()
          resolve()
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
    })
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk

    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line) this.handleMessage(line)
      newlineIndex = this.buffer.indexOf('\n')
    }
  }

  private handleMessage(line: string): void {
    let message: {
      type?: string
      id?: string
      success?: boolean
      text?: string
      error?: string
      model?: string
      device?: string
    }
    try {
      message = JSON.parse(line)
    } catch {
      logger.warn(`STT Worker 输出非 JSON: ${line.slice(0, 200)}`)
      return
    }

    // 控制消息
    if (message.type === 'ready') {
      logger.info(`STT Worker 就绪（模型 ${message.model}，设备 ${message.device}）`)
      for (const waiter of this.readyWaiters) waiter.resolve()
      this.readyWaiters = []
      return
    }
    if (message.type === 'fatal') {
      this.fatal = message.error ?? '模型加载失败'
      logger.error(`STT Worker 致命错误: ${this.fatal}`)
      for (const waiter of this.readyWaiters) waiter.reject(new Error(this.fatal))
      this.readyWaiters = []
      this.emitStatus()
      return
    }

    // 任务结果
    const id = message.id
    if (!id) return
    const job = this.pending.get(id)
    if (!job) {
      logger.debug(`收到未知任务的结果: ${id}`)
      return
    }
    this.pending.delete(id)
    clearTimeout(job.timer)

    if (message.success) {
      job.resolve(message.text ?? '')
    } else {
      job.reject(new Error(message.error ?? '转录失败'))
    }
  }

  // ------------------------------------------------------------------ 任务

  /** 提交一个 WAV 转写任务，返回文本。同一时刻只跑一个（worker 是单线程的）。 */
  async transcribe(wavPath: string): Promise<string> {
    await this.start()

    if (!this.child) throw new Error('STT Worker 未运行')

    const id = `job-${this.nextId++}`
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`转录超时（${JOB_TIMEOUT_MS / 60000} 分钟）`))
      }, JOB_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      this.child?.stdin.write(`${JSON.stringify({ id, input: wavPath })}\n`)
    })
  }

  /** 可靠关闭：先礼貌请求退出，超时再杀。 */
  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.ready = false
    this.disposed = true

    for (const job of this.pending.values()) {
      clearTimeout(job.timer)
      job.reject(new Error('STT Worker 已关闭'))
    }
    this.pending.clear()

    if (!child) return

    try {
      child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
      child.stdin.end()
    } catch {
      /* 进程可能已经没了 */
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        logger.warn('STT Worker 未在 5s 内退出，强制结束')
        child.kill('SIGKILL')
        resolve()
      }, 5_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}
