import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { CredentialStore } from '../../src/main/storage/credentials'

vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString()
} }))

const directories: string[] = []
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'ac-credentials-test-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
})

describe('凭据保存反馈', () => {
  it('磁盘写入失败必须向调用方报错', () => {
    const parent = join(directory(), 'not-a-directory')
    writeFileSync(parent, '')
    const store = new CredentialStore(join(parent, 'credentials'))
    expect(() => store.set({ username: 'test', password: 'test' })).toThrow('账号保存失败')
  })

  it('加密恢复后读取新保存的凭据，不再使用旧内存值', () => {
    const store = new CredentialStore(join(directory(), 'credentials'))
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    store.set({ username: 'old', password: 'old' })
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    store.set({ username: 'new', password: 'new' })
    expect(store.get()).toEqual({ username: 'new', password: 'new' })
  })
})
