import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { userDataDirectory } from '../../src/main/util/user-data'
let base: string
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'ac-path-')) })
afterEach(() => rmSync(base, { recursive:true, force:true }))
function existing(name: string): string { const dir = join(base,name); mkdirSync(dir); writeFileSync(join(dir,'auto_course.db'),'existing'); return dir }
it('fresh installs use the stable auto-course directory', () => expect(userDataDirectory(base)).toBe(join(base,'auto-course')))
it('keeps previously packaged v2 data', () => { const dir = existing('ZhiHuiShu AutoCourse'); expect(userDataDirectory(base)).toBe(dir) })
it('keeps existing development v2 data', () => { const dir = existing('auto-course'); expect(userDataDirectory(base)).toBe(dir) })
it('prefers the previous packaged installation if both contain data', () => { existing('auto-course'); const packaged = existing('ZhiHuiShu AutoCourse'); expect(userDataDirectory(base)).toBe(packaged) })
it('an empty old directory must not hide an existing database', () => { mkdirSync(join(base,'ZhiHuiShu AutoCourse')); const dev = existing('auto-course'); expect(userDataDirectory(base)).toBe(dev) })
