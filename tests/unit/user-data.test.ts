import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { userDataDirectory, legacyDataDirectory } from '../../src/main/util/user-data'
let base: string
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'ac-path-')) })
afterEach(() => rmSync(base, { recursive:true, force:true }))
function existing(name: string): string { const dir = join(base,name); mkdirSync(dir); writeFileSync(join(dir,'auto_course.db'),'existing'); return dir }
it('fresh installs use the separate v3 directory',()=>expect(userDataDirectory(base)).toBe(join(base,'auto-course-v3')))
it('old packaged and development data never change v3 selection',()=>{existing('ZhiHuiShu AutoCourse');existing('auto-course');expect(userDataDirectory(base)).toBe(join(base,'auto-course-v3'));expect(legacyDataDirectory(base)).toBe(join(base,'ZhiHuiShu AutoCourse'))})
it('legacy directory lookup returns null if absent',()=>expect(legacyDataDirectory(base)).toBeNull())
