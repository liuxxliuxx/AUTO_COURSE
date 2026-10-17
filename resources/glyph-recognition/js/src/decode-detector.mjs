// Letterbox, ONNX decode, NMS and coordinate restore; mirrors detector.py.

import { roundHalfEven } from './image-ops.mjs';

export const DEFAULT_IMGSZ = 480;
export const DEFAULT_CONFIDENCE = 0.25;
export const DEFAULT_IOU = 0.7;
export const PAD_VALUE = 114;

export function resizeBilinear(image, width, height, targetWidth, targetHeight) {
  if (width === targetWidth && height === targetHeight) return Uint8Array.from(image);
  const output = new Uint8Array(targetWidth * targetHeight * 3);
  const sample = (x, y, channel) => {
    const cx = Math.min(Math.max(x, 0), width - 1);
    const cy = Math.min(Math.max(y, 0), height - 1);
    return image[(cy * width + cx) * 3 + channel];
  };
  for (let y = 0; y < targetHeight; y += 1) {
    const fy = Math.min(Math.max(((y + 0.5) * height) / targetHeight - 0.5, 0), height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, height - 1);
    const wy = fy - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const fx = Math.min(Math.max(((x + 0.5) * width) / targetWidth - 0.5, 0), width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, width - 1);
      const wx = fx - x0;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = sample(x0, y0, channel) * (1 - wx) + sample(x1, y0, channel) * wx;
        const bottom = sample(x0, y1, channel) * (1 - wx) + sample(x1, y1, channel) * wx;
        output[(y * targetWidth + x) * 3 + channel] = Math.min(Math.max(Math.round(top * (1 - wy) + bottom * wy), 0), 255);
      }
    }
  }
  return output;
}

export function letterbox(image, width, height, imgsz = DEFAULT_IMGSZ) {
  const ratio = Math.min(imgsz / width, imgsz / height);
  const newWidth = roundHalfEven(width * ratio);
  const newHeight = roundHalfEven(height * ratio);
  const resized = resizeBilinear(image, width, height, newWidth, newHeight);
  const canvas = new Uint8Array(imgsz * imgsz * 3).fill(PAD_VALUE);
  const padX = (imgsz - newWidth) / 2;
  const padY = (imgsz - newHeight) / 2;
  const top = roundHalfEven(padY - 0.1);
  const left = roundHalfEven(padX - 0.1);
  for (let y = 0; y < newHeight; y += 1) {
    const destination = ((top + y) * imgsz + left) * 3;
    canvas.set(resized.subarray(y * newWidth * 3, (y + 1) * newWidth * 3), destination);
  }
  return { canvas, ratio, padX, padY, imgsz };
}

export function decodeDetector(raw, layout, ratio, padX, padY, imageWidth, imageHeight, confidence = DEFAULT_CONFIDENCE) {
  const [batch, channels, anchors] = layout;
  if (channels !== 5) throw new Error(`unexpected detector channel count ${channels}`);
  const boxes = [];
  for (let index = 0; index < anchors; index += 1) {
    // The exported Ultralytics graph already applies the class sigmoid, so channel 4 is a
    // probability; squashing it again would inflate every box above the threshold.
    const score = Math.min(Math.max(raw[4 * anchors + index], 0), 1);
    if (score < confidence) continue;
    const cx = raw[index];
    const cy = raw[anchors + index];
    const w = raw[2 * anchors + index];
    const h = raw[3 * anchors + index];
    let x1 = (cx - w / 2 - padX) / ratio;
    let y1 = (cy - h / 2 - padY) / ratio;
    let x2 = (cx + w / 2 - padX) / ratio;
    let y2 = (cy + h / 2 - padY) / ratio;
    x1 = Math.min(Math.max(x1, 0), imageWidth);
    y1 = Math.min(Math.max(y1, 0), imageHeight);
    x2 = Math.min(Math.max(x2, 0), imageWidth);
    y2 = Math.min(Math.max(y2, 0), imageHeight);
    if (x2 - x1 <= 0 || y2 - y1 <= 0) continue;
    boxes.push({ bbox_xyxy: [x1, y1, x2, y2], detector_confidence: score });
  }
  return boxes;
}

export function intersectionOverUnion(left, right) {
  const interWidth = Math.min(left[2], right[2]) - Math.max(left[0], right[0]);
  const interHeight = Math.min(left[3], right[3]) - Math.max(left[1], right[1]);
  if (interWidth <= 0 || interHeight <= 0) return 0;
  const intersection = interWidth * interHeight;
  const union = (left[2] - left[0]) * (left[3] - left[1]) + (right[2] - right[0]) * (right[3] - right[1]) - intersection;
  return union > 0 ? intersection / union : 0;
}

export function nms(boxes, iou = DEFAULT_IOU, maxDetections = 300) {
  const order = boxes.map((_, index) => index).sort((a, b) => boxes[b].detector_confidence - boxes[a].detector_confidence || a - b);
  const kept = [];
  while (order.length && kept.length < maxDetections) {
    const current = order.shift();
    kept.push(boxes[current]);
    const remaining = [];
    for (const index of order) {
      if (intersectionOverUnion(boxes[current].bbox_xyxy, boxes[index].bbox_xyxy) <= iou) remaining.push(index);
    }
    order.length = 0;
    order.push(...remaining);
  }
  return kept;
}
