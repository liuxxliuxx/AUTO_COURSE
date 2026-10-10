import { readFileSync, writeFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const template = readFileSync('.github/RELEASE_TEMPLATE.md','utf8')
writeFileSync(process.argv[2] ?? 'release-notes.md', template.replaceAll('{{version}}',pkg.version).replaceAll('{{productName}}',pkg.productName))
