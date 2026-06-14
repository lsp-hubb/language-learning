<script setup>
import { useRoute, useRouter } from 'vue-router'
import { ref, onMounted } from 'vue'
import { fetchArticle } from '@/api'

const route = useRoute()
const router = useRouter()

const article = ref(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await fetchArticle(route.params.id)
    article.value = res.data
  } catch (e) {
    console.error('加载文章失败:', e)
  }
  loading.value = false
})

function goBack() {
  router.push('/')
}
</script>

<template>
  <div class="review-page" v-if="article">
    <button class="back-btn" @click="goBack">← 返回</button>
    <h1>{{ article.title }}</h1>
    <p class="placeholder">复习功能待开发</p>
  </div>
  <div v-else-if="!loading" class="loading">文章不存在</div>
  <div v-else class="loading">加载中...</div>
</template>

<style scoped>
.review-page {
  max-width: 800px;
  margin: 40px auto;
  padding: 0 20px;
}
.back-btn {
  margin-bottom: 20px;
  padding: 8px 16px;
  border: 1px solid #d4c4a8;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 14px;
}
.back-btn:hover {
  background: #f5f0e8;
}
.placeholder {
  color: #999;
  font-style: italic;
  margin-top: 40px;
  text-align: center;
}
.loading {
  text-align: center;
  padding: 60px;
  color: #999;
}
</style>
