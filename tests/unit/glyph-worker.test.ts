import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GlyphWorker } from '../../src/main/services/glyph-worker'
import { parseCaptchaCheck, validGlyphPoint } from '../../src/main/automation/glyph-captcha'

describe('离线识别 worker 与结果约束', () => {
  it('真实模型通过 worker 处理固定原图，并复用会话', async () => {
    const modelRoot = resolve('resources/glyph-recognition')
    const worker = new GlyphWorker({ scriptPath: resolve('resources/glyph-worker.cjs'), libraryPath: resolve(modelRoot, 'js/src/index.mjs'), modelRoot })
    const reference = JSON.parse(readFileSync(resolve(modelRoot, 'golden/python-reference.json'), 'utf8')).cases[0]
    const input = { bytes: readFileSync(resolve(modelRoot, 'golden', reference.image)), width: 480, height: 240, instruction: reference.instruction }
    try {
      for (let i = 0; i < 2; i++) {
        const result = await worker.recognize(input, () => false)
        expect(result.status).toBe(reference.match.status)
        expect(result.targetId).toBe(reference.match.targetId)
        expect(validGlyphPoint(result, 480, 240)).toBe(true)
      }
    } finally { worker.dispose() }
  })
  it('停止后不能再启动 worker', async () => {
    const worker = new GlyphWorker({ scriptPath: '', libraryPath: '', modelRoot: '' })
    worker.dispose()
    await expect(worker.recognize({ bytes: new Uint8Array(), width: 1, height: 1, instruction: '' }, () => false)).rejects.toThrow()
  })
  it('模型加载失败、超时及运行中停止会结束待处理任务', async () => {
    for (const mode of ['missing', 'timeout', 'stop']) {
      const modelRoot = resolve('resources/glyph-recognition')
      const worker = new GlyphWorker({ scriptPath: resolve('resources/glyph-worker.cjs'), libraryPath: resolve(modelRoot, 'js/src/index.mjs'), modelRoot: mode === 'missing' ? '/nonexistent-glyph-model' : modelRoot, timeoutMs: mode === 'timeout' ? 1 : 5000 })
      let stop = false
      const timer = mode === 'stop' ? setTimeout(() => { stop = true }, 1) : undefined
      try {
        await expect(worker.recognize({ bytes: new Uint8Array(), width: 480, height: 240, instruction: '' }, () => stop)).rejects.toThrow()
      } finally { clearTimeout(timer); worker.dispose() }
    }
  })
  it('只接受明确的验证结果，兼容 JSONP', () => {
    expect(parseCaptchaCheck('cb({"data":{"result":true}});')).toBe(true)
    expect(parseCaptchaCheck('{"data":{"result":false}}')).toBe(false)
    expect(parseCaptchaCheck('{"data":{"token":"ignored"}}')).toBeNull()
    expect(parseCaptchaCheck('invalid')).toBeNull()
  })
  it('拒绝越界、非有限坐标、重复目标与目标框外坐标', () => {
    const result = { status: 'matched', targetId: 'o1', pointInImage: { x: 200, y: 100 }, objects: [{ id: 'o1', bbox_xyxy: [150, 50, 250, 150] }] }
    expect(validGlyphPoint(result, 480, 240)).toBe(true)
    expect(validGlyphPoint({ ...result, pointInImage: { x: NaN, y: 100 } }, 480, 240)).toBe(false)
    expect(validGlyphPoint({ ...result, pointInImage: { x: 300, y: 100 } }, 480, 240)).toBe(false)
    expect(validGlyphPoint({ ...result, objects: [...result.objects, ...result.objects] }, 480, 240)).toBe(false)
  })
})
