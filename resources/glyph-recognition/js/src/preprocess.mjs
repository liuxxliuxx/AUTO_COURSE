// ROI preprocessing for the 129-class ResNet-18 model; mirrors classifier.py.

import { cropWithMargin, median, roundHalfEven } from './image-ops.mjs';

export const INPUT_SIZE = 96;

export function lumaChannel(crop) {
  const { pixels, width, height } = crop;
  const gray = new Float64Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const value = 0.299 * pixels[index * 3] + 0.587 * pixels[index * 3 + 1] + 0.114 * pixels[index * 3 + 2];
    gray[index] = roundHalfEven(value);
  }
  return gray;
}

export function percentile1and99(values) {
  const flat = Float64Array.from(values).sort();
  if (!flat.length) return [0, 0];
  if (flat.length === 1) return [flat[0], flat[0]];
  const at = (q) => {
    const position = (q / 100) * (flat.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return flat[lower];
    const weight = position - lower;
    return flat[lower] * (1 - weight) + flat[upper] * weight;
  };
  return [at(1), at(99)];
}

export function thumbnailSize(width, height, limit = INPUT_SIZE) {
  let x = width;
  let y = height;
  if (x > limit) {
    y = Math.max(roundHalfEven((y * limit) / x), 1);
    x = limit;
  }
  if (y > limit) {
    x = Math.max(roundHalfEven((x * limit) / y), 1);
    y = limit;
  }
  return [x, y];
}

function overlapWeights(sourceLength, targetLength) {
  const weights = [];
  for (let index = 0; index < targetLength; index += 1) {
    const start = (index * sourceLength) / targetLength;
    const end = ((index + 1) * sourceLength) / targetLength;
    const row = new Float64Array(sourceLength);
    const first = Math.floor(start);
    const last = Math.min(sourceLength, Math.ceil(end));
    for (let source = first; source < last; source += 1) {
      const overlap = Math.min(end, source + 1) - Math.max(start, source);
      if (overlap > 0) row[source] = overlap;
    }
    let total = 0;
    for (let source = 0; source < sourceLength; source += 1) total += row[source];
    if (total > 0) for (let source = 0; source < sourceLength; source += 1) row[source] /= total;
    weights.push(row);
  }
  return weights;
}

function areaAverage(gray, sourceWidth, sourceHeight, width, height) {
  const rows = overlapWeights(sourceHeight, height);
  const columns = overlapWeights(sourceWidth, width);
  const output = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let sy = 0; sy < sourceHeight; sy += 1) {
        const weightY = rows[y][sy];
        if (weightY === 0) continue;
        for (let sx = 0; sx < sourceWidth; sx += 1) {
          const weight = weightY * columns[x][sx];
          if (weight === 0) continue;
          total += weight * gray[sy * sourceWidth + sx];
        }
      }
      output[y * width + x] = total;
    }
  }
  return output;
}

function bilinear(gray, sourceWidth, sourceHeight, width, height) {
  const output = new Float64Array(width * height);
  const sample = (x, y) => gray[Math.min(sourceHeight - 1, y) * sourceWidth + Math.min(sourceWidth - 1, x)];
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(Math.max(((y + 0.5) * sourceHeight) / height - 0.5, 0), sourceHeight - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, sourceHeight - 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x += 1) {
      const fx = Math.min(Math.max(((x + 0.5) * sourceWidth) / width - 0.5, 0), sourceWidth - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, sourceWidth - 1);
      const wx = fx - x0;
      const top = sample(x0, y0) * (1 - wx) + sample(x1, y0) * wx;
      const bottom = sample(x0, y1) * (1 - wx) + sample(x1, y1) * wx;
      output[y * width + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return output;
}

export function resampleGray(gray, sourceWidth, sourceHeight, width, height) {
  if (sourceWidth === width && sourceHeight === height) return Float64Array.from(gray);
  if (height <= sourceHeight && width <= sourceWidth) return areaAverage(gray, sourceWidth, sourceHeight, width, height);
  return bilinear(gray, sourceWidth, sourceHeight, width, height);
}

export function preprocessRoi(image, width, height, box, margin = 0.1) {
  const crop = cropWithMargin(image, width, height, box, margin);
  if (!crop.pixels.length) throw new Error('empty crop for box');
  let gray = lumaChannel(crop);
  const [low, high] = percentile1and99(gray);
  if (high - low >= 10) {
    for (let index = 0; index < gray.length; index += 1) {
      gray[index] = Math.min(Math.max((gray[index] - low) / (high - low), 0), 1) * 255;
    }
  }
  for (let index = 0; index < gray.length; index += 1) gray[index] = Math.trunc(gray[index]);
  const border = [];
  const cw = crop.width;
  const ch = crop.height;
  for (let x = 0; x < cw; x += 1) {
    border.push(gray[x]);
    border.push(gray[(ch - 1) * cw + x]);
  }
  for (let y = 0; y < ch; y += 1) {
    border.push(gray[y * cw]);
    border.push(gray[y * cw + cw - 1]);
  }
  const fill = Math.trunc(median(border));
  const [targetWidth, targetHeight] = thumbnailSize(cw, ch);
  const resized = resampleGray(gray, cw, ch, targetWidth, targetHeight);
  const canvas = new Float64Array(INPUT_SIZE * INPUT_SIZE).fill(fill);
  const top = Math.floor((INPUT_SIZE - targetHeight) / 2);
  const left = Math.floor((INPUT_SIZE - targetWidth) / 2);
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      canvas[(top + y) * INPUT_SIZE + left + x] = resized[y * targetWidth + x];
    }
  }
  const tensor = new Float32Array(INPUT_SIZE * INPUT_SIZE);
  for (let index = 0; index < canvas.length; index += 1) {
    tensor[index] = (canvas[index] / 255 - 0.5) / 0.5;
  }
  return tensor;
}
