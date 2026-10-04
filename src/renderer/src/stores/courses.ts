import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CourseLibrary, CourseMutationResult } from '@shared/types'
import { DEFAULT_COURSE_OPTIONS } from '@shared/courses'
export const useCoursesStore = defineStore('courses', () => {
  const library = ref<CourseLibrary>({ courses: [], selectedCourseId: null, defaults: { ...DEFAULT_COURSE_OPTIONS } })
  const viewedCourseId=ref('')
  const loading = ref(false)
  const error = ref('')
  const selected = computed(() => library.value.courses.find(c => c.id === library.value.selectedCourseId) ?? null)
  async function load(): Promise<void> {
    loading.value = true; error.value = ''
    try { library.value = await window.appApi.courses.list() }
    catch (e) { error.value = String(e) }
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
  return { library, viewedCourseId, loading, error, selected, load, accept, select }
})
