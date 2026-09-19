/**
 * 转录服务（handoff §20–22）。
 *
 * 边界划分：
 *   Node 负责 —— 媒体获取、下载、音频录制、ffmpeg、WAV 文件管理、任务编排、输出文件
 *   Python 负责 —— 加载 SenseVoice、跑推理、返回文本
 *
 * 两种模式都要保留（handoff §22）：
 *   1. 刷课 + 转录：课程视频真实播放，页面内 MediaRecorder 录音 → WAV → 转写
 *   2. 仅转录：不播放视频，Node 侧下载直链 → ffmpeg 提取音轨 → 转写
 *
 * 录音产物**不走浏览器下载**：docs/PLAYWRIGHT_POC.md §3.2 已证实 blob 下载
 * 在 Electron 下既不触发 Playwright 事件也不触发宿主的 will-download。
 * 改为页面内攒块、Node 侧分批取回后落盘。
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, TranscriptionPhase, TranscriptionStatus } from '@shared/types'
import type { BrowserSession } from '../automation/browser-session'
import type { MediaPort } from '../automation/runner'
import type { EventBus } from './event-bus'
import {
  MIN_WAV_BYTES,
  downloadMedia,
  extractAudioToWav,
  fileSize,
  findFfmpeg,
  removeQuietly
} from './media'
import { SttWorker } from './stt-worker'
import { DEFAULT_COURSE_NAME, sanitizeFilename } from '../util/filename'
import { createLogger } from './logger'

const logger = createLogger('transcription')

/** 与 v1 一致：输出根目录下固定叫「课程录音」 */
const OUTPUT_ROOT_DIRNAME = '课程录音'
/** 临时文件目录（WAV / WebM 都放这里） */
const TEMP_DIRNAME = '.temp'

/** 录音过程中主动 requestData 的间隔，避免整段音频滞留在页面内存里 */
const DRAIN_INTERVAL_MS = 20_000
/** 单次取块的字节上限（base64 后体积约为 4/3） */
const DRAIN_CHUNK_LIMIT = 6 * 1024 * 1024

// ============================================================================
// 注入页面的脚本
// ============================================================================

/**
 * 开始录音。
 * 与 v1 `_START_RECORDING_JS` 等价：
 *  - 只保留音轨（audio+video 混合流的 MediaRecorder 行为不稳定）
 *  - 不传 mimeType、不传 timeslice（会触发 NotSupportedError）
 */
const START_RECORDING_JS = `
  (() => {
    if (window.__zhs_recorder) return 'already_recording';
    const video = document.querySelector('video');
    if (!video) return 'no_video';
    if (typeof video.captureStream !== 'function') return 'no_capture_stream';

    let stream;
    try {
      stream = video.captureStream();
    } catch (e) {
      return 'capture_error:' + e.name + ':' + e.message;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return 'no_audio_track';

    let audioStream;
    try {
      audioStream = new MediaStream(audioTracks);
    } catch (e) {
      return 'new_mediastream_error:' + e.name + ':' + e.message;
    }

    let recorder;
    try {
      recorder = new MediaRecorder(audioStream);
    } catch (e) {
      return 'new_recorder_error:' + e.name + ':' + e.message;
    }

    window.__zhs_chunks = [];
    window.__zhs_recorder_error = null;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) window.__zhs_chunks.push(e.data); };
    recorder.onerror = (e) => { window.__zhs_recorder_error = String(e.error || e.type); };
    recorder.start();
    window.__zhs_recorder = recorder;

    return 'ok:' + (recorder.mimeType || 'default') + ':' + audioTracks.length;
  })()
`

/** 停止录音；返回剩余块数。 */
const STOP_RECORDING_JS = `
  (async () => {
    const recorder = window.__zhs_recorder;
    if (!recorder) return { ok: false, error: 'not_recording' };
    try {
      if (recorder.state !== 'inactive') {
        await new Promise((resolve) => {
          recorder.onstop = resolve;
          try { recorder.stop(); } catch (e) { resolve(); }
        });
      }
      if (typeof recorder.requestData === 'function' && recorder.state !== 'inactive') {
        try { recorder.requestData(); } catch (e) { /* 已停止 */ }
      }
    } catch (e) {
      return { ok: false, error: String(e) };
    }
    const remaining = (window.__zhs_chunks || []).length;
    window.__zhs_recorder = null;
    return { ok: true, remaining, error: window.__zhs_recorder_error || null };
  })()
`

