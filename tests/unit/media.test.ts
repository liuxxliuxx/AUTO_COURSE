/**
 * 媒体获取与 ffmpeg 处理。
 *
 * ffmpeg 真的会跑：从夹具的 tiny.webm 提取音轨，
 * 参数与 v1 `audio_capture.convert_webm_to_wav` 完全一致。
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MIN_DOWNLOAD_BYTES,
  MIN_WAV_BYTES,
  downloadMedia,
  extractAudioToWav,
  fileSize,
  findFfmpeg,
  removeQuietly
} from '../../src/main/services/media'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, '..', 'fixtures')
const tinyWebm = join(fixturesDir, 'assets', 'tiny.webm')

const ffmpeg = findFfmpeg()

let server: FixtureServer
let dir: string

beforeAll(async () => {
  server = await startFixtureServer(fixturesDir)
  dir = mkdtempSync(join(tmpdir(), 'ac-media-'))
})

afterAll(async () => {
  await server?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('findFfmpeg', () => {
  it('能在本机找到 ffmpeg（开发环境应已安装）', () => {
    // 找不到时这条会失败并提醒安装，而不是静默跳过
    expect(ffmpeg, '未检测到 ffmpeg，请先安装').not.toBeNull()
    expect(existsSync(ffmpeg as string)).toBe(true)
  })
})

describe('extractAudioToWav', () => {
  it('从 WebM 提取出 16kHz 单声道 PCM WAV', async () => {
    const out = join(dir, 'out.wav')
    const result = await extractAudioToWav(ffmpeg as string, tinyWebm, out)

    expect(result.ok, result.error).toBe(true)
    expect(existsSync(out)).toBe(true)

    // RIFF/WAVE 头：采样率 16000、单声道、16bit
    const header = (await import('node:fs')).readFileSync(out).subarray(0, 44)
    expect(header.toString('ascii', 0, 4)).toBe('RIFF')
    expect(header.toString('ascii', 8, 12)).toBe('WAVE')
    expect(header.readUInt16LE(22)).toBe(1) // channels
    expect(header.readUInt32LE(24)).toBe(16000) // sample rate
    expect(header.readUInt16LE(34)).toBe(16) // bits per sample
  })

  it('输入不存在时返回失败而不是抛错', async () => {
    const result = await extractAudioToWav(ffmpeg as string, join(dir, 'nope.webm'), join(dir, 'x.wav'))
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('输入是垃圾数据时返回失败', async () => {
    const junk = join(dir, 'junk.webm')
    writeFileSync(junk, 'not a media file at all')
    const result = await extractAudioToWav(ffmpeg as string, junk, join(dir, 'y.wav'))
    expect(result.ok).toBe(false)
  })
})

describe('downloadMedia', () => {
  const base = {
    userAgent: 'test-agent',
    referer: 'https://example.com/course',
    cookieHeader: 'a=1'
  }

  it('下载大于 1 MiB 的文件成功', async () => {
    const out = join(dir, 'big.bin')
    const progress: number[] = []
    const result = await downloadMedia({
      url: `${server.origin}/bigfile/?size=${MIN_DOWNLOAD_BYTES + 200_000}`,
      outputPath: out,
      ...base,
      onProgress: (done) => progress.push(done)
    })

    expect(result.ok, result.error).toBe(true)
    expect(result.bytes).toBeGreaterThan(MIN_DOWNLOAD_BYTES)
    expect(fileSize(out)).toBe(result.bytes)
    expect(progress.length).toBeGreaterThan(0)
  })

  it('下载过小的文件视为鉴权失败并删除', async () => {
    const out = join(dir, 'small.bin')
    const result = await downloadMedia({
      url: `${server.origin}/attachment/tiny.txt`,
      outputPath: out,
      ...base
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('过小')
    expect(existsSync(out)).toBe(false)
  })

  it('404 返回失败', async () => {
    const result = await downloadMedia({
      url: `${server.origin}/definitely-not-here`,
      outputPath: join(dir, 'x.bin'),
      ...base
    })
    // 夹具服务器对未知路径返回 404
    expect(result.ok).toBe(false)
  })

  it('shouldStop 能中途取消', async () => {
    const out = join(dir, 'cancel.bin')
    const result = await downloadMedia({
      url: `${server.origin}/bigfile/?size=${MIN_DOWNLOAD_BYTES * 4}`,
      outputPath: out,
      ...base,
      onProgress: () => {},
      shouldStop: () => true
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('取消')
  })
})

describe('文件工具', () => {
  it('fileSize 对不存在的文件返回 0', () => {
    expect(fileSize(join(dir, 'nope'))).toBe(0)
  })

  it('removeQuietly 对不存在的路径不抛错', () => {
    expect(() => removeQuietly(join(dir, 'nope'))).toBeTruthy()
    expect(() => removeQuietly(null)).not.toThrow()
  })

  it('最小体积阈值与 v1 一致', () => {
    expect(MIN_WAV_BYTES).toBe(10 * 1024)
    expect(MIN_DOWNLOAD_BYTES).toBe(1024 * 1024)
  })
})
