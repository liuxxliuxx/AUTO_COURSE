import type { LoginMethod } from './types'

export interface AccountInput {
  name: string
  username: string
  loginMethod: LoginMethod
  loggedUrl: string
  /** Omit to retain an existing password. */
  password?: string
}
export interface Account extends Omit<AccountInput, 'password'> {
  id: string
  createdAt: string
  updatedAt: string
  hasPassword: boolean
  encryptionAvailable: boolean
}
export interface AccountCourseProgress {
  accountId: string
  courseId: string
  lastVideoTitle: string | null
  lastRunAt: string | null
  updatedAt: string
}
export interface AccountApi {
  list(): Promise<Account[]>
  create(input: AccountInput): Promise<Account>
  update(id: string, input: AccountInput): Promise<Account>
  remove(id: string): Promise<void>
  progress(courseId: string): Promise<AccountCourseProgress[]>
}
