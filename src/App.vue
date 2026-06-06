<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import CodeGate from '@/components/CodeGate.vue'

const router = useRouter()
const ready = ref(false)

function onVerified() {
  const last = localStorage.getItem('lastPage')
  if (last && last.startsWith('article:')) {
    const articleId = last.slice(8)
    router.replace({ name: 'article', params: { id: articleId } })
  }
  ready.value = true
}
</script>

<template>
  <CodeGate @verified="onVerified" />
  <div v-if="ready">
    <router-view />
  </div>
</template>

<style scoped>
</style>
