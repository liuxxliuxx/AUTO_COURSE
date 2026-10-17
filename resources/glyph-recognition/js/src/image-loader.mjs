// JPEG/PNG decoding to raw RGB; pure-JS dependencies keep the Electron build simple.

import { readFileSync } from 'node:fs';

export async function loadRgb(path) {
  const buffer = readFileSync(path);
  return decodeRgb(buffer);
}

export async function decodeRgb(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const jpeg = (await import('jpeg-js')).default;
    const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
    return fromRgba(decoded.data, decoded.width, decoded.height);
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    const { PNG } = await import('pngjs');
    const decoded = PNG.sync.read(buffer);
    return fromRgba(decoded.data, decoded.width, decoded.height);
  }
  throw new Error('unsupported image format (expected JPEG or PNG)');
}

function fromRgba(rgba, width, height) {
  const pixels = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 3] = rgba[index * 4];
    pixels[index * 3 + 1] = rgba[index * 4 + 1];
    pixels[index * 3 + 2] = rgba[index * 4 + 2];
  }
  return { pixels, width, height };
}
