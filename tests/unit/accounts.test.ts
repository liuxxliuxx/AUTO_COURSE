import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import BetterSqlite3 from 'better-sqlite3'
import { Database } from '../../src/main/storage/database'
import { AccountService } from '../../src/main/services/account-service'
import { CourseService } from '../../src/main/services/course-service'
import { SettingsService } from '../../src/main/services/settings-service'
import { WorkflowService } from '../../src/main/workflows/workflow-service'
import { DEFAULT_COURSE_OPTIONS } from '../../src/shared/courses'
import { userDataDirectory } from '../../src/main/util/user-data'
import type { AccountInput } from '../../src/shared/accounts'
vi.mock('electron',()=>({safeStorage:{
  isEncryptionAvailable:vi.fn(()=>true),
  encryptString:(value:string)=>Buffer.from(value).map(byte=>byte^0xa5),
  decryptString:(value:Buffer)=>Buffer.from(value).map(byte=>byte^0xa5).toString()
}}))
let dir:string, db:Database, accounts:AccountService, occupied:string[]
const input:AccountInput={name:'我的账号',username:'user-a',password:'password-a',loginMethod:'zhihuishu',loggedUrl:''}
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'ac-accounts-'));db=new Database(join(dir,'data.db'));occupied=[];accounts=new AccountService(db,dir,()=>occupied)})
afterEach(()=>{db.close();rmSync(dir,{recursive:true,force:true});vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)})
function course():string {
  const result=new CourseService(db,new SettingsService(db)).create({name:'课程',url:'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=shared',options:{...DEFAULT_COURSE_OPTIONS}})
  if(!result.ok)throw Error(result.message)
  return result.courseId!
}
describe('account storage and isolation',()=>{
  it('persists public records and encrypted passwords across restart, keeping passwords out of SQLite and public results',()=>{
    const a=accounts.create(input), b=accounts.create({...input,username:'user-b',password:'password-b'})
    expect(JSON.stringify(accounts.list())).not.toContain('password-a')
    expect(readFileSync(join(dir,'account-credentials',`${a.id}.bin`)).includes(Buffer.from('password-a'))).toBe(false)
    expect(JSON.stringify(db.raw().prepare('SELECT * FROM accounts').all())).not.toContain('password-a')
    db.close();db=new Database(join(dir,'data.db'));accounts=new AccountService(db,dir)
    expect(accounts.get(a.id)?.hasPassword).toBe(true)
    expect(accounts.credentials(a.id).password).toBe('password-a');expect(accounts.credentials(b.id).password).toBe('password-b')
  })
  it('omitting the password retains it, replacing it does not affect another account, and username changes require a password',()=>{
    const a=accounts.create(input),b=accounts.create({...input,username:'user-b',password:'password-b'})
    const {password:_,...publicInput}=input
    accounts.update(a.id,{...publicInput,name:'新名称'});expect(accounts.credentials(a.id).password).toBe(input.password)
    accounts.update(a.id,{...publicInput,password:'replacement'});expect(accounts.credentials(a.id).password).toBe('replacement')
    expect(accounts.credentials(b.id).password).toBe('password-b')
    expect(()=>accounts.update(a.id,{...publicInput,username:'changed'})).toThrow('重新输入密码')
  })
  it('invalidates only the changed account profile when login identity changes',()=>{
    const a=accounts.create(input),b=accounts.create(input)
    for(const item of [a,b]){mkdirSync(accounts.profileDir(item.id),{recursive:true});writeFileSync(join(accounts.profileDir(item.id),'Cookies'),'cookie')}
    accounts.update(a.id,{...input,name:'重命名'})
    expect(existsSync(join(accounts.profileDir(a.id),'Cookies'))).toBe(true)
    accounts.update(a.id,{...input,loginMethod:'upc-institution'})
    expect(existsSync(accounts.profileDir(a.id))).toBe(false);expect(existsSync(join(accounts.profileDir(b.id),'Cookies'))).toBe(true)
  })
  it('blocks edits and deletion while occupied and blocks deletion of referenced accounts',()=>{
    const a=accounts.create(input),courseId=course(),courses=new CourseService(db,new SettingsService(db))
    occupied=[a.id];expect(()=>accounts.update(a.id,input)).toThrow('正在运行');expect(()=>accounts.remove(a.id)).toThrow('正在运行');occupied=[]
    const flows=new WorkflowService(db,courses,()=>false,accounts)
    const flow=flows.create({name:'工作流',steps:[{id:'step',accountId:a.id,courseId,options:DEFAULT_COURSE_OPTIONS}],schedule:null})
    expect(()=>accounts.remove(a.id)).toThrow('任务引用')
    flows.remove(flow.id);accounts.remove(a.id);expect(accounts.list()).toEqual([])
    expect(existsSync(join(dir,'account-credentials',`${a.id}.bin`))).toBe(false)
  })
  it('stores progress per account/course and retains the pair across workflows, renames and restart',()=>{
    const a=accounts.create(input),b=accounts.create(input),courseId=course()
    accounts.markRun(a.id,courseId);accounts.saveProgress(a.id,courseId,'A 第二章');accounts.saveProgress(b.id,courseId,'B 第一章')
    accounts.update(a.id,{...input,name:'改名'})
    expect(accounts.continuation(a.id,courseId)).toBe('A 第二章');expect(accounts.continuation(b.id,courseId)).toBe('B 第一章')
    expect(accounts.progress(courseId).find(p=>p.accountId===a.id)?.lastRunAt).toBeTruthy()
    db.close();db=new Database(join(dir,'data.db'));accounts=new AccountService(db,dir)
    expect(accounts.continuation(a.id,courseId)).toBe('A 第二章')
    accounts.remove(a.id);expect(accounts.progress(courseId)).toHaveLength(1)
  })
  it('uses isolated output directories even for equal names',()=>{
    const a=accounts.create(input),b=accounts.create(input),c={id:'course-1',name:'同名课'}
    expect(accounts.transcriptFolderName(a,c)).not.toBe(accounts.transcriptFolderName(b,c))
    expect(accounts.transcriptFolderName(a,c)).not.toBe(accounts.transcriptFolderName(a,{...c,id:'course-2'}))
  })
  it('memory-only password replacement removes stale ciphertext and expires after restart',()=>{
    const a=accounts.create(input)
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    accounts.update(a.id,{...input,password:'memory-only'})
    expect(accounts.get(a.id)).toMatchObject({hasPassword:true,encryptionAvailable:false})
    expect(existsSync(join(dir,'account-credentials',`${a.id}.bin`))).toBe(false)
    expect(accounts.credentials(a.id).password).toBe('memory-only')
    accounts=new AccountService(db,dir);expect(accounts.get(a.id)?.hasPassword).toBe(false)
  })
  it('rejects invalid IDs and account inputs without writing records',()=>{
    expect(()=>accounts.profileDir('../outside')).toThrow('ID')
    expect(()=>accounts.create({...input,name:''})).toThrow('名称')
    expect(()=>accounts.create({...input,loginMethod:'upc',loggedUrl:'file:///tmp'})).toThrow('跳转地址')
    expect(()=>accounts.create({...input,password:''})).toThrow('密码')
    expect(accounts.list()).toEqual([])
  })
  it('rejects an explicit old database before changing any contents and defaults to an empty separate directory',()=>{
    const legacy=join(dir,'auto-course');mkdirSync(legacy)
    const path=join(legacy,'auto_course.db'),old=new BetterSqlite3(path)
    old.exec("CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES('keep'); PRAGMA user_version=5;");old.close()
    const before=readFileSync(path)
    expect(()=>new Database(path)).toThrow('旧版数据')
    expect(readFileSync(path)).toEqual(before)
    const next=userDataDirectory(dir);expect(next).toBe(join(dir,'auto-course-v3'));mkdirSync(next)
    const fresh=new Database(join(next,'auto_course.db'));expect(new AccountService(fresh,next).list()).toEqual([]);expect(new SettingsService(fresh).getAll().loginMethod).toBe('zhihuishu');fresh.close()
    expect(readFileSync(path)).toEqual(before)
  })
})
