import { Worker } from 'node:worker_threads'
import { join } from 'node:path'

export interface GlyphPrediction {
  status: string
  targetId: string | null
  pointInImage: { x: number; y: number } | null
  objects: Array<{ id: string; bbox_xyxy: number[] }>
}
export interface GlyphInput { bytes: Uint8Array; width: number; height: number; instruction: string }
export interface GlyphRecognizer {
  recognize(input: GlyphInput, shouldStop: () => boolean): Promise<GlyphPrediction>
  dispose(): void
}

/** Lazy, page-owned worker. A timeout or stop rejects every job and releases the thread. */
export class GlyphWorker implements GlyphRecognizer {
  private thread: Worker | null = null
  private nextId = 0
  private readonly pending = new Map<number, { reject: (error: Error) => void }>()
  private disposed = false
  constructor(private readonly options: { scriptPath: string; libraryPath: string; modelRoot: string; timeoutMs?: number }) {}

  async recognize(input: GlyphInput, shouldStop: () => boolean): Promise<GlyphPrediction> {
    if (this.disposed || shouldStop()) throw new Error('离线识别已停止')
    if (!this.thread) {
      const thread = new Worker(this.options.scriptPath, { workerData: this.options })
      this.thread = thread
      thread.on('error', () => this.dispose())
      thread.on('exit', () => this.dispose())
    }
    const thread = this.thread
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, result?: GlyphPrediction): void => {
        if (!this.pending.delete(id)) return
        clearTimeout(timeout); clearInterval(stopTimer)
        thread.off('message', message)
        if (error) reject(error)
        else resolve(result!)
      }
      const message = (event: { id: number; result?: GlyphPrediction; error?: string }): void => {
        if (event.id === id) finish(event.error ? new Error(event.error) : undefined, event.result)
      }
      const timeout = setTimeout(() => this.dispose(), this.options.timeoutMs ?? 45_000)
      const stopTimer = setInterval(() => { if (shouldStop()) this.dispose() }, 80)
      this.pending.set(id, { reject: error => finish(error) })
      thread.on('message', message)
      try { thread.postMessage({ id, ...input }) } catch { this.dispose() }
    })
  }
  dispose(): void {
    this.disposed = true
    const thread = this.thread
    this.thread = null
    for (const job of [...this.pending.values()]) job.reject(new Error('离线识别已停止、超时或不可用'))
    if (thread) void thread.terminate()
  }
}

export async function createGlyphWorker(): Promise<GlyphRecognizer> {
  const { app } = await import('electron')
  const root = app.getAppPath()
  return new GlyphWorker({
    scriptPath: join(app.isPackaged ? process.resourcesPath : join(root, 'resources'), 'glyph-worker.cjs'),
    libraryPath: join(root, 'resources/glyph-recognition/js/src/index.mjs'),
    modelRoot: app.isPackaged ? join(process.resourcesPath, 'glyph-recognition') : join(root, 'resources/glyph-recognition')
  })
}