/** 请求中途吐一次数据（把已录内容从页面内存挪到 Node） */
const REQUEST_DATA_JS = `
  (() => {
    const recorder = window.__zhs_recorder;
    if (!recorder || recorder.state === 'inactive') return false;
    try { recorder.requestData(); return true; } catch (e) { return false; }
  })()
`

/** 清理页面上的录音状态 */
const CLEANUP_JS = `
  (() => {
    window.__zhs_recorder = null;
    window.__zhs_chunks = [];
    window.__zhs_recorder_error = null;
    return true;
  })()
`

// ============================================================================

export interface TranscriptionDeps {
  bus: EventBus
  /** 每次设置变更后重新读取 */
  tempNamespace?: string
  getSettings: () => AppSettings
  /** STT worker 的路径；测试时可注入假实现 */
  worker: ConstructorParameters<typeof SttWorker>[0]
}

export class TranscriptionService implements MediaPort {
  private readonly worker: SttWorker

  private phase: TranscriptionPhase = 'idle'
  private title: string | null = null
  private percent: number | null = null
  private completed = 0
  private failed = 0
  private message = '转录未启用'
  private tone: TranscriptionStatus['tone'] = 'neutral'

  private enabled = false
  private outputRoot = ''
  private tempDir = ''
  private courseDir = ''

