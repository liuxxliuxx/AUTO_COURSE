import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CredentialState } from '@shared/types'
export const useAccountStore = defineStore('account', () => {
  const username = ref('')
  const state = ref<CredentialState>({ hasUsername: false, hasPassword: false, encryptionAvailable: true })
  async function load(): Promise<void> {
    const [profile, next] = await Promise.all([window.appApi.credentials.get(), window.appApi.credentials.state()])
    username.value = profile.username; state.value = next
  }
  async function save(next: { username: string; password?: string }): Promise<void> {
    state.value = await window.appApi.credentials.set(next); username.value = next.username
  }
  return { username, state, load, save }
})
