import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import yaml from 'js-yaml'
const pkg = JSON.parse(readFileSync('package.json','utf8'))
const lock = JSON.parse(readFileSync('package-lock.json','utf8'))
const cfg = yaml.load(readFileSync('electron-builder.yml','utf8'))
assert.match(pkg.version, /^3\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
assert.equal(pkg.version, lock.version)
assert.equal(pkg.version, lock.packages[''].version)
assert.equal(pkg.productName, 'AUTO_COURSE')
assert.equal(pkg.license, 'MIT')
assert.ok(pkg.documentation.startsWith(`${pkg.homepage}/tree/`) && pkg.documentation.endsWith('/docs'), 'Documentation must point to the repository docs directory')
assert.equal(lock.packages[''].license, pkg.license)
assert.equal(cfg.appId, 'com.autocourse.zhihuishu')
assert.equal(cfg.productName, undefined, 'Product name comes from package.json')
assert.equal(cfg.dmg.artifactName, '${productName}-${version}-mac-${arch}.dmg')
assert.equal(cfg.nsis.artifactName, '${productName}-${version}-win-${arch}.exe')
assert.equal(cfg.mac.identity, null)
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined
if (tag) assert.equal(tag, `v${pkg.version}`, 'Release tag must match package.json')
for (const file of ['LICENSE','THIRD_PARTY_NOTICES.txt','assets/icon.png','assets/icon.ico','assets/icon.icns','docs/README.md','docs/user/README.md','docs/PROJECT.md','.github/RELEASE_TEMPLATE.md']) assert.ok(existsSync(file), file)
console.log(`Release metadata and resources valid: ${pkg.productName} ${pkg.version}`)
