import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from './pages/Dashboard.vue'
import Settings from './pages/Settings.vue'
import Courses from './pages/Courses.vue'
export const router = createRouter({ history: createWebHashHistory(), routes: [
  { path: '/', redirect: '/courses' },
  { path: '/courses', name: 'courses', component: Courses },
  { path: '/run', name: 'dashboard', component: Dashboard },
  { path: '/settings', name: 'settings', component: Settings }
] })
