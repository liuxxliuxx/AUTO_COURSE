import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SttWorker } from '../../src/main/services/stt-worker'
import { ensureSttModels } from '../../src/main/services/stt-models'

const require = createRequire(import.meta.url)
const { transcribeFile } = require('../../resources/stt/worker.cjs')
const dirs: string[] = []
const workers: SttWorker[] = []
function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-wasm-test-')); dirs.push(dir); return dir
}
function fakeWorker(code: string, options: { readyTimeoutMs?: number; jobTimeoutMs?: number } = {}): SttWorker {
  const dir = directory()
  const scriptPath = join(dir, 'worker.cjs')
  writeFileSync(scriptPath, `const {parentPort}=require('node:worker_threads');${code}`)
  const worker = new SttWorker({ scriptPath, modelDir: dir, prepareModels: async () => {}, ...options })
  workers.push(worker)
  return worker
}
afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.stop()))
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }))
})

describe('WASM worker lifecycle', () => {
  it('startup is shared; jobs keep distinct IDs and progress', async () => {
    const worker = fakeWorker(`parentPort.postMessage({type:'ready'});parentPort.on('message',m=>{
      parentPort.postMessage({type:'progress',id:m.id,percent:50});
      parentPort.postMessage({id:m.id,success:true,text:m.input});
    });`)
    const statuses: number[] = []
    worker.onStatus(s => { if (s.percent !== null) statuses.push(s.percent) })
    await Promise.all([worker.start(), worker.start()])
    expect(await Promise.all([worker.transcribe('a'), worker.transcribe('b')])).toEqual(['a', 'b'])
    expect(statuses).toContain(50)
  })
  it('startup crashes reject immediately', async () => {
    const worker = fakeWorker("throw new Error('broken model')")
    await expect(worker.start()).rejects.toThrow('broken model')
    expect(worker.getStatus().available).toBe(false)
  })
  it('startup timeout terminates an unresponsive thread', async () => {
    const worker = fakeWorker('while(true) {}', { readyTimeoutMs: 200 })
    await expect(worker.start()).rejects.toThrow('加载超时')
  })
  it('stop cancels startup and prevents restarting', async () => {
    const worker = fakeWorker('setInterval(()=>{},1000)')
    const starting = expect(worker.start()).rejects.toThrow('已关闭')
    await worker.stop()
    await starting
    await expect(worker.start()).rejects.toThrow('已关闭')
  })
  it('job timeout kills synchronous work and rejects every pending job', async () => {
    const worker = fakeWorker("parentPort.postMessage({type:'ready'});parentPort.on('message',()=>{while(true){}})", { jobTimeoutMs: 200 })
    const jobs = [expect(worker.transcribe('a')).rejects.toThrow('超时'), expect(worker.transcribe('b')).rejects.toThrow('超时')]
    await Promise.all(jobs)
    expect(worker.getStatus().ready).toBe(false)
  })
  it('stopping cancels a model download before a thread exists', async () => {
    const worker = new SttWorker({ scriptPath: resolve('resources/stt/worker.cjs'), modelDir: directory(),
      prepareModels: async (_dir, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    })
    workers.push(worker)
    const result = expect(worker.start()).rejects.toThrow('已关闭')
    await worker.stop()
    await result
  })
})

describe('model cache', () => {
  const bytes = 'model-data'
  const files = [{ name: 'model.onnx', url: 'https://example.test/model', minBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]
  it('downloads atomically and reuses verified files offline', async () => {
    const dir = directory()
    const fetcher = vi.fn(async () => new Response(bytes)) as unknown as typeof fetch
    await ensureSttModels(dir, new AbortController().signal, () => {}, fetcher, files)
    await ensureSttModels(dir, new AbortController().signal, () => {}, fetcher, files)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(readFileSync(join(dir, 'model.onnx'), 'utf8')).toBe(bytes)
    expect(readdirSync(dir)).toEqual(['model.onnx'])
  })
  it('rejects corrupted downloads and repairs a corrupted cached model', async () => {
    const dir = directory()
    writeFileSync(join(dir, 'model.onnx'), 'corrupted!')
    await expect(ensureSttModels(dir, new AbortController().signal, () => {}, (async () => new Response('incorrect!')) as typeof fetch, files)).rejects.toThrow('校验失败')
    expect(readdirSync(dir)).toEqual(['model.onnx'])
    await ensureSttModels(dir, new AbortController().signal, () => {}, (async () => new Response(bytes)) as typeof fetch, files)
    expect(readFileSync(join(dir, 'model.onnx'), 'utf8')).toBe(bytes)
  })
  it('aborting a download cleans up partial files', async () => {
    const dir = directory()
    const controller = new AbortController()
    const fetcher = (async () => new Response(new ReadableStream({ start(stream) {
      stream.enqueue(new TextEncoder().encode('part'))
      setTimeout(() => controller.abort(new Error('cancelled')), 10)
    } }))) as typeof fetch
    await expect(ensureSttModels(dir, controller.signal, () => {}, fetcher, files)).rejects.toThrow('cancelled')
    expect(readdirSync(dir)).toEqual([])
  })
})

function wavFile(seconds: number): string {
  const samples = 16000 * seconds
  const b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40)
  const path = join(directory(), 'audio.wav'); writeFileSync(path, b); return path
}

describe('bounded WAV inference', () => {
  it('feeds small blocks, flushes the last segment and resets between files', () => {
    const input = wavFile(65)
    let queued = false
    let total = 0
    let maxBlock = 0
    const free = vi.fn()
    const recognizer = { createStream: () => ({ acceptWaveform: vi.fn(), free }), decode: vi.fn(), getResult: () => ({ text: '<|zh|>课程文字' }) }
    const vad = { reset: vi.fn(() => { queued = false }), acceptWaveform: (s: Float32Array) => { total += s.length; maxBlock = Math.max(maxBlock, s.length) },
      isEmpty: () => !queued, front: () => ({ samples: new Float32Array(100) }), pop: () => { queued = false }, flush: () => { queued = true } }
    const progress: number[] = []
    expect(transcribeFile(input, recognizer, vad, (n: number) => progress.push(n))).toBe('课程文字')
    expect(total).toBe(65 * 16000); expect(maxBlock).toBeLessThanOrEqual(512)
    expect(progress.at(-1)).toBe(100); expect(free).toHaveBeenCalledOnce(); expect(vad.reset).toHaveBeenCalledTimes(2)
    expect(transcribeFile(input, recognizer, vad)).toBe('课程文字')
  })
  it('rejects invalid or truncated WAV and still resets VAD', () => {
    const input = wavFile(1)
    writeFileSync(input, readFileSync(input).subarray(0, 50))
    const vad = { reset: vi.fn() }
    expect(() => transcribeFile(input, {}, vad)).toThrow('截断')
    expect(vad.reset).toHaveBeenCalledOnce()
  })
  it('frees a stream if inference fails', () => {
    const input = wavFile(1)
    const free = vi.fn()
    let queued = true
    const recognizer = { createStream: () => ({ acceptWaveform: vi.fn(), free }), decode: () => { throw new Error('inference error') } }
    const vad = { reset: vi.fn(), acceptWaveform: vi.fn(), isEmpty: () => !queued, front: () => ({ samples: new Float32Array(1) }), pop: () => { queued = false } }
    expect(() => transcribeFile(input, recognizer, vad)).toThrow('inference error')
    expect(free).toHaveBeenCalledOnce()
  })
})
