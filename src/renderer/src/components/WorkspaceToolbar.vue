<script setup lang="ts">defineProps<{title:string}>()</script>
<template><header class="page-header"><h1>{{title}}</h1><div class="actions"><slot/></div></header></template>
