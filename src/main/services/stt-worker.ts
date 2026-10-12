/** SenseVoiceSmall via sherpa-onnx WASM, isolated from the Electron main thread. */
import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { ensureSttModels } from './stt-models'

const JOB_TIMEOUT_MS = 30 * 60 * 1000
const READY_TIMEOUT_MS = 15 * 60 * 1000

export interface SttStatus {
  available: boolean
  ready: boolean
  message: string
  model: string | null
  percent: number | null
}
export interface SttWorkerOptions {
  scriptPath: string
  modelDir: string
  /** Injected in protocol tests; production resolves the real WASM package. */
  modulePath?: string
  prepareModels?: typeof ensureSttModels
  readyTimeoutMs?: number
  jobTimeoutMs?: number
}
interface PendingJob {
  resolve: (text: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class SttWorker {
  private thread: Worker | null = null
  private ready = false
  private fatal: string | null = null
  private disposed = false
  private starting: Promise<void> | null = null
  private controller: AbortController | null = null
  private nextId = 1
  private pending = new Map<string, PendingJob>()
  private statusListeners = new Set<(status: SttStatus) => void>()
  private message = '语音模型尚未加载'
  private percent: number | null = null
  private rejectReady: ((error: Error) => void) | null = null

  constructor(private readonly options: SttWorkerOptions) {}

  getStatus(): SttStatus {
    const missing = !existsSync(this.options.scriptPath)
    return {
      available: !this.disposed && !missing && !this.fatal,
      ready: this.ready,
      message: this.disposed ? '转录已关闭' : missing ? '未找到 STT worker 脚本' : this.fatal ?? this.message,
      model: this.ready ? 'SenseVoiceSmall' : null,
      percent: this.percent,
    }
  }

  onStatus(listener: (status: SttStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private emitStatus(): void {
    for (const listener of this.statusListeners) {
      try { listener(this.getStatus()) } catch { /* subscriber isolation */ }
    }
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('SttWorker 已关闭')
    if (this.ready) return
    if (this.starting) return this.starting
    if (!existsSync(this.options.scriptPath)) throw new Error('未找到 STT worker 脚本')
    this.fatal = null
    this.controller = new AbortController()
    const controller = this.controller
    const timer = setTimeout(() => controller.abort(new Error('等待语音模型加载超时')), this.options.readyTimeoutMs ?? READY_TIMEOUT_MS)
    this.starting = this.initialize(controller.signal).catch(async error => {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.fail(failure)
      const thread = this.thread
      this.thread = null
      if (thread) await thread.terminate()
      throw failure
    }).finally(() => {
      clearTimeout(timer)
      this.starting = null
      this.controller = null
    })
    return this.starting
  }

  private async initialize(signal: AbortSignal): Promise<void> {
    this.message = '正在加载语音模型...'
    this.emitStatus()
    await (this.options.prepareModels ?? ensureSttModels)(this.options.modelDir, signal, message => {
      this.message = message
      this.emitStatus()
    })
    signal.throwIfAborted()
    this.message = '正在加载 SenseVoiceSmall（WASM）...'
    this.emitStatus()
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => finish(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      const finish = (error?: Error): void => {
        signal.removeEventListener('abort', abort)
        this.rejectReady = null
        if (error) reject(error)
        else resolve()
      }
      this.rejectReady = error => finish(error)
      const thread = new Worker(this.options.scriptPath, { workerData: {
        modelDir: this.options.modelDir,
        modulePath: this.options.modulePath ?? require.resolve('sherpa-onnx'),
      } })
      this.thread = thread
      thread.on('message', (message: { type?: string; id?: string; percent?: number; success?: boolean; text?: string; error?: string }) => {
        if (this.thread !== thread) return
        if (message.type === 'ready') {
          this.ready = true
          this.message = '转录就绪'
          this.emitStatus()
          finish()
        } else if (message.type === 'fatal') {
          this.fail(new Error(message.error ?? '模型加载失败'))
        } else if (message.type === 'progress') {
          this.percent = message.percent ?? null
          this.emitStatus()
        } else if (message.id) {
          const job = this.pending.get(message.id)
          if (!job) return
          clearTimeout(job.timer)
          this.pending.delete(message.id)
          if (message.success) job.resolve(message.text ?? '')
          else job.reject(new Error(message.error ?? '转录失败'))
        }
      })
      thread.on('error', error => { if (this.thread === thread) this.fail(error) })
      thread.on('exit', code => {
        if (this.thread !== thread) return
        this.thread = null
        this.fail(new Error(`STT Worker 已退出（${code}）`))
      })
    })
  }

  private fail(error: Error): void {
    this.ready = false
    this.fatal = error.message
    this.percent = null
    this.rejectReady?.(error)
    for (const job of this.pending.values()) {
      clearTimeout(job.timer)
      job.reject(error)
    }
    this.pending.clear()
    this.emitStatus()
  }

  async transcribe(wavPath: string): Promise<string> {
    await this.start()
    const thread = this.thread
    if (!thread || this.disposed) throw new Error('STT Worker 未运行')
    const id = `job-${this.nextId++}`
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Kill synchronous WASM work too; rejecting only the promise would leave it running.
        this.fail(new Error('转录超时'))
        this.thread = null
        void thread.terminate()
      }, this.options.jobTimeoutMs ?? JOB_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.percent = 0
      thread.postMessage({ id, input: wavPath })
    })
  }

  async stop(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const error = new Error('SttWorker 已关闭')
    this.controller?.abort(error)
    this.fail(error)
    const thread = this.thread
    this.thread = null
    if (thread) await thread.terminate()
    await this.starting?.catch(() => {})
    this.statusListeners.clear()
  }
}
