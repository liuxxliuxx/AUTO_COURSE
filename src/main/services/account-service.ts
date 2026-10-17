import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import type { Account, AccountInput, AccountCourseProgress } from '@shared/accounts'
import type { Credentials } from '@shared/types'
import type { Database } from '../storage/database'
import { CredentialStore } from '../storage/credentials'
import { sanitizeCourseNote } from '../util/filename'

type Row = { id: string; name: string; username: string; login_method: Account['loginMethod']; logged_url: string; created_at: string; updated_at: string }
/** Only this service resolves account passwords. Public records never contain them. */
export class AccountService {
  private stores = new Map<string, CredentialStore>()
  constructor(private db: Database, private userData: string, private occupied: () => string[] = () => []) {}
  get encryptionAvailable(): boolean { try { return safeStorage.isEncryptionAvailable() } catch { return false } }
  private store(id: string): CredentialStore {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('账号 ID 无效')
    let store = this.stores.get(id)
    if (!store) { store = new CredentialStore(join(this.userData, 'account-credentials', `${id}.bin`)); this.stores.set(id, store) }
    return store
  }
  private decode(row: Row): Account {
    const state = this.store(row.id).state()
    return {id:row.id,name:row.name,username:row.username,loginMethod:row.login_method,loggedUrl:row.logged_url,createdAt:row.created_at,updatedAt:row.updated_at,hasPassword:state.hasPassword,encryptionAvailable:state.encryptionAvailable}
  }
  list(): Account[] { return (this.db.raw().prepare('SELECT * FROM accounts ORDER BY created_at,id').all() as Row[]).map(r=>this.decode(r)) }
  get(id: string): Account | null {
    const row = this.db.raw().prepare('SELECT * FROM accounts WHERE id=?').get(id) as Row | undefined
    return row ? this.decode(row) : null
  }
  credentials(id: string): Credentials {
    const account = this.get(id)
    if (!account) throw new Error('账号不存在')
    return { username: account.username, password: this.store(id).get().password }
  }
  create(input: AccountInput): Account { return this.save(randomUUID(), input, false) }
  update(id: string, input: AccountInput): Account { return this.save(id,input,true) }
  private save(id: string, input: AccountInput, update: boolean): Account {
    if (this.occupied().includes(id)) throw new Error('账号正在运行，请先停止相关任务')
    const previous = this.get(id)
    if (update && !previous) throw new Error('账号不存在')
    if (!input || typeof input.name !== 'string' || !input.name.trim()) throw new Error('请输入账号名称')
    if (typeof input.username !== 'string' || !input.username.trim()) throw new Error('请输入登录账号')
    if (!['zhihuishu','upc-institution','upc'].includes(input.loginMethod)) throw new Error('登录方式无效')
    if (typeof input.loggedUrl !== 'string') throw new Error('登录跳转地址无效')
    if (input.loginMethod === 'upc') {
      let url: URL
      try { url = new URL(input.loggedUrl) } catch { throw new Error('请输入完整的登录跳转地址') }
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('登录跳转地址无效')
    }
    if (input.password !== undefined && typeof input.password !== 'string') throw new Error('密码无效')
    const username = input.username.trim()
    if (previous && previous.username !== username && !input.password) throw new Error('登录账号已变更，请重新输入密码')
    const store = this.store(id), before = store.get()
    const password = input.password ?? before.password
    if (!password) throw new Error('请输入密码')
    const identityChanged = previous && (previous.username !== username || previous.loginMethod !== input.loginMethod || previous.loggedUrl !== input.loggedUrl.trim())
    // Invalidate before updating identity; failure leaves the previous record intact.
    if (identityChanged) rmSync(this.profileDir(id),{recursive:true,force:true})
    try {
      this.db.transaction(() => {
        const now = new Date().toISOString()
        this.db.raw().prepare(`INSERT INTO accounts VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username,login_method=excluded.login_method,logged_url=excluded.logged_url,updated_at=excluded.updated_at`)
          .run(id,input.name.trim(),username,input.loginMethod,input.loggedUrl.trim(),previous?.createdAt??now,now)
        store.set({username,password})
      })
    } catch (error) { store.set(before); throw error }
    return this.get(id)!
  }
  remove(id: string): void {
    if (!this.get(id)) throw new Error('账号不存在')
    if (this.occupied().includes(id)) throw new Error('账号正在运行，请先停止相关任务')
    if (this.db.raw().prepare('SELECT 1 FROM workflow_steps WHERE account_id=? LIMIT 1').get(id)) throw new Error('账号被任务引用，请先移除对应步骤')
    rmSync(this.profileDir(id), {recursive:true,force:true})
    this.store(id).clear()
    this.db.raw().prepare('DELETE FROM accounts WHERE id=?').run(id)
    this.stores.delete(id)
  }
  profileDir(id: string): string { this.store(id); return join(this.userData,'account-profiles',id) }
  progress(courseId: string): AccountCourseProgress[] {
    return (this.db.raw().prepare('SELECT * FROM account_course_progress WHERE course_id=?').all(courseId) as Array<{account_id:string;course_id:string;last_video_title:string|null;last_run_at:string|null;updated_at:string}>).map(r=>({accountId:r.account_id,courseId:r.course_id,lastVideoTitle:r.last_video_title,lastRunAt:r.last_run_at,updatedAt:r.updated_at}))
  }
  continuation(accountId: string, courseId: string): string | null { return this.progress(courseId).find(p=>p.accountId===accountId)?.lastVideoTitle??null }
  markRun(accountId: string, courseId: string): void {
    const now = new Date().toISOString()
    this.db.raw().prepare(`INSERT INTO account_course_progress(account_id,course_id,last_run_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(account_id,course_id) DO UPDATE SET last_run_at=excluded.last_run_at,updated_at=excluded.updated_at`).run(accountId,courseId,now,now)
  }
  saveProgress(accountId: string, courseId: string, title: string): void {
    this.db.raw().prepare(`INSERT INTO account_course_progress(account_id,course_id,last_video_title,updated_at) VALUES(?,?,?,?) ON CONFLICT(account_id,course_id) DO UPDATE SET last_video_title=excluded.last_video_title,updated_at=excluded.updated_at`).run(accountId,courseId,title,new Date().toISOString())
  }
  transcriptFolderName(account: Account, course: {id:string;name:string}): string {
    return join(`${sanitizeCourseNote(account.name)}-${account.id}`,`${sanitizeCourseNote(course.name)}-${course.id}`)
  }
}
