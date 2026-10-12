import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Account, AccountInput } from '@shared/accounts'
export const useAccountStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  async function load(): Promise<void> { accounts.value = await window.appApi.accounts.list() }
  async function save(id: string | null, input: AccountInput): Promise<void> {
    if (id) await window.appApi.accounts.update(id,input)
    else await window.appApi.accounts.create(input)
    await load()
  }
  async function remove(id: string): Promise<void> { await window.appApi.accounts.remove(id); await load() }
  return {accounts,load,save,remove}
})
