// Own the native sessions and CPU image processing outside Electron's main thread.
const { parentPort, workerData } = require('node:worker_threads');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
let runtime, detector, classifier;
async function initialize() {
  runtime = await import(pathToFileURL(workerData.libraryPath).href);
  detector = await runtime.Detector.create(join(workerData.modelRoot, 'models/detector.onnx'));
  classifier = await runtime.RoiClassifier.create(join(workerData.modelRoot, 'models/roi-classifier'));
}
const ready = initialize();
// Serialize jobs so the same native inference sessions never run concurrently.
let queue = ready;
parentPort.on('message', job => {
  queue = queue.then(async () => {
    try {
      const image = await runtime.decodeRgb(Buffer.from(job.bytes));
      if (image.width !== job.width || image.height !== job.height) throw new Error('image-size-mismatch');
      const result = await runtime.recognize(image.pixels, image.width, image.height, job.instruction, detector, classifier);
      parentPort.postMessage({ id: job.id, result });
    } catch {
      parentPort.postMessage({ id: job.id, error: '离线验证码推理失败' });
    }
  }).catch(() => parentPort.postMessage({ id: job.id, error: '离线验证码模型加载失败' }));
});
// Keep startup errors on the worker protocol rather than an unhandled rejection.
ready.catch(() => {});
