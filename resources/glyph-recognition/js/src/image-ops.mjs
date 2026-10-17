// Pixel helpers that mirror src/glyph_recognition/image_ops.py exactly.

export const BACKGROUND_DELTA = 22;
export const SATURATION_MIN = 45;
export const VALUE_MIN = 30;

export function roundHalfEven(value) {
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder > 0.5) return floor + 1;
  if (remainder < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function trunc(value) {
  return Math.trunc(value);
}

export function luma(image, width, height, x, y) {
  const offset = (y * width + x) * 3;
  const value = 0.299 * image[offset] + 0.587 * image[offset + 1] + 0.114 * image[offset + 2];
  return roundHalfEven(value);
}

export function backgroundColor(image, width, height) {
  const values = [[], [], []];
  const collect = (x, y) => {
    const offset = (y * width + x) * 3;
    values[0].push(image[offset]);
    values[1].push(image[offset + 1]);
    values[2].push(image[offset + 2]);
  };
  for (let y = 0; y < Math.min(3, height); y += 1) for (let x = 0; x < width; x += 1) collect(x, y);
  for (let y = Math.max(0, height - 3); y < height; y += 1) for (let x = 0; x < width; x += 1) collect(x, y);
  for (let x = 0; x < Math.min(3, width); x += 1) for (let y = 0; y < height; y += 1) collect(x, y);
  for (let x = Math.max(0, width - 3); x < width; x += 1) for (let y = 0; y < height; y += 1) collect(x, y);
  return values.map(median);
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function cropWithMargin(image, width, height, box, margin = 0.1) {
  const x1 = box[0];
  const y1 = box[1];
  const x2 = box[2];
  const y2 = box[3];
  const dx = (x2 - x1) * margin;
  const dy = (y2 - y1) * margin;
  const left = Math.max(0, trunc(x1 - dx));
  const top = Math.max(0, trunc(y1 - dy));
  const right = Math.min(width, trunc(x2 + dx + 1));
  const bottom = Math.min(height, trunc(y2 + dy + 1));
  const cropWidth = Math.max(0, right - left);
  const cropHeight = Math.max(0, bottom - top);
  const pixels = new Uint8Array(cropWidth * cropHeight * 3);
  for (let y = 0; y < cropHeight; y += 1) {
    const source = ((top + y) * width + left) * 3;
    pixels.set(image.subarray(source, source + cropWidth * 3), y * cropWidth * 3);
  }
  return { pixels, width: cropWidth, height: cropHeight };
}

export function rgbToHsv(pixels) {
  const count = pixels.length / 3;
  const hsv = new Uint8Array(pixels.length);
  for (let index = 0; index < count; index += 1) {
    const r = pixels[index * 3];
    const g = pixels[index * 3 + 1];
    const b = pixels[index * 3 + 2];
    const value = Math.max(r, g, b);
    const lowest = Math.min(r, g, b);
    const diff = value - lowest;
    let hue = 0;
    if (diff > 0) {
      if (value === r) hue = trunc((30 * (g - b)) / diff);
      else if (value === g) hue = 60 + trunc((30 * (b - r)) / diff);
      else hue = 120 + trunc((30 * (r - g)) / diff);
      if (hue < 0) hue += 180;
    }
    const saturation = value === 0 ? 0 : trunc((255 * diff) / value);
    hsv[index * 3] = hue;
    hsv[index * 3 + 1] = saturation;
    hsv[index * 3 + 2] = value;
  }
  return hsv;
}

export function foregroundMask(pixels, width, height, background) {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const r = Math.abs(pixels[index * 3] - background[0]);
    const g = Math.abs(pixels[index * 3 + 1] - background[1]);
    const b = Math.abs(pixels[index * 3 + 2] - background[2]);
    mask[index] = Math.max(r, g, b) > BACKGROUND_DELTA ? 1 : 0;
  }
  return mask;
}
