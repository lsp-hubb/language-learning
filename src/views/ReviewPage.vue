<script setup>
import { useRoute, useRouter } from 'vue-router'
import { ref, computed, provide, onMounted } from 'vue'
import { fetchArticle, fetchAnnotations } from '@/api'
import { normalizeQuotes } from '@/utils/normalizeQuotes'
import NotePanel from '@/components/NotePanel.vue'

const route = useRoute()
const router = useRouter()

const article = ref(null)
const loading = ref(true)

// 批注桥：和文章页同形状，NotePanel 的批注视图取 annotations，
// 英文行镜像批注走 paragraphs + findTextInParagraphs 的坐标投影（否则走文本回退会把片段切短）。
const annotations = ref([])
const paragraphs = computed(() => {
  const content = article.value?.content
  if (!content) return []
  return normalizeQuotes(content)
    .split('\n')
    .filter((l) => l.trim())
})
// 与文章页一致：只做等长归一的 key，用于把笔记英文行文本定位到正文段落坐标
function normKey(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
}
function findTextInParagraphs(text) {
  const key = normKey(text)
  if (!key) return null
  const list = paragraphs.value || []
  for (let i = 0; i < list.length; i++) {
    const idx = normKey(list[i]).indexOf(key)
    if (idx !== -1) {
      return {
        paragraphIndex: i,
        startOffset: idx,
        endOffset: idx + key.length,
        text: list[i].slice(idx, idx + key.length),
      }
    }
  }
  return null
}
provide('annotationBridge', { annotations, paragraphs, findTextInParagraphs })

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

function goToOriginal() {
  router.push({ name: 'article', params: { id: route.params.id } })
}
</script>

<template>
  <NotePanel
    v-if="article"
    :article-id="route.params.id"
    :visible="true"
    review-mode
    @review-close="goBack"
    @review-open-original="goToOriginal"
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
