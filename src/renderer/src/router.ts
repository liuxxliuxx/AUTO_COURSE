import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from './pages/WorkflowRuns.vue'
import Workflows from './pages/Workflows.vue'
import Settings from './pages/Settings.vue'
import About from './pages/About.vue'
import Accounts from './pages/Accounts.vue'
import Courses from './pages/Courses.vue'
export const router = createRouter({ history: createWebHashHistory(), routes: [
  { path: '/', redirect: '/accounts' },
  { path: '/accounts', name: 'accounts', component: Accounts },
  { path: '/courses', name: 'courses', component: Courses },
  { path: '/workflows', name: 'workflows', component: Workflows },
  { path: '/run', name: 'dashboard', component: Dashboard },
  { path: '/about', name: 'about', component: About },
  { path: '/settings', name: 'settings', component: Settings }
] })
