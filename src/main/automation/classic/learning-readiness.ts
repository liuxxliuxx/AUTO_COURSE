/** Read-only probe: the catalogue renders before prelearningNote creates the study record. */
export interface LearningTarget { title: string; previousSource?: string }
export function inspectLearningReadiness(target?: LearningTarget): { ready: boolean; reason: string; source?: string; title?: string; saving?: { isSaving: boolean; saveDataFilish: boolean } } {
  interface CourseVm {
    $data?: Record<string, unknown>
    $parent?: CourseVm
  }
  const seen = new Set<CourseVm>()
  let data: Record<string, unknown> | undefined
  const inspect = (el: Element): void => {
    let vm = (el as Element & { __vue__?: CourseVm }).__vue__
    while (vm && !seen.has(vm)) {
      seen.add(vm)
      if (vm.$data && 'backDialog' in vm.$data && 'preVideoInfo' in vm.$data) {
        data = vm.$data
        return
      }
      vm = vm.$parent
    }
  }
  for (const el of Array.from(document.querySelectorAll('.ai-helper-sections,li.video,#app,.video-study'))) {
    inspect(el)
    if (data) break
  }
  if (!data) {
    for (const el of Array.from(document.querySelectorAll('*'))) {
      inspect(el)
      if (data) break
    }
  }
  // This probe describes Zhihuishu's classic runtime, not other course engines.
  if (!data) return location.hostname === 'studyvideoh5.zhihuishu.com'
    ? { ready: false, reason: '课程运行状态尚未加载' }
    : { ready: true, reason: '' }
  if (data.isSaving || data.saveDataFilish) return { ready: false, reason: '上一节进度仍在保存或切换中', saving: { isSaving: !!data.isSaving, saveDataFilish: !!data.saveDataFilish } }
  const record = data.preVideoInfo as { studiedLessonDto?: { id?: unknown } } | undefined
  if (!record?.studiedLessonDto?.id) return { ready: false, reason: '学习记录尚未初始化' }
  const video = document.querySelector('video')
  if (!video || video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) {
    return { ready: false, reason: '播放器元数据尚未加载' }
  }
  const title = (document.querySelector('li.video.current_play .catalogue_title') as HTMLElement | null)?.innerText.trim() ?? ''
  const source = video.currentSrc || video.src
  if (target && title !== target.title) return { ready: false, reason: `尚未切换到目标课程「${target.title}」` }
  if (target?.previousSource && source === target.previousSource) return { ready: false, reason: '播放器仍在使用上一节视频' }
  return { ready: true, reason: '', source, title }
}
