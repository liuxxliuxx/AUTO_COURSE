<script setup lang="ts">
import { UNSAVED_CONFIRM, errorText } from '../lib/ui-copy'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useAccountStore } from '../stores/account'
import { useWorkflowsStore } from '../stores/workflows'
import type { Account, AccountInput } from '@shared/accounts'
import WorkspaceToolbar from '../components/WorkspaceToolbar.vue'
import WorkspaceSplit from '../components/WorkspaceSplit.vue'
import ToolRow from '../components/ToolRow.vue'
import ChoiceButtons from '../components/ChoiceButtons.vue'
const store = useAccountStore(), workflows = useWorkflowsStore()
const selected = ref(''), draft = ref<AccountInput | null>(null), editingId = ref<string | null>(null), baseline = ref('')
const search = ref(''), error = ref(''), message = ref(''), busy = ref(false), nameInput = ref<HTMLInputElement | null>(null)
const current = computed(() => store.accounts.find(a=>a.id===selected.value))
const visible = computed(() => store.accounts.filter(a=>`${a.name} ${a.username}`.toLowerCase().includes(search.value.toLowerCase())))
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value)!==baseline.value)
const occupying = (id: string) => workflows.running.find(r=>r.snapshot.steps.some(s=>s.accountId===id))
const referenced = (id: string) => workflows.flows.some(f=>f.steps.some(s=>s.accountId===id))
const methods = {zhihuishu:'智慧树','upc-institution':'机构 SSO',upc:'旧门户'}
function mayLeave(): boolean { return !busy.value && (!dirty.value || window.confirm(UNSAVED_CONFIRM)) }
onBeforeRouteLeave(mayLeave)
function beforeUnload(event: BeforeUnloadEvent): void { if (dirty.value || busy.value) {event.preventDefault();event.returnValue=''} }
onMounted(async () => { window.addEventListener('beforeunload',beforeUnload); try { await store.load(); selected.value=store.accounts[0]?.id??'' } catch(e) {error.value=errorText('加载账号', e)} })
onBeforeUnmount(() => window.removeEventListener('beforeunload',beforeUnload))
function choose(id: string): void { if (!mayLeave())return; selected.value=id;draft.value=null;error.value='';message.value='' }
async function edit(account?: Account): Promise<void> {
  if (!mayLeave())return
  editingId.value=account?.id??null
  draft.value={name:account?.name??'',username:account?.username??'',loginMethod:account?.loginMethod??'zhihuishu',loggedUrl:account?.loggedUrl??'',password:''}
  baseline.value=JSON.stringify(draft.value);error.value='';message.value=''
  await nextTick();nameInput.value?.focus()
}
function cancel(): void { if(mayLeave()){draft.value=null;error.value=''} }
async function save(): Promise<void> {
  if (!draft.value || busy.value)return
  busy.value=true;error.value='';message.value=''
  try {
    const value={...draft.value};if(!value.password)delete value.password
    await store.save(editingId.value,value)
    selected.value=editingId.value??store.accounts.at(-1)?.id??''
    draft.value=null;message.value='账号已保存'
  } catch(e) {error.value=errorText('保存账号', e) + '；输入已保留'}
  finally {busy.value=false}
}
async function remove(): Promise<void> {
  if (!current.value || busy.value)return
  if(!window.confirm(`删除账号“${current.value.name}”？该账号的登录状态和学习进度也会删除，运行历史与转录文件保留。`))return
  busy.value=true;error.value=''
  try {await store.remove(current.value.id);selected.value=store.accounts[0]?.id??'';message.value='账号已删除'}
  catch(e){error.value=errorText('删除账号', e)}
  finally{busy.value=false}
}
</script>
<template>
  <div class="page accounts-page">
    <WorkspaceToolbar title="账号"><button class="primary" :disabled="busy" @click="edit()">添加账号</button></WorkspaceToolbar>
    <div v-if="error" class="notice error" role="alert">{{error}}</div><div v-if="message" class="notice success" role="status">{{message}}</div>
    <WorkspaceSplit>
      <template #list>
        <div class="account-search"><input v-model="search" type="search" aria-label="搜索账号" placeholder="搜索账号名称或用户名"/></div>
        <ToolRow v-for="account in visible" :key="account.id" :selected="selected===account.id" @click="choose(account.id)"><strong>{{account.name}}</strong><small>{{account.username}}</small><span v-if="occupying(account.id)" class="badge green">运行中</span><small v-else>{{methods[account.loginMethod]}}</small></ToolRow>
        <p v-if="!visible.length" class="empty">{{store.accounts.length?'没有匹配的账号':'添加账号后，可在任务步骤中选择使用。'}}</p>
      </template>
      <form v-if="draft" class="stack account-form" @submit.prevent="save">
        <h2>{{editingId?'编辑账号':'添加账号'}}</h2>
        <div v-if="editingId && store.accounts.find(a=>a.id===editingId)?.encryptionAvailable===false" class="notice warning">系统加密不可用，密码仅在本次会话保留，重启后需重新输入。</div>
        <fieldset class="stack" :disabled="busy">
          <div class="field"><label for="account-name">账号名称</label><input id="account-name" ref="nameInput" v-model="draft.name" required placeholder="例如：我的账号"/></div>
          <div class="field"><label for="account-method">登录方式</label><ChoiceButtons id="account-method" v-model="draft.loginMethod" label="登录方式" :choices="[{value:'zhihuishu',label:'智慧树'},{value:'upc-institution',label:'机构 SSO'},{value:'upc',label:'旧门户'}]"/></div>
          <div class="field"><label for="account-username">登录账号</label><input id="account-username" v-model="draft.username" autocomplete="username" required placeholder="手机号或统一认证账号"/></div>
          <div class="field"><label for="account-password">密码</label><input id="account-password" v-model="draft.password" type="password" autocomplete="new-password" :required="!editingId || !store.accounts.find(a=>a.id===editingId)?.hasPassword" :placeholder="editingId && store.accounts.find(a=>a.id===editingId)?.hasPassword?'留空保留已保存的密码':'输入密码'"/><small>更换登录账号时需要重新输入密码。</small></div>
          <div v-if="draft.loginMethod==='upc'" class="field"><label for="account-url">登录跳转地址</label><input id="account-url" v-model="draft.loggedUrl" type="url" required placeholder="https://…"/></div>
        </fieldset>
        <p class="muted small">修改登录账号、登录方式或跳转地址后，下次运行需要重新登录。</p>
        <div class="actions"><button type="button" :disabled="busy" @click="cancel">取消</button><button class="primary" :disabled="busy" type="submit">{{busy?'正在保存…':'保存账号'}}</button></div>
      </form>
      <section v-else-if="current" class="stack account-form">
        <h2>{{current.name}}</h2><p>{{current.username}} · {{methods[current.loginMethod]}}</p>
        <div v-if="!current.encryptionAvailable" class="notice warning">系统加密不可用，密码仅在本次会话保留。</div>
        <p class="muted">{{current.hasPassword?'密码已保存':'密码未保存，请编辑账号重新输入'}}</p>
        <p v-if="current.loginMethod==='upc'" class="account-url">{{current.loggedUrl}}</p>
        <div v-if="occupying(current.id)" class="notice">任务“{{occupying(current.id)!.snapshot.workflow.name}}”正在使用此账号。<RouterLink :to="{path:'/run',query:{id:occupying(current.id)!.id}}">查看运行</RouterLink></div>
        <div class="actions"><button :disabled="busy||!!occupying(current.id)" @click="edit(current)">编辑</button><button class="danger" :disabled="busy||!!occupying(current.id)||referenced(current.id)" :title="referenced(current.id)?'账号被任务引用，请先移除对应步骤':'删除账号'" @click="remove">删除</button></div>
        <small v-if="referenced(current.id)" class="muted">此账号被任务引用，移除对应步骤后可删除。</small>
      </section>
      <section v-else class="empty"><h2>管理学习账号</h2><p>每个任务步骤选择一个账号和一门课程。不同账号拥有各自的登录状态与续学进度。</p><button class="primary" @click="edit()">添加账号</button></section>
    </WorkspaceSplit>
  </div>
</template>
<style scoped>
.accounts-page {display:flex;flex-direction:column;overflow:hidden}
.account-search {padding:12px;border-bottom:1px solid var(--line)}
.account-form {max-width:640px;gap:20px;padding:8px}
.account-form h2 {font-size:var(--fs-readout);font-weight:600;overflow-wrap:anywhere}
.account-form .field {display:grid;grid-template-columns:110px minmax(0,1fr);gap:6px 12px;align-items:start}
.account-form label {padding-top:7px;color:var(--text-2)}
.account-form .field small {grid-column:2;color:var(--text-3)}
.account-url {overflow-wrap:anywhere}
.accounts-page>.notice {margin:10px 20px 0}
@container(max-width:650px) {.account-form .field {grid-template-columns:1fr}.account-form .field small {grid-column:1}}
</style>
