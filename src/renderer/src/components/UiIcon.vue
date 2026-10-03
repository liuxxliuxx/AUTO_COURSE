<script setup lang="ts">
defineProps<{name:string}>()
const paths:Record<string,string>={stop:'M6 6h12v12H6V6Z',copy:'M9 8h11v13H9V8ZM4 16H3V3h11v2',add:'M12 5v14M5 12h14',edit:'m4 16 12-12 4 4-12 12H4v-4Z',play:'m8 5 11 7-11 7V5Z',back:'m14 5-7 7 7 7',save:'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',courses:'M4 4h7v16H4V4Zm9 0h7v16h-7V4',workflows:'M4 4h6v6H4V4Zm10 10h6v6h-6v-6ZM7 10v7h7',run:'m8 5 11 7-11 7V5Z',settings:'M4 7h16M4 17h16M8 4v6M16 14v6'}
</script>
<template><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]||paths.add"/></svg></template>
