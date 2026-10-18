import { errorMessage } from '../lib/ui-copy'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CourseLibrary, CourseMutationResult } from '@shared/types'
import { DEFAULT_COURSE_OPTIONS } from '@shared/courses'
import { emptyDiscoveryStatus } from '@shared/course-discovery'
export const useCoursesStore = defineStore('courses', () => {
  const library = ref<CourseLibrary>({ courses: [], selectedCourseId: null, defaults: { ...DEFAULT_COURSE_OPTIONS } })
  const viewedCourseId=ref('')
  const loading = ref(false)
  const error = ref('')
  const discovery = ref(emptyDiscoveryStatus())
  const discovering = ref(false)
  let discoveryRevision = 0
  const discoveryActive = computed(() => discovering.value || ['running', 'waiting', 'stopping'].includes(discovery.value.phase))
  async function discover(accountId: string): Promise<void> {
    if (discoveryActive.value) return
    discovering.value = true; discoveryRevision++
    try {
      const result = await window.appApi.courses.discover(accountId)
      discoveryRevision++
      discovery.value = result.status; library.value = result.library
    } finally { discovering.value = false }
  }
  async function refreshDiscovery(): Promise<void> {
    const revision = discoveryRevision
    const status = await window.appApi.courses.discoveryStatus()
    if (status && revision === discoveryRevision) discovery.value = status
  }
  const selected = computed(() => library.value.courses.find(c => c.id === library.value.selectedCourseId) ?? null)
  async function load(): Promise<void> {
    loading.value = true; error.value = ''
    try { library.value = await window.appApi.courses.list() }
    catch (e) { error.value = errorMessage(e) }
    finally { loading.value = false }
  }
  function accept(result: CourseMutationResult): CourseMutationResult {
    if (result.ok) { library.value = result.library; error.value = '' }
    return result
  }
  async function select(id: string): Promise<void> {
    const result = accept(await window.appApi.courses.select(id))
    if (!result.ok) throw new Error(result.message)
  }
  return { library, viewedCourseId, loading, error, selected, load, accept, select,
    discovery, discoveryActive, discover, refreshDiscovery }
})
