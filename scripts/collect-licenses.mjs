import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const notices = ['AUTO_COURSE — third-party notices', 'Project: MIT (see LICENSE).',
  'Electron runtime LICENSE and LICENSES.chromium.html are distributed alongside the executable.',
  'Python transcription dependencies and model weights are installed separately and are not bundled.']
// Renderer libraries are bundled despite living in devDependencies. Include their dependency graphs too.
const selected = new Set(Object.entries(lock.packages).filter(([path,item]) => path && !item.dev && !item.devOptional).map(([path]) => path))
function dependencyPath(from, name) {
  let directory = from
  while (true) {
    const candidate = join(directory, 'node_modules', name)
    if (existsSync(join(candidate,'package.json'))) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`Missing bundled dependency: ${name}`)
}
const visited = new Set()
function include(path) {
  if (visited.has(path)) return
  visited.add(path); selected.add(path)
  const pkg = JSON.parse(readFileSync(join(path,'package.json'),'utf8'))
  for (const name of Object.keys(pkg.dependencies ?? {})) include(dependencyPath(path,name))
}
for (const name of ['vue','pinia','vue-router']) include(dependencyPath('.',name))
for (const path of [...selected].sort()) {
  const item = lock.packages[path] ?? {}
  if (!existsSync(join(path,'package.json'))) throw new Error(`Missing production dependency: ${path}`)
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  const licenseFiles = readdirSync(path).filter(file => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file))
  const texts = licenseFiles.filter(file => !file.toLowerCase().endsWith('.json')).map(file => {
    try { return `${file}:\n${readFileSync(join(path,file),'utf8')}` } catch { return '' }
  }).filter(Boolean)
  if (!texts.length) throw new Error(`Missing license text: ${pkg.name}`)
  notices.push(`\n${'='.repeat(72)}\n${pkg.name}@${pkg.version} — ${pkg.license ?? item.license ?? 'see below'}\n${texts.join('\n')}`)
}
writeFileSync('THIRD_PARTY_NOTICES.txt', notices.join('\n') + '\n')
console.log(`Collected notices for ${notices.length - 4} runtime and bundled renderer dependencies`)
