// ONNX Runtime session wrappers for the detector and the ROI classifier.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { letterbox, decodeDetector, nms } from './decode-detector.mjs';
import { INPUT_SIZE, preprocessRoi } from './preprocess.mjs';

async function loadOrt() {
  return import('onnxruntime-node');
}

export async function createSession(path, threads = 4) {
  const ort = await loadOrt();
  return ort.InferenceSession.create(path, {
    intraOpNumThreads: Math.max(1, threads),
    interOpNumThreads: 1,
    executionProviders: ['cpu'],
  });
}

export class Detector {
  constructor(session, imgsz = 480, confidence = 0.25, iou = 0.7) {
    this.session = session;
    this.imgsz = imgsz;
    this.confidence = confidence;
    this.iou = iou;
  }

  static async create(onnxPath, options = {}) {
    const session = await createSession(onnxPath, options.threads || 4);
    return new Detector(session, options.imgsz || 480, options.confidence || 0.25, options.iou || 0.7);
  }

  async raw(canvas) {
    const ort = await loadOrt();
    const size = this.imgsz * this.imgsz;
    const tensor = new Float32Array(3 * size);
    for (let index = 0; index < size; index += 1) {
      tensor[index] = canvas[index * 3] / 255;
      tensor[size + index] = canvas[index * 3 + 1] / 255;
      tensor[2 * size + index] = canvas[index * 3 + 2] / 255;
    }
    const input = new ort.Tensor('float32', tensor, [1, 3, this.imgsz, this.imgsz]);
    const output = await this.session.run({ [this.session.inputNames[0]]: input });
    return output[this.session.outputNames[0]];
  }

  async detect(image, width, height) {
    const padded = letterbox(image, width, height, this.imgsz);
    const tensor = await this.raw(padded.canvas);
    const boxes = decodeDetector(tensor.data, tensor.dims, padded.ratio, padded.padX, padded.padY, width, height, this.confidence);
    return nms(boxes, this.iou);
  }
}

export class RoiClassifier {
  constructor(session, classes) {
    this.session = session;
    this.classes = classes;
  }

  static async create(modelDir, options = {}) {
    const schema = JSON.parse(readFileSync(join(modelDir, 'labels.json'), 'utf8'));
    const session = await createSession(join(modelDir, 'model.onnx'), options.threads || 4);
    return new RoiClassifier(session, schema.classes);
  }

  async predict(image, width, height, boxes, topK = 3) {
    if (!boxes.length) return [];
    const ort = await loadOrt();
    const tensors = boxes.map((box) => preprocessRoi(image, width, height, box));
    const flat = new Float32Array(tensors.length * INPUT_SIZE * INPUT_SIZE);
    tensors.forEach((tensor, index) => flat.set(tensor, index * INPUT_SIZE * INPUT_SIZE));
    const input = new ort.Tensor('float32', flat, [tensors.length, 1, INPUT_SIZE, INPUT_SIZE]);
    const output = await this.session.run({ [this.session.inputNames[0]]: input });
    const logits = output[this.session.outputNames[0]];
    const [count, classes] = logits.dims;
    const results = [];
    for (let row = 0; row < count; row += 1) {
      let max = -Infinity;
      for (let index = 0; index < classes; index += 1) max = Math.max(max, logits.data[row * classes + index]);
      let total = 0;
      const probabilities = new Float64Array(classes);
      for (let index = 0; index < classes; index += 1) {
        probabilities[index] = Math.exp(logits.data[row * classes + index] - max);
        total += probabilities[index];
      }
      for (let index = 0; index < classes; index += 1) probabilities[index] /= total;
      const order = [...probabilities.keys()].sort((a, b) => probabilities[b] - probabilities[a] || a - b).slice(0, topK);
      const best = order[0];
      const label = this.classes[best];
      const [identity, orientation] = label.split('|');
      const shape = identity.startsWith('shape:') ? identity.split(':')[1] : null;
      results.push({
        bbox_xyxy: boxes[row].map(Number),
        class_id: best,
        joint_label: label,
        identity,
        kind: shape ? 'shape' : 'glyph',
        shape,
        orientation,
        identity_confidence: probabilities[best],
        orientation_confidence: probabilities[best],
        top_k: order.map((index) => ({ joint_label: this.classes[index], score: probabilities[index] })),
      });
    }
    return results;
  }
}
