import { existsSync } from 'node:fs'
import { join } from 'node:path'
/** v3 never imports, merges, or opens previous installation data. */
export function userDataDirectory(base: string): string { return join(base, 'auto-course-v3') }
export function legacyDataDirectory(base: string): string | null {
  return ['ZhiHuiShu AutoCourse', 'auto-course'].map(name => join(base,name))
    .find(path => existsSync(join(path,'auto_course.db'))) ?? null
}
