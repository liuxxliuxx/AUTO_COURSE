export interface AppInfo {
  name: string; version: string; commit: string; builtAt: string
  electron: string; chrome: string; node: string; platform: NodeJS.Platform; arch: string
  homepage: string; issues: string; releases: string; author: string; license: string; packaged: boolean
}
export type SupportResource = 'guide' | 'project' | 'licenses' | 'data'
