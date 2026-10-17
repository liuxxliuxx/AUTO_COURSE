/** Import verified offline inference assets; never copy another project's node_modules. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('usage: node scripts/prepare-glyph-runtime.mjs <delivery-directory>');
const root = resolve(source);
const destination = resolve(project, 'resources/glyph-recognition');
const manifest = JSON.parse(readFileSync(resolve(root, 'SHA256SUMS.json'), 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
// Verify the whole delivery before copying any file. Manifest paths must stay in the bundle.
for (const [name, expected] of Object.entries(manifest.files)) {
  const file = resolve(root, name);
  const inside = relative(root, file);
  if (isAbsolute(name) || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`Unsafe manifest path: ${name}`);
  if (!existsSync(file) || hash(file) !== expected) throw new Error(`Delivery checksum mismatch: ${name}`);
}
const selected = Object.keys(manifest.files).filter(name =>
  name.startsWith('models/') || name.startsWith('configs/') ||
  (name.startsWith('js/src/') && !name.endsWith('/infer.mjs')) ||
  name.startsWith('golden/images/') || name === 'golden/python-reference.json' ||
  ['THIRD_PARTY_NOTICES.md', 'README.md', 'DELIVERY.md', 'provenance/provenance.json', 'evaluation/REPORT.md'].includes(name));
const imported = {};
for (const name of selected) {
  const target = resolve(destination, name);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, name), target);
  imported[name] = hash(target);
}
writeFileSync(resolve(destination, 'IMPORT-MANIFEST.json'), JSON.stringify({
  version: 'glyph-recognition-v1', upstreamManifestSha256: hash(resolve(root, 'SHA256SUMS.json')),
  files: imported,
}, null, 2) + '\n');
console.log(`Verified ${Object.keys(manifest.files).length} delivery files; imported ${selected.length} runtime/reference files to ${destination}`);
