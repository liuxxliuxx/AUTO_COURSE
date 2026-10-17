/** Read-only local acceptance check against the copied delivery's Python golden cases. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../resources/glyph-recognition');
const manifest = JSON.parse(readFileSync(resolve(root, 'IMPORT-MANIFEST.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.equal(createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex'), expected, name);
}
const { Detector, RoiClassifier, loadRgb, recognize } = await import(pathToFileURL(resolve(root, 'js/src/index.mjs')).href);
const detector = await Detector.create(resolve(root, 'models/detector.onnx'));
let classifier;
try {
  classifier = await RoiClassifier.create(resolve(root, 'models/roi-classifier'));
  const reference = JSON.parse(readFileSync(resolve(root, 'golden/python-reference.json'), 'utf8'));
  for (const entry of reference.cases) {
    const image = await loadRgb(resolve(root, 'golden', entry.image));
    const result = await recognize(image.pixels, image.width, image.height, entry.instruction, detector, classifier);
    assert.equal(result.status, entry.match.status, `${entry.sample_id}: status`);
    assert.equal(result.targetId, entry.match.targetId, `${entry.sample_id}: target`);
    assert.deepEqual(result.query, entry.query, `${entry.sample_id}: query`);
    assert.equal(result.objects.length, entry.objects.length, `${entry.sample_id}: object count`);
    result.objects.forEach((object, index) => {
      for (const key of ['identity', 'orientation', 'color']) assert.equal(object[key], entry.objects[index][key], `${entry.sample_id}/${index}: ${key}`);
    });
    if (entry.match.pointInImage) {
      assert.ok(Math.abs(result.pointInImage.x - entry.match.pointInImage.x) <= 0.5, `${entry.sample_id}: x`);
      assert.ok(Math.abs(result.pointInImage.y - entry.match.pointInImage.y) <= 0.5, `${entry.sample_id}: y`);
    }
    console.log(`PASS ${entry.sample_id}: ${result.status}, ${result.objects.length} objects`);
  }
  console.log(`PASS: copied asset hashes and ${reference.cases.length} offline golden cases`);
} finally {
  await classifier?.session?.release();
  await detector.session.release();
}
