import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const probe = `
  const assert = require('node:assert/strict')
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE install_check (value INTEGER NOT NULL)')
    db.prepare('INSERT INTO install_check VALUES (?)').run(42)
    assert.equal(db.prepare('SELECT value FROM install_check').get().value, 42)
    console.log(JSON.stringify({
      node: process.versions.node,
      electron: process.versions.electron,
      sqlite: db.prepare('SELECT sqlite_version() AS version').get().version
    }))
  } finally {
    db.close()
  }
`

function check(label, executable, env) {
  const result = spawnSync(executable, ['-e', probe], {
    cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0,
    `${label} SQLite 检查失败：\n${result.stderr}\n${result.stdout}`)
  console.log(`${label} SQLite 读写通过：${result.stdout.trim()}`)
}

check('Node', process.execPath, process.env)
// Electron 44 在首次 require 时下载运行时，保留其安装行为。
check('Electron', require('electron'), { ...process.env, ELECTRON_RUN_AS_NODE: '1' })
