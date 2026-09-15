/**
 * 媒体获取与音频处理。
 *
 * 对应 v1 的 `src/transcriber/audio_capture.py`，但只保留 Node 应该做的部分：
 *   - 定位 ffmpeg
 *   - 下载媒体直链（v1 用 Python requests，v2 用 Node fetch）
 *   - 调用 ffmpeg 提取 16k 单声道 PCM WAV
 *
 * 录音（MediaRecorder）不在这里：它属于页面内行为，由 TranscriptionService
 * 通过 Playwright 驱动，见 docs/PLAYWRIGHT_POC.md §3.2（blob 下载在 Electron 下
 * 不触发 will-download，音轨必须经 Node 侧分批取回）。
 */

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from './logger'

const logger = createLogger('media')

/** 下载文件小于此值视为鉴权失败（v1 的 1 MiB 判据） */
export const MIN_DOWNLOAD_BYTES = 1024 * 1024

/** WAV 小于此值视为没有音轨（v1 constants.TRANSCRIPTION_MIN_WAV_SIZE_BYTES） */
export const MIN_WAV_BYTES = 10 * 1024

/** ffmpeg 提取音轨的超时 */
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000

// ============================================================================
// ffmpeg
// ============================================================================

/** 按平台查找 ffmpeg，语义等价于 v1 `audio_capture.find_ffmpeg`。 */
export function findFfmpeg(): string | null {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const entries = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  for (const dir of entries) {
    const candidate = join(dir, exe)
    if (existsSync(candidate)) return candidate
  }

  const candidates: string[] = []
  if (process.platform === 'win32') {
    const condaPrefix = process.env['CONDA_PREFIX']
    const localAppData = process.env['LOCALAPPDATA']
    candidates.push(
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\ffmpeg\\ffmpeg.exe',
      'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
      ...(condaPrefix ? [join(condaPrefix, 'Library', 'bin', 'ffmpeg.exe')] : []),
      ...(localAppData ? [join(localAppData, 'Microsoft', 'WinGet', 'Packages')] : []),
      join(homedir(), 'scoop', 'apps', 'ffmpeg', 'current', 'bin', 'ffmpeg.exe')
    )
  } else {
    candidates.push(
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/usr/bin/ffmpeg',
      join(homedir(), '.local', 'bin', 'ffmpeg')
    )
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * 提取音轨为 16kHz 单声道 16bit PCM WAV。
 *
 * 命令行与 v1 逐参数一致（`convert_webm_to_wav` 与 `download_video_audio`
 * 用的就是同一条）：
 *   ffmpeg -y -i <in> -vn -acodec pcm_s16le -ar 16000 -ac 1 -loglevel error <out>
 */
export async function extractAudioToWav(
  ffmpegPath: string,
  input: string,
  outputWav: string
): Promise<{ ok: boolean; error?: string }> {
  const args = [
    '-y',
    '-i',
    input,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-loglevel',
    'error',
    outputWav
  ]

  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, error: 'ffmpeg 超时' })
    }, FFMPEG_TIMEOUT_MS)

    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `ffmpeg 启动失败: ${error.message}` })
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0 && existsSync(outputWav)) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, error: stderr.trim().slice(0, 500) || `ffmpeg 退出码 ${code}` })
      }
    })
  })
}

// ============================================================================
// 下载
// ============================================================================

export interface DownloadOptions {
  url: string
  outputPath: string
  /** 页面 UA（v1 从 navigator.userAgent 取） */
  userAgent: string
  /** 当前页面地址，用于构造 Referer / Origin */
  referer: string
  /** 形如 `a=1; b=2` 的 Cookie 头 */
  cookieHeader: string
  /** 进度回调 */
  onProgress?: (downloadedBytes: number, totalBytes: number) => void
  /** 外部取消 */
  shouldStop?: () => boolean
}

/**
 * 下载媒体直链到本地。
 *
 * v1 用的是 Python `requests` + `stream=True`；这里换成 Node 的 fetch，
 * 请求头逐条对齐（部分 CDN 会校验 Referer/Origin/Range）。
 */
export async function downloadMedia(options: DownloadOptions): Promise<{ ok: boolean; bytes: number; error?: string }> {
  const { url, outputPath, userAgent, referer, cookieHeader, onProgress, shouldStop } = options

  // Origin = 页面地址去掉最后两段路径，与 v1 的 current_page.rsplit("/", 2)[0] 一致
  let origin = 'https://studyvideoh5.zhihuishu.com'
  try {
    const parsed = new URL(referer)
    origin = `${parsed.protocol}//${parsed.host}`
  } catch {
    /* 用默认值 */
  }

  const headers: Record<string, string> = {
    'User-Agent': userAgent || 'Mozilla/5.0',
    Referer: referer || 'https://studyvideoh5.zhihuishu.com/',
    Origin: origin,
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    // 部分 CDN 需要 Range 头才肯吐数据
    Range: 'bytes=0-'
  }
  if (cookieHeader) headers['Cookie'] = cookieHeader

  let response: Response
  try {
    response = await fetch(url, { headers, redirect: 'follow' })
  } catch (error) {
    return { ok: false, bytes: 0, error: `请求失败: ${String(error)}` }
  }

  if (!response.ok || !response.body) {
    return { ok: false, bytes: 0, error: `HTTP ${response.status}` }
  }

  const totalBytes = Number(response.headers.get('content-length') ?? 0)
  const stream = createWriteStream(outputPath)
  // 必须常驻一个 error 监听：写入期间出错（磁盘满、文件被删、取消后残留写入）
  // 会让 stream 抛 'error' 事件，没人接就是未捕获异常 —— 会直接带崩进程/测试。
  let streamError: Error | null = null
  stream.on('error', (error: Error) => {
    streamError = error
  })
  let downloaded = 0
  let lastLogged = 0

  try {
    const reader = response.body.getReader()
    for (;;) {
      if (streamError) throw streamError

      if (shouldStop?.()) {
        await reader.cancel().catch(() => undefined)
        // 用 destroy 而不是 close：缓冲里可能还有没落盘的块，
        // 关掉 fd 之后那些写入会以 ENOENT 之类的错误冒出来。
        stream.destroy()
        return { ok: false, bytes: downloaded, error: '已取消' }
      }

      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      downloaded += value.byteLength
      if (!stream.write(value)) {
        await new Promise<void>((resolve) => stream.once('drain', () => resolve()))
      }
      onProgress?.(downloaded, totalBytes)

      // 每 10 MiB 记一条，与 v1 一致
      if (downloaded - lastLogged >= 10 * 1024 * 1024) {
        lastLogged = downloaded
        logger.info(`已下载 ${(downloaded / 1024 / 1024).toFixed(1)} MiB`)
      }
    }

    // 之前出错过就不再等 'finish'（它不会再触发），直接抛给外层
    if (streamError) throw streamError
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', () => resolve())
      stream.once('error', reject)
      stream.end()
    })
  } catch (error) {
    stream.destroy()
    return { ok: false, bytes: downloaded, error: `下载中断: ${String(error)}` }
  }

  if (downloaded < MIN_DOWNLOAD_BYTES) {
    removeQuietly(outputPath)
    return {
      ok: false,
      bytes: downloaded,
      error: `下载文件过小（${downloaded} 字节），可能鉴权失败`
    }
  }

  return { ok: true, bytes: downloaded }
}

export function removeQuietly(path: string | null | undefined): void {
  if (!path) return
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch (error) {
    logger.debug(`删除临时文件失败 ${path}: ${String(error)}`)
  }
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
