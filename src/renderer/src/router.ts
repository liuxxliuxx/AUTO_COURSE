import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from './pages/Dashboard.vue'
import Settings from './pages/Settings.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/settings', name: 'settings', component: Settings }
  ]
})