  /** 当前录音的临时文件 */
  private activeWav: string | null = null
  private activeWebm: string | null = null
  private drainTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: TranscriptionDeps) {
    this.worker = new SttWorker(deps.worker)
  }

  // ------------------------------------------------------------------ 状态

  getStatus(): TranscriptionStatus {
    return {
      outputFiles: [...this.outputFiles],
      phase: this.phase,
      title: this.title,
      completed: this.completed,
      failed: this.failed,
      message: this.message,
      tone: this.tone,
      percent: this.percent
    }
  }

  private setStatus(
    message: string,
    tone: TranscriptionStatus['tone'],
    phase: TranscriptionPhase,
    percent: number | null = null
  ): void {
    this.message = message
    this.tone = tone
    this.phase = phase
    this.percent = percent
    this.deps.bus.emit('event:transcription-status', this.getStatus())
  }

  // -------------------------------------------------------------- 生命周期

  /**
   * 按当前设置决定是否启用。
   * 返回是否可用（ffmpeg + worker 都在）。
   */
  private outputFiles: string[] = []
  private configuredCourseName = DEFAULT_COURSE_NAME

  /**
   * @param courseFolder 由课程库给出的输出目录名（同名课程会带序号）。
   *   缺省时退回课程备注，保证调用方不必知道命名规则。
   */
  async configure(settings: AppSettings, transcribeOnly: boolean, courseFolder?: string): Promise<boolean> {
    const wanted = settings.transcribeEnabled || transcribeOnly
    this.enabled = wanted && !!settings.transcribeBaseDir

    if (!this.enabled) {
      this.setStatus('转录未启用', 'neutral', 'idle')
      return false
    }

    if (!findFfmpeg()) {
      this.enabled = false
      this.setStatus('未检测到 ffmpeg，语音转文字已禁用', 'danger', 'worker-unavailable')
      logger.warn('未检测到 ffmpeg')
      return false
    }

    this.configuredCourseName = courseFolder?.trim() || sanitizeFilename(settings.courseNote || DEFAULT_COURSE_NAME)
    this.outputRoot = join(settings.transcribeBaseDir, OUTPUT_ROOT_DIRNAME)
    const tempRoot = this.deps.tempNamespace
      ? join(this.outputRoot, TEMP_DIRNAME, this.deps.tempNamespace)
      : join(this.outputRoot, TEMP_DIRNAME)
    this.tempDir = tempRoot
    this.courseDir = join(this.outputRoot, this.configuredCourseName)
    mkdirSync(this.tempDir, { recursive: true })
    mkdirSync(this.courseDir, { recursive: true })

    this.setStatus('正在加载语音模型...', 'neutral', 'starting-worker')
    try {
      await this.worker.start()
      this.setStatus('转录就绪', 'success', 'idle')
      return true
    } catch (error) {
      this.enabled = false
      const text = error instanceof Error ? error.message : String(error)
      this.setStatus(`转录不可用: ${text}`, 'danger', 'worker-unavailable')
      return false
    }
  }

  async dispose(): Promise<void> {
    this.stopDrainTimer()
    await this.worker.stop()
    this.cleanupTemp()
  }

  // ============================================================ MediaPort

  /** 刷课 + 转录：视频开始播放时开录。 */
  async onVideoBegin(session: BrowserSession, title: string): Promise<void> {
    if (!this.enabled) return

    this.cleanupActive()
    this.title = title
    // 记下会话：onVideoEnd 只拿得到标题，取块时还需要页面
    this.session = session

    const page = session.playwrightPage
    try {
      const result = (await page.evaluate(START_RECORDING_JS)) as string

      if (result === 'already_recording') {
        logger.warn('页面已有录音在进行，先清理')
        await page.evaluate(CLEANUP_JS)
        await page.evaluate(START_RECORDING_JS)
      } else if (!result.startsWith('ok:')) {
        this.failed += 1
        this.setStatus(`无法录音（${result}）`, 'danger', 'failed')
        logger.error(`无法开始录音: ${result}`)
        return
      }

      this.activeWav = join(this.tempDir, `${randomUUID().replace(/-/g, '')}.wav`)
      this.activeWebm = this.activeWav.replace(/\.wav$/, '.webm')
      // 先建空文件，取块时直接 append
      writeFileSync(this.activeWebm, Buffer.alloc(0))

      this.setStatus(`录音中「${this.truncate(title)}」`, 'neutral', 'recording')
      this.startDrainTimer(page)
    } catch (error) {
      this.failed += 1
      logger.exception('开始录音失败', error)
      this.setStatus('无法录音', 'danger', 'failed')
    }
  }

  /** 刷课 + 转录：视频结束后停止录音并转写。 */
  async onVideoEnd(title: string): Promise<void> {
    if (!this.enabled || !this.activeWebm) return

    this.stopDrainTimer()
    const page = this.currentPage()
    if (!page) {
      this.failed += 1
      this.setStatus('录音失败：页面已关闭', 'danger', 'failed')
      this.cleanupActive()
      return
    }

    try {
      await page.evaluate(STOP_RECORDING_JS)
      await this.drainToFile(page, this.activeWebm)
      await page.evaluate(CLEANUP_JS)

      const bytes = fileSize(this.activeWebm)
      if (bytes === 0) {
        this.failed += 1
        this.setStatus(`录音为空「${this.truncate(title)}」`, 'danger', 'failed')
        this.cleanupActive()
        return
      }

      this.setStatus(`转换音频中「${this.truncate(title)}」`, 'neutral', 'converting')
      const ok = await this.convertAndTranscribe(this.activeWebm, this.activeWav as string, title)
      if (!ok) this.failed += 1
    } catch (error) {
      this.failed += 1
      logger.exception('结束录音失败', error)
      this.setStatus('录音处理失败', 'danger', 'failed')
    } finally {
      this.cleanupActive()
    }
  }

  /** 仅转录：不播放视频，直接下载直链提取音轨。 */
  async transcribeOnly(session: BrowserSession, title: string): Promise<boolean> {
    if (!this.enabled) {
      logger.warn(`转录不可用，跳过: ${title}`)
      return false
    }

    this.title = title
    const page = session.playwrightPage

    // ---- 1. 取媒体直链 ----
    this.setStatus(`获取视频地址「${this.truncate(title)}」`, 'neutral', 'downloading')
    let mediaUrl = ''
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        mediaUrl = ((await page.evaluate(
          "(() => { const v = document.querySelector('video'); return (v && (v.src || v.currentSrc)) || ''; })()"
        )) ?? '') as string
      } catch (error) {
        logger.error(`获取视频 URL 失败: ${String(error)}`)
        break
      }
      if (mediaUrl.startsWith('http')) break
      await page.waitForTimeout(2_000)
    }

    if (!mediaUrl.startsWith('http')) {
      this.failed += 1
      this.setStatus(`视频地址无效「${this.truncate(title)}」`, 'danger', 'failed')
      return false
    }

    // ---- 2. 下载 ----
    const wavPath = join(this.tempDir, `${randomUUID().replace(/-/g, '')}.wav`)
    const tmpVideo = `${wavPath}.mp4.tmp`

    try {
      const cookies = await session.getCookieHeader()
      const userAgent = (await page.evaluate('navigator.userAgent')) as string
      const referer = session.getCurrentUrl()

      this.setStatus(`下载中「${this.truncate(title)}」`, 'neutral', 'downloading')
      const download = await downloadMedia({
        url: mediaUrl,
        outputPath: tmpVideo,
        userAgent,
        referer,
        cookieHeader: cookies,
        onProgress: (done, total) => {
          if (total > 0) {
            this.setStatus(
              `下载中「${this.truncate(title)}」 ${(done / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MiB`,
              'neutral',
              'downloading',
              Math.round((done / total) * 100)
            )
          }
        },
        shouldStop: () => false
      })

      if (!download.ok) {
        this.failed += 1
        this.setStatus(`下载失败「${this.truncate(title)}」`, 'danger', 'failed')
        logger.error(`下载失败: ${download.error}`)
        return false
      }

      // ---- 3. 提取音轨 ----
      this.setStatus(`提取音轨「${this.truncate(title)}」`, 'neutral', 'converting')
      const ffmpeg = findFfmpeg()
      if (!ffmpeg) {
        this.failed += 1
        this.setStatus('未检测到 ffmpeg', 'danger', 'worker-unavailable')
        return false
      }

      const extracted = await extractAudioToWav(ffmpeg, tmpVideo, wavPath)
      if (!extracted.ok) {
        this.failed += 1
        this.setStatus(`音轨提取失败「${this.truncate(title)}」`, 'danger', 'failed')
        logger.error(`ffmpeg 失败: ${extracted.error}`)
        removeQuietly(wavPath)
        return false
      }

      if (fileSize(wavPath) < MIN_WAV_BYTES) {
        this.failed += 1
        this.setStatus(`音频过小「${this.truncate(title)}」`, 'danger', 'failed')
        removeQuietly(wavPath)
        return false
      }

      return await this.transcribeWav(wavPath, title)
    } finally {
      removeQuietly(tmpVideo)
    }
  }

  // ---------------------------------------------------------------- 内部

  /** onVideoEnd 只拿得到标题，取块时还需要页面，所以在 onVideoBegin 记下会话。 */
  private session: BrowserSession | null = null

  private currentPage(): import('playwright-core').Page | null {
    const session = this.session
    if (!session || session.isClosed) return null
    return session.playwrightPage
  }

  private startDrainTimer(page: import('playwright-core').Page): void {
    this.stopDrainTimer()
    this.drainTimer = setInterval(() => {
      void (async () => {
        try {
          await page.evaluate(REQUEST_DATA_JS)
          if (this.activeWebm) await this.drainToFile(page, this.activeWebm)
        } catch {
          /* 页面在导航时可能短暂不可用 */
        }
      })()
    }, DRAIN_INTERVAL_MS)
    this.drainTimer.unref?.()
  }

  private stopDrainTimer(): void {
    if (this.drainTimer) clearInterval(this.drainTimer)
    this.drainTimer = null
  }

  /**
   * 把页面里攒的音频块分批写进本地文件。
   *
   * 每次取一块（超过上限则切片），Node 侧 append 到文件。
   * 这样整段录音（可能上百 MB）不需要一次性穿过 IPC。
   */
  private async drainToFile(page: import('playwright-core').Page, target: string): Promise<number> {
    const { appendFileSync } = await import('node:fs')
    let written = 0

    for (;;) {
      const chunk = await page.evaluate(async (maxBytes: number) => {
        const state = window as unknown as { __zhs_chunks?: Blob[] }
        const chunks = state.__zhs_chunks ?? []
        if (chunks.length === 0) return null

        const toBase64 = (bytes: Uint8Array): string => {
          let binary = ''
          const STEP = 0x8000
          for (let i = 0; i < bytes.length; i += STEP) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + STEP)))
          }
          return btoa(binary)
        }

        const blob = chunks[0]
        if (blob.size > maxBytes) {
          // 单块超大时按切片吐，避免一次性构造过大的 base64
          const slice = blob.slice(0, maxBytes)
          chunks[0] = blob.slice(maxBytes)
          const buf = await slice.arrayBuffer()
          return { data: toBase64(new Uint8Array(buf)), remaining: chunks.length }
        }

        chunks.shift()
        const buf = await blob.arrayBuffer()
        return { data: toBase64(new Uint8Array(buf)), remaining: chunks.length }
      }, DRAIN_CHUNK_LIMIT)

      if (!chunk) break
      appendFileSync(target, Buffer.from(chunk.data, 'base64'))
      written += 1

      // 防御：正常一段视频不会有上千块
      if (written > 5_000) {
        logger.warn('取块数量异常，停止')
        break
      }
    }
    return written
  }

  /** WebM → WAV → 转写 → 写 txt。 */
  private async convertAndTranscribe(webmPath: string, wavPath: string, title: string): Promise<boolean> {
    const ffmpeg = findFfmpeg()
    if (!ffmpeg) {
      this.setStatus('未检测到 ffmpeg', 'danger', 'worker-unavailable')
      return false
    }

    const converted = await extractAudioToWav(ffmpeg, webmPath, wavPath)
    removeQuietly(webmPath)
    if (!converted.ok) {
      this.setStatus(`音频转换失败「${this.truncate(title)}」`, 'danger', 'failed')
      logger.error(`ffmpeg 失败: ${converted.error}`)
      return false
    }

    if (fileSize(wavPath) < MIN_WAV_BYTES) {
      this.setStatus(`音频过小「${this.truncate(title)}」`, 'danger', 'failed')
      removeQuietly(wavPath)
      return false
    }

    return this.transcribeWav(wavPath, title)
  }

  /** 把 WAV 交给 worker，成功后写 txt。 */
  private async transcribeWav(wavPath: string, title: string): Promise<boolean> {
    this.setStatus(`转文字中「${this.truncate(title)}」`, 'neutral', 'transcribing')

    try {
      const text = await this.worker.transcribe(wavPath)
      this.writeTranscript(title, text)
      this.completed += 1
      this.setStatus(`已完成 ${this.completed} 节`, 'success', 'done')
      return true
    } catch (error) {
      this.failed += 1
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus(`转录失败: ${message}`, 'danger', 'failed')
      logger.error(`转录失败「${title}」: ${message}`)
      return false
    } finally {
      removeQuietly(wavPath)
    }
  }

  /**
   * 写转写结果。
   * 文件头格式与 v1 `_write_transcript` 逐字一致，
   * 保证用户已有的「课程录音」目录内容前后一致。
   */
  private writeTranscript(title: string, text: string): void {
    const courseName = this.configuredCourseName
    const target = join(this.courseDir, `${sanitizeFilename(title)}.txt`)

    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

    const header =
      `# 课程: ${courseName}\n` +
      `# 课时: ${title}\n` +
      `# 转录时间: ${stamp}\n` +
      `# 模型: SenseVoiceSmall\n\n`

    mkdirSync(this.courseDir, { recursive: true })
    writeFileSync(target, `${header}${text}\n`, 'utf8')
    this.outputFiles.push(target)
    logger.info(`转写结果已保存: ${target}`)
  }

  /**
   * 清理临时文件。
   *
   * v1 的 TRANSCRIPTION_DEBUG_KEEP_WAV 默认 True，等于永不清除，
   * 一节课约 115MB 常驻磁盘（docs/V1_BASELINE.md §7.9）。
   * v2 默认清理。
   */
  private cleanupActive(): void {
    removeQuietly(this.activeWav)
    removeQuietly(this.activeWebm)
    this.activeWav = null
    this.activeWebm = null
  }

  /** 清空临时目录（退出时调用） */
  private cleanupTemp(): void {
    if (!this.tempDir) return
    try {
      rmSync(this.tempDir, { recursive: true, force: true })
    } catch (error) {
      logger.debug(`清理临时目录失败: ${String(error)}`)
    }
  }

  private truncate(title: string): string {
    return title.length > 20 ? `${title.slice(0, 20)}…` : title
  }
}
