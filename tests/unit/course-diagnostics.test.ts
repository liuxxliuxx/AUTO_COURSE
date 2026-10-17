import { mkdtemp, readdir, readFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Page } from 'playwright-core'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { CourseDiagnostics } from '../../src/main/services/course-diagnostics'
import { secretLogContext, type Logger } from '../../src/main/services/logger'

let directory:string
const log:Logger={info:vi.fn(),warn:vi.fn(),error:vi.fn(),debug:vi.fn(),exception:vi.fn()}
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'ac-diagnostic-'));vi.clearAllMocks()})
afterEach(async()=>{await rm(directory,{recursive:true,force:true})})
const data={html:'<!doctype html><html>sanitized</html>',url:'https://example.test/course',video:null}
function pageStub(){
  const evaluate=vi.fn(async()=>data),screenshot=vi.fn(async()=>Buffer.from('image'))
  return {evaluate,screenshot,page:{isClosed:()=>false,locator:()=>({evaluate}),frames:()=>[],screenshot} as unknown as Page}
}
async function evidence(){const folder=join(directory,(await readdir(directory))[0]);return {folder,state:JSON.parse(await readFile(join(folder,'state.json'),'utf8'))}}
const service=()=>new CourseDiagnostics(directory,{runId:'run',stepId:'step',courseId:'course'},log,{dom:50,screenshot:50})

describe('diagnostic failures preserve independent artifacts',()=>{
  it('writes the error summary before attempting renderer access, even if both collectors fail',async()=>{
    const p=pageStub(),diagnostics=service()
    p.evaluate.mockImplementation(async()=>{
      expect((await evidence()).state).toMatchObject({reason:'original failure',captureStatus:'capturing'})
      throw new Error('DOM unavailable')
    })
    p.screenshot.mockRejectedValue(new Error('compositor unavailable'))
    const path=await diagnostics.capture(p.page,{reason:'original failure'})
    expect(path).not.toBeNull()
    expect((await evidence()).state).toMatchObject({reason:'original failure',captureStatus:'partial',artifacts:{dom:'failed',screenshot:'failed'},domError:'Error: DOM unavailable',screenshotError:'Error: compositor unavailable'})
    await diagnostics.finish()
    expect((await readdir(directory)).length).toBe(1)
  })
  it('DOM evaluation failure does not prevent a screenshot',async()=>{
    const p=pageStub(),diagnostics=service();p.evaluate.mockRejectedValue(new Error('DOM unavailable'))
    await diagnostics.capture(p.page,{reason:'failure'})
    const {folder,state}=await evidence()
    expect(await readFile(join(folder,'screen.png'))).toEqual(Buffer.from('image'))
    expect(state.artifacts).toEqual({dom:'failed',screenshot:'saved'})
    await diagnostics.finish()
  })
  it('a DOM file write failure does not delete metadata or prevent a screenshot',async()=>{
    const p=pageStub(),diagnostics=service()
    p.evaluate.mockImplementation(async()=>{await mkdir(join((await evidence()).folder,'dom.html'));return data})
    await diagnostics.capture(p.page,{reason:'failure'})
    const {folder,state}=await evidence()
    expect(state.artifacts).toEqual({dom:'failed',screenshot:'saved'})
    expect((await readFile(join(folder,'screen.png'))).length).toBeGreaterThan(0)
    await diagnostics.finish()
  })
  it('hung DOM and screenshot operations are bounded and late results do not write files',async()=>{
    const p=pageStub(),diagnostics=service()
    let complete!:(bytes:Buffer<ArrayBuffer>)=>void
    p.evaluate.mockImplementation(()=>new Promise(()=>{}))
    p.screenshot.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
    const started=Date.now()
    expect(await diagnostics.capture(p.page,{reason:'hung page'})).not.toBeNull()
    expect(Date.now()-started).toBeLessThan(2000)
    const {folder,state}=await evidence()
    expect(state.artifacts).toEqual({dom:'failed',screenshot:'failed'})
    complete(Buffer.from('late image'));await Promise.resolve()
    expect(await readdir(folder)).toEqual(['state.json'])
    await diagnostics.finish()
  })
  it('records a closed or missing browser as partial evidence, retaining the original reason',async()=>{
    const diagnostics=service()
    await diagnostics.capture(null,{reason:'browser launch failed',phase:'preparing'})
    expect((await evidence()).state).toMatchObject({reason:'browser launch failed',phase:'preparing',captureStatus:'partial'})
    await diagnostics.finish()
  })
  it('redacts collector errors as well as the original failure',async()=>{
    const p=pageStub(),diagnostics=service()
    p.evaluate.mockRejectedValue(new Error('private-password'))
    p.screenshot.mockRejectedValue(new Error('private-password'))
    await secretLogContext.run(['private-password'],()=>diagnostics.capture(p.page,{reason:'private-password'}))
    expect(JSON.stringify((await evidence()).state)).not.toContain('private-password')
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain('private-password')
    await diagnostics.finish()
  })
})
