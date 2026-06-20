<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import CodeGate from '@/components/CodeGate.vue'

const router = useRouter()
const ready = ref(false)

function onVerified() {
  // 仅在首页（/）时恢复上次文章页面；新标签打开具体文章时不覆盖
  if (window.location.pathname === '/' || window.location.pathname === '') {
    const last = localStorage.getItem('lastPage')
    if (last && last.startsWith('article:')) {
      const articleId = last.slice(8)
      router.replace({ name: 'article', params: { id: articleId } })
    }
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
