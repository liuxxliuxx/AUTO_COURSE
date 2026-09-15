import type { AppApi } from '@shared/ipc'

declare global {
  interface Window {
    appApi: AppApi
  }
}

export {}
