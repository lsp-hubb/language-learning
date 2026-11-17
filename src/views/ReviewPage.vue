<script setup>
import { useRoute, useRouter } from 'vue-router'
import { ref, provide, onMounted } from 'vue'
import { fetchArticle, fetchAnnotations } from '@/api'
import NotePanel from '@/components/NotePanel.vue'

const route = useRoute()
const router = useRouter()

const article = ref(null)
const loading = ref(true)

// 批注桥：复习页只读，NotePanel 的批注视图从这里取数据（无需正文标注 / 定位能力）
const annotations = ref([])
provide('annotationBridge', { annotations })

onMounted(async () => {
  try {
    const res = await fetchArticle(route.params.id)
    article.value = res.data
    const a = await fetchAnnotations(route.params.id)
    annotations.value = a.data || []
  } catch (e) {
    console.error('加载复习内容失败:', e)
  }
  loading.value = false
})

function goBack() {
  router.push('/')
}
</script>

<template>
  <NotePanel
    v-if="article"
    :article-id="route.params.id"
    :visible="true"
    review-mode
    @review-close="goBack"
  />
  <div v-else-if="!loading" class="loading">文章不存在</div>
  <div v-else class="loading">加载中...</div>
</template>

<style scoped>
.loading {
  text-align: center;
  padding: 60px;
  color: #999;
}
</style>
