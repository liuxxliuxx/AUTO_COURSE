/**
 * 凭据存储 —— Electron safeStorage。
 *
 * handoff §18：v2 用 safeStorage，**不要求**自动迁移 v1 的 keyring 凭据；
 * 允许升级后要求用户重新输入一次账号密码。
 *
 * 存储形式：safeStorage.encryptString(JSON) 的密文，落在 userData 下的单个文件。
 * 明文绝不落盘；safeStorage 不可用时只保存在内存里，重启即失效（并在 UI 上明示）。
 */

import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CredentialState, Credentials } from '@shared/types'
import { createLogger } from '../services/logger'

const logger = createLogger('credentials')

const EMPTY: Credentials = { username: '', password: '' }

export class CredentialStore {
  /** safeStorage 不可用时的内存兜底 */
  private memory: Credentials = { ...EMPTY }
  private memoryOnly = false

  constructor(private readonly file: string) {}

  get encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  state(): CredentialState {
    const creds = this.get()
    return {
      hasUsername: creds.username.length > 0,
      hasPassword: creds.password.length > 0,
      encryptionAvailable: this.encryptionAvailable
    }
  }

  get(): Credentials {
    if (this.memoryOnly) return { ...this.memory }

    try {
      if (!existsSync(this.file)) return { ...EMPTY }
      const buf = readFileSync(this.file)
      const json = safeStorage.decryptString(buf)
      const parsed = JSON.parse(json) as Partial<Credentials>
      return {
        username: typeof parsed.username === 'string' ? parsed.username : '',
        password: typeof parsed.password === 'string' ? parsed.password : ''
      }
    } catch {
      // 解密失败（换机器、钥匙串被重置等）按"没有凭据"处理，不阻塞启动
      logger.warn('读取凭据失败，按未保存处理')
      return { ...EMPTY }
    }
  }

  set(creds: Credentials): CredentialState {
    const normalized: Credentials = {
      username: creds.username ?? '',
      password: creds.password ?? ''
    }

    if (!this.encryptionAvailable) {
      rmSync(this.file, { force: true })
      this.memoryOnly = true
      this.memory = normalized
      logger.warn('safeStorage 不可用，凭据仅保存在内存中')
      return this.state()
    }

    try {
      mkdirSync(dirname(this.file), { recursive: true })
      if (!normalized.username && !normalized.password) {
        rmSync(this.file, { force: true })
      } else {
        writeFileSync(this.file, safeStorage.encryptString(JSON.stringify(normalized)))
      }
      this.memoryOnly = false
      this.memory = { ...EMPTY }
    } catch (error) {
      logger.exception('写入凭据失败', error)
      throw new Error('账号保存失败，请重试')
    }
    return this.state()
  }

  clear(): void {
    this.memory = { ...EMPTY }
    try {
      rmSync(this.file, { force: true })
    } catch {
      /* 文件本来就不存在 */
    }
  }
}
