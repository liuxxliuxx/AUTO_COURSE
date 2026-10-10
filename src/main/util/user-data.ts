import { existsSync } from 'node:fs'
import { join } from 'node:path'
/** Display names must not move existing databases. Never merge or overwrite data. */
export function userDataDirectory(base: string): string {
  const directories = ['ZhiHuiShu AutoCourse', 'auto-course'].map(name => join(base, name))
  return directories.find(path => existsSync(join(path, 'auto_course.db'))) ?? join(base, 'auto-course')
}
