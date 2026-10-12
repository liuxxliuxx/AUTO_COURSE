/** Download once into userData; partial downloads are never treated as models. */
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MODEL_BASE = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07'
export interface ModelFile { name: string; url: string; minBytes: number; sha256?: string }
export const MODEL_FILES: readonly ModelFile[] = [
  { name: 'model.int8.onnx', url: `${MODEL_BASE}/model.int8.onnx`, minBytes: 239233841, sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51' },
  { name: 'tokens.txt', url: `${MODEL_BASE}/tokens.txt`, minBytes: 315894, sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc' },
  { name: 'LICENSE', url: `${MODEL_BASE}/LICENSE`, minBytes: 1 },
  { name: 'silero_vad.onnx', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', minBytes: 643854, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' },
]

async function validFile(path: string, file: ModelFile, signal: AbortSignal): Promise<boolean> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size < file.minBytes) return false
  if (!file.sha256) return true
  const hash = createHash('sha256')
  const stream = createReadStream(path, { signal })
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex') === file.sha256
}

export async function ensureSttModels(
  directory: string,
  signal: AbortSignal,
  report: (message: string) => void = () => {},
  fetchFile: typeof fetch = fetch,
  files: readonly ModelFile[] = MODEL_FILES,
): Promise<void> {
  await mkdir(directory, { recursive: true })
  for (const file of files) {
    signal.throwIfAborted()
    const target = join(directory, file.name)
    if (await validFile(target, file, signal)) continue
    const partial = `${target}.${randomUUID()}.part`
    report(`正在下载语音模型：${file.name}（首次使用）`)
    try {
      const response = await fetchFile(file.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]) })
      if (!response.ok || !response.body) throw new Error(`下载失败 HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(partial), { signal })
      const size = (await stat(partial)).size
      const expected = response.headers.get('content-length')
      if (size < file.minBytes || (expected && size !== Number(expected))) throw new Error('模型文件不完整，请重试')
      if (!(await validFile(partial, file, signal))) throw new Error('模型校验失败，请重试')
      signal.throwIfAborted()
      await rename(partial, target)
    } catch (error) {
      if (signal.aborted) throw signal.reason
      throw new Error(`${file.name} 下载失败，请检查网络后重试：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await rm(partial, { force: true })
    }
  }
}
