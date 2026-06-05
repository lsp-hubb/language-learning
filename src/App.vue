<script setup>
import { ref } from 'vue'
import CodeGate from '@/components/CodeGate.vue'

const gatePassed = ref(false)
</script>

<template>
  <CodeGate @verified="gatePassed = true" />
  <div v-if="gatePassed">
    <router-view />
  </div>
</template>

<style scoped>
</style>
