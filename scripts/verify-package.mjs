/** Launch packaged application and Browser Host using isolated profiles, without live websites. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const executablePath = resolve(process.argv[2] ?? 'release/mac-arm64/AUTO_COURSE.app/Contents/MacOS/AUTO_COURSE')
assert.ok(existsSync(executablePath), `Missing packaged executable: ${executablePath}`)
const profile = mkdtempSync(join(tmpdir(), 'ac-package-check-'))
let app, host
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${join(profile,'app')}`], timeout: 60_000 })
  const window = await app.firstWindow({ timeout: 60_000 })
  await window.locator('.brand').filter({ hasText: 'AUTO_COURSE' }).waitFor({ timeout: 20_000 })
  const info = await window.evaluate(() => window.appApi.app.version())
  assert.equal(info.name, 'AUTO_COURSE'); assert.equal(info.packaged, true)
  const settings = await window.evaluate(() => window.appApi.settings.getAll())
  assert.equal(typeof settings.skipCompleted, 'boolean')
  const packageResources = await app.evaluate(({ app: electronApp }) => ({
    asar: electronApp.getAppPath().endsWith('app.asar'), root: process.resourcesPath
  }))
  assert.equal(packageResources.asar, true)
  for (const file of ['stt/worker.cjs','LICENSE','THIRD_PARTY_NOTICES.txt']) {
    assert.ok(existsSync(join(packageResources.root, file)), `Missing resource ${file}`)
  }
  const wasmModule = join(packageResources.root, 'app.asar.unpacked', 'node_modules', 'sherpa-onnx', 'index.js')
  const wasmVersion = execFileSync(executablePath, ['-e', `console.log(require(${JSON.stringify(wasmModule)}).version)`], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000
  }).trim()
  assert.ok(wasmVersion, 'Packaged sherpa-onnx WASM failed to load')
  await window.getByRole('link', {name:'关于与帮助',exact:true}).click()
  await window.getByRole('heading', {name:'关于与帮助',exact:true}).waitFor()
  const diagnostic = JSON.parse(await window.evaluate(() => window.appApi.app.diagnostics()))
  assert.equal(diagnostic.version, info.version)
  assert.equal(Object.hasOwn(diagnostic,'username'), false)
  // Same executable and flag used by BrowserService; this verifies packaged host routing and Playwright Runtime support.
  host = await electron.launch({ executablePath, args: ['--browser-host', `--profile-dir=${join(profile,'host')}`, `--download-dir=${join(profile,'downloads')}`], timeout:60_000 })
  const courseWindow = await host.firstWindow({ timeout:60_000 })
  await courseWindow.setContent('<button id="check">Host ready</button>')
  await courseWindow.locator('#check').click()
  assert.equal(await courseWindow.locator('#check').textContent(), 'Host ready')
  console.log('PASS: packaged renderer, About, SQLite, resources, diagnostics and real Browser Host locator interaction')
} finally {
  let closeError
  try { if (host) await host.close() } catch (error) { closeError = error }
  try { if (app) await app.close() } catch (error) { closeError ??= error }
  rmSync(profile, {recursive:true,force:true})
  if (closeError) throw closeError
}
