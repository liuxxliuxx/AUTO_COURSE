// Offline smoke: actual course host DPR and native ONNX worker under Electron.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'auto-course-glyph-'));
let host;
try {
  host = await electron.launch({ executablePath: require('electron'), args: [root, '--browser-host', '--background-run', `--profile-dir=${join(temp, 'profile')}`, `--download-dir=${join(temp, 'downloads')}`], cwd: root });
  const page = await host.firstWindow();
  await page.goto('data:text/html,<iframe src="about:blank"></iframe>');
  assert.equal(await page.evaluate(() => devicePixelRatio), 2);
  assert.equal(await page.frames()[1].evaluate(() => devicePixelRatio), 2);
  await page.reload();
  assert.equal(await page.evaluate(() => devicePixelRatio), 2);
  console.log('PASS: actual Electron host and child frame retain DPR 2 across reload');

  const reference = JSON.parse(readFileSync(join(root, 'resources/glyph-recognition/golden/python-reference.json'), 'utf8')).cases[0];
  const result = await host.evaluate(async (_electron, { root, reference }) => {
    const { Worker } = process.getBuiltinModule('node:worker_threads');
    const { join } = process.getBuiltinModule('node:path');
    const { readFileSync } = process.getBuiltinModule('node:fs');
    const worker = new Worker(join(root, 'resources/glyph-worker.cjs'), { workerData: {
      libraryPath: join(root, 'resources/glyph-recognition/js/src/index.mjs'), modelRoot: join(root, 'resources/glyph-recognition')
    } });
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker timeout')), 20000);
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.once('message', message => { clearTimeout(timer); message.error ? reject(new Error(message.error)) : resolve(message.result); });
        worker.postMessage({ id: 1, bytes: readFileSync(join(root, 'resources/glyph-recognition/golden', reference.image)), width: 480, height: 240, instruction: reference.instruction });
      });
    } finally { await worker.terminate(); }
  }, { root, reference });
  assert.equal(result.status, reference.match.status);
  assert.equal(result.targetId, reference.match.targetId);
  console.log('PASS: actual Electron worker loads copied models and recognizes the golden image');
} finally {
  await host?.close();
  rmSync(temp, { recursive: true, force: true });
}
