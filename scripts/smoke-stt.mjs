/** Real, offline WASM smoke: node scripts/smoke-stt.mjs <model-directory> <16k-mono-pcm.wav> */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
const require = createRequire(import.meta.url)
assert.ok(process.argv[2] && process.argv[3], 'Supply model directory and WAV file')
const started = performance.now()
const resources = process.argv[4] ? resolve(process.argv[4]) : null
const worker = new Worker(resources ? resolve(resources, 'stt/worker.cjs') : resolve('resources/stt/worker.cjs'), { workerData: {
  modelDir: resolve(process.argv[2]), modulePath: resources ? resolve(resources, 'app.asar.unpacked/node_modules/sherpa-onnx/index.js') : require.resolve('sherpa-onnx'),
} })
const timer = setTimeout(() => { void worker.terminate(); throw new Error('WASM smoke timed out') }, 180_000)
try {
  await new Promise((resolveJob, reject) => {
    let jobs = 0
    let invalidChecked = false
    worker.on('error', reject)
    worker.on('exit', code => reject(new Error(`Worker exited before completion: ${code}`)))
    worker.on('message', message => {
      if (message.type === 'fatal') { reject(new Error(message.error)); return }
      if (message.type === 'ready') worker.postMessage({ id: 'invalid', input: '/definitely/missing.wav' })
      if (message.id === 'invalid') {
        assert.equal(message.success, false)
        invalidChecked = true
        worker.postMessage({ id: 'real', input: resolve(process.argv[3]) })
      }
      if (message.id === 'real' && !message.type) {
        if (!message.success) { reject(new Error(message.error)); return }
        assert.ok(message.text.trim(), 'Expected speech in the supplied audio')
        assert.ok(invalidChecked)
        console.log(JSON.stringify({ pass: ++jobs, text: message.text, elapsedMs: Math.round(performance.now() - started) }))
        if (jobs === 2) resolveJob()
        else worker.postMessage({ id: 'real', input: resolve(process.argv[3]) })
      }
    })
  })
} finally {
  clearTimeout(timer)
  await worker.terminate()
}
