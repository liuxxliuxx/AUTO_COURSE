/** Local SenseVoiceSmall inference. Runs only in a Node worker thread. */
const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData, isMainThread } = require('node:worker_threads');

// Read only the PCM format produced by media.ts. Never load a whole course into WASM.
function readHeader(fd) {
  const size = fs.fstatSync(fd).size;
  const read = (length, offset) => {
    const b = Buffer.alloc(length);
    if (fs.readSync(fd, b, 0, length, offset) !== length) throw new Error('WAV 文件被截断');
    return b;
  };
  const header = read(12, 0);
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是有效的 PCM WAV 文件');
  }
  let format;
  let data;
  for (let offset = 12; offset + 8 <= size;) {
    const chunk = read(8, offset);
    const length = chunk.readUInt32LE(4);
    const start = offset + 8;
    if (start + length > size) throw new Error('WAV 文件被截断');
    const id = chunk.toString('ascii', 0, 4);
    if (id === 'fmt ') {
      if (length < 16) throw new Error('WAV 格式头不完整');
      const fmt = read(16, start);
      format = fmt.readUInt16LE(0) === 1 && fmt.readUInt16LE(2) === 1 &&
        fmt.readUInt32LE(4) === 16000 && fmt.readUInt16LE(12) === 2 && fmt.readUInt16LE(14) === 16;
    }
    if (id === 'data') data = { offset: start, length };
    offset = start + length + (length % 2);
  }
  if (!format) throw new Error('转录需要 16kHz 单声道 16bit PCM WAV');
  if (!data || data.length % 2) throw new Error('WAV 音频数据不完整');
  return data;
}

function transcribeFile(filename, recognizer, vad, onProgress = () => {}) {
  const fd = fs.openSync(filename, 'r');
  const texts = [];
  const drain = () => {
    while (!vad.isEmpty()) {
      const segment = vad.front();
      const stream = recognizer.createStream();
      try {
        stream.acceptWaveform(16000, segment.samples);
        recognizer.decode(stream);
        const text = recognizer.getResult(stream).text.replace(/<\|[^|]*\|>/g, '').trim();
        if (text) texts.push(text);
      } finally {
        stream.free();
        vad.pop();
      }
    }
  };
  try {
    const data = readHeader(fd);
    vad.reset();
    const pcm = Buffer.alloc(1024);
    let lastPercent = -1;
    for (let offset = 0; offset < data.length;) {
      const bytes = Math.min(pcm.length, data.length - offset);
      if (fs.readSync(fd, pcm, 0, bytes, data.offset + offset) !== bytes) throw new Error('WAV 文件被截断');
      const samples = new Float32Array(bytes / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
      vad.acceptWaveform(samples);
      drain();
      offset += bytes;
      const percent = Math.floor(offset / data.length * 100);
      if (percent !== lastPercent) { onProgress(percent); lastPercent = percent; }
    }
    vad.flush();
    drain();
    return texts.join('\n');
  } finally {
    fs.closeSync(fd);
    vad.reset();
  }
}

if (!isMainThread) {
  try {
    const sherpa = require(workerData.modulePath);
    const recognizer = sherpa.createOfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: { model: path.join(workerData.modelDir, 'model.int8.onnx'), language: '', useInverseTextNormalization: 1 },
        tokens: path.join(workerData.modelDir, 'tokens.txt'),
        numThreads: 1, provider: 'cpu', debug: 0,
      },
    });
    if (!recognizer.handle) throw new Error('SenseVoiceSmall 初始化失败，请检查模型文件');
    const vad = sherpa.createVad({
      sileroVad: { model: path.join(workerData.modelDir, 'silero_vad.onnx'), threshold: 0.5,
        minSilenceDuration: 0.5, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 512 },
      sampleRate: 16000, numThreads: 1, provider: 'cpu', bufferSizeInSeconds: 30,
    });
    if (!vad.handle) throw new Error('语音分段模型初始化失败，请检查模型文件');
    parentPort.on('message', ({ id, input }) => {
      try {
        const text = transcribeFile(input, recognizer, vad, percent => parentPort.postMessage({ type: 'progress', id, percent }));
        parentPort.postMessage({ id, success: true, text });
      } catch (error) {
        parentPort.postMessage({ id, success: false, error: error.message });
      }
    });
    parentPort.postMessage({ type: 'ready' });
  } catch (error) {
    parentPort.postMessage({ type: 'fatal', error: `模型加载失败: ${error.message}` });
    parentPort.close();
  }
}
module.exports = { readHeader, transcribeFile };
