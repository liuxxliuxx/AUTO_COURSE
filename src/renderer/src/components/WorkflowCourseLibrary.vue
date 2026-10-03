<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Course } from '@shared/types'
import { KIND_LABELS } from '@shared/courses'
import { unavailableCourse } from '../lib/workflow-editor'

const props = defineProps<{ courses: Course[]; disabled: boolean; picker: boolean }>()
const search = defineModel<string>('search', { required: true })
const emit = defineEmits<{ add: [course: Course]; close: [] }>()
const input = ref<HTMLInputElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const visible = computed(() => props.courses.filter(course => course.name.toLowerCase().includes(search.value.toLowerCase())))
defineExpose({ focusSearch: () => input.value?.focus(), containsFocus: () => !!panel.value?.contains(document.activeElement) })
</script>

<template>
  <aside ref="panel" class="course-library" :class="{ picker }" aria-label="课程库">
    <header>
      <div class="library-heading"><strong>课程库</strong><button v-if="picker" type="button" @click="emit('close')">关闭</button></div>
      <input ref="input" v-model="search" type="search" aria-label="搜索可添加课程" placeholder="搜索课程" />
    </header>
    <div class="library-rows">
      <div v-for="course in visible" :key="course.id" class="library-row">
        <div :title="course.name"><strong>{{ course.name }}</strong><small>{{ unavailableCourse(course) || KIND_LABELS[course.kind] }}</small></div>
        <button type="button" :aria-label="`添加 ${course.name}`" :disabled="!!unavailableCourse(course) || disabled" @click="emit('add', course)">添加</button>
      </div>
      <p v-if="!visible.length" class="empty">没有匹配的课程</p>
    </div>
  </aside>
</template>

<style scoped>
.course-library { min-width:0;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--line); }
header { padding:12px 16px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px; }
.library-heading { display:flex;align-items:center;justify-content:space-between; }
.library-rows { overflow:auto;min-height:0; }
.library-row { display:flex;gap:8px;align-items:center;padding:8px 12px; }
.library-row>div { min-width:0;flex:1; }
strong { display:block;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
small { display:block;color:var(--text-3); }
@container(max-width:900px) {
  .course-library { display:none; }
  .course-library.picker { display:flex;position:absolute;z-index:5;inset:0 auto 0 0;width:min(320px,100%);background:var(--surface);box-shadow:4px 0 12px #26334522; }
}
</style>
