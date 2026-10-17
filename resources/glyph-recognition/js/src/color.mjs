// HSV palette rule and reference-to-candidate similarity; mirrors color.py.

import { SATURATION_MIN, VALUE_MIN, backgroundColor, foregroundMask, rgbToHsv } from './image-ops.mjs';

export const PALETTE = ['red', 'yellow', 'green', 'blue', 'gray'];
export const COLOR_WORDS = { 红: 'red', 黄: 'yellow', 绿: 'green', 青: 'blue', 蓝: 'blue', 灰: 'gray', 白: 'gray' };
export const UNSUPPORTED_COLOR_WORDS = { 紫: 'purple', 黑: 'black' };
export const HUE_TOLERANCE = 45.0;
// Cyan and blue share one label, so 85-165 hue units is blue.
const CHROMA_RANGES = [
  // The hue histogram has 181 bins (0-180) because red wraps across 0 and 180.
  ['red', 165, 181],
  ['red', 0, 15],
  ['yellow', 15, 45],
  ['green', 45, 85],
  ['blue', 85, 165],
];

export function paletteByHue(mode) {
  for (const [label, low, high] of CHROMA_RANGES) {
    if (low <= mode && mode < high) return label;
  }
  return 'blue';
}

export function colorStats(crop, background = null) {
  const { pixels, width, height } = crop;
  if (!pixels.length || width === 0 || height === 0) return { label: 'gray', saturated: false, hue: null, saturatedFraction: 0 };
  const base = background || backgroundColor(pixels, width, height);
  const mask = foregroundMask(pixels, width, height, base);
  const hsv = rgbToHsv(pixels);
  const total = width * height;
  let foreground = 0;
  for (let index = 0; index < total; index += 1) if (mask[index]) foreground += 1;
  const hues = [];
  const weights = [];
  for (let index = 0; index < total; index += 1) {
    if (!(mask[index] || foreground === 0)) continue;
    const saturation = hsv[index * 3 + 1];
    const value = hsv[index * 3 + 2];
    if (saturation >= SATURATION_MIN && value >= VALUE_MIN) {
      hues.push(hsv[index * 3]);
      weights.push(saturation);
    }
  }
  const considered = foreground === 0 ? total : foreground;
  const fraction = hues.length / Math.max(1, considered);
  const required = Math.max(3, Math.trunc(0.15 * considered));
  if (hues.length < required) return { label: 'gray', saturated: false, hue: null, saturatedFraction: fraction };
  let sin = 0;
  let cos = 0;
  for (let index = 0; index < hues.length; index += 1) {
    const angle = ((hues[index] * 2) * Math.PI) / 180;
    sin += Math.sin(angle) * weights[index];
    cos += Math.cos(angle) * weights[index];
  }
  const mean = (((Math.atan2(sin, cos) * 180) / Math.PI) / 2 % 180 + 180) % 180;
  const histogram = smoothedHistogram(hues, weights);
  return { label: paletteByHue(dominantHue(histogram)), saturated: true, hue: mean, saturatedFraction: fraction };
}

function smoothedHistogram(hues, weights) {
  const histogram = new Float64Array(181);
  for (let index = 0; index < hues.length; index += 1) histogram[hues[index]] += weights[index];
  const smooth = new Float64Array(181);
  for (let shift = -2; shift <= 2; shift += 1) {
    for (let index = 0; index < 181; index += 1) {
      smooth[index] += histogram[((index - shift) % 181 + 181) % 181];
    }
  }
  return smooth;
}

function dominantHue(smooth) {
  let mode = 0;
  let peak = -1;
  for (let index = 0; index < 181; index += 1) if (smooth[index] > peak) { peak = smooth[index]; mode = index; }
  return mode;
}

export function classifyColor(crop, background = null) {
  const { pixels, width, height } = crop;
  if (!pixels.length || width === 0 || height === 0) return { label: 'gray', score: 1 };
  const base = background || backgroundColor(pixels, width, height);
  const mask = foregroundMask(pixels, width, height, base);
  const hsv = rgbToHsv(pixels);
  const total = width * height;
  let foreground = 0;
  for (let index = 0; index < total; index += 1) if (mask[index]) foreground += 1;
  const histogram = new Float64Array(181);
  let saturated = 0;
  for (let index = 0; index < total; index += 1) {
    if (!(mask[index] || foreground === 0)) continue;
    const saturation = hsv[index * 3 + 1];
    const value = hsv[index * 3 + 2];
    if (saturation >= SATURATION_MIN && value >= VALUE_MIN) {
      histogram[hsv[index * 3]] += saturation;
      saturated += 1;
    }
  }
  const considered = foreground === 0 ? total : foreground;
  const required = Math.max(3, Math.trunc(0.15 * considered));
  if (saturated < required) return { label: 'gray', score: 1 - saturated / Math.max(1, considered) };
  const smooth = new Float64Array(181);
  for (let shift = -2; shift <= 2; shift += 1) {
    for (let index = 0; index < 181; index += 1) {
      const source = ((index - shift) % 181 + 181) % 181;
      smooth[index] += histogram[source];
    }
  }
  const mode = dominantHue(smooth);
  let mass = 0;
  for (let index = 0; index < 181; index += 1) mass += smooth[index];
  let window = 0;
  for (let index = Math.max(0, mode - 15); index <= Math.min(180, mode + 15); index += 1) window += smooth[index];
  return { label: paletteByHue(mode), score: mass > 0 ? window / mass : 0 };
}

export function similarityFromStats(left, right) {
  if (!left || !right) return 0;
  if (left.label && right.label && left.label === right.label) return 1;
  if (!left.saturated && !right.saturated) return 1;
  if (!left.saturated || !right.saturated) return 0;
  let difference = Math.abs(left.hue - right.hue);
  difference = Math.min(difference, 180 - difference);
  return Math.max(0, 1 - difference / HUE_TOLERANCE);
}
