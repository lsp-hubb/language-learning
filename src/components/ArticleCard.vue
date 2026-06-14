<script setup>
import { computed } from 'vue'
import { useFileExplorerStore } from '@/stores/fileExplorer'

const props = defineProps({
  article: { type: Object, required: true },
})
const emit = defineEmits(['view'])
const store = useFileExplorerStore()

const preview = computed(() => {
  if (!props.article.content) return ''
  const paragraphs = props.article.content.split('\n').filter(Boolean)
  return paragraphs[1] || ''
})

function onFavClick(e) {
  e.stopPropagation()
  store.toggleFavorite(props.article.id)
}

function onReviewClick(e) {
  e.stopPropagation()
  const url = window.location.origin + `/review/${props.article.id}`
  window.open(url, '_blank')
}
</script>

<template>
  <div class="card" @click="emit('view', article.id)">
    <div class="card-header">
      <h1 class="title">{{ article.title }}</h1>
      <div class="icons">
        <span class="icon-btn" title="复习" @click="onReviewClick">📝</span>
        <span
          class="icon-btn fav-star"
          title="收藏"
          :class="{ favorited: store.isFavorited(article.id) }"
          @click="onFavClick"
        >{{ store.isFavorited(article.id) ? '★' : '☆' }}</span>
      </div>
    </div>
    <p class="subtitle" v-if="preview">{{ preview }}</p>
  </div>
</template>

<style scoped>
.card {
  width: 100%;
  background: linear-gradient(135deg, #fffaf0 0%, #fff 100%);
  border: 2px solid #d4c4a8;
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  position: relative;
  overflow: hidden;
  cursor: default;
  transition: box-shadow 0.25s ease, border-color 0.25s ease;
  box-sizing: border-box;
}
.card:hover {
  border-color: #b36b5e;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.title {
  font-size: 22px;
  font-weight: bold;
  color: #2c2c2c;
  margin: 0;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  overflow: hidden;
  flex: 1;
  min-width: 0;
}

.icons {
  display: flex;
  gap: 14px;
  font-size: 22px;
  color: #888;
  flex-shrink: 0;
}
.icon-btn {
  cursor: pointer;
  transition: color 0.2s, transform 0.2s;
  user-select: none;
  width: 28px;
  text-align: center;
  display: inline-block;
}
.icon-btn:hover {
  color: #b36b5e;
  transform: scale(1.15);
}
.fav-star {
  width: 26px;
}
.fav-star.favorited {
  color: #f0c040;
}

.subtitle {
  font-size: 17px;
  color: #555;
  line-height: 1.6;
  margin: 0;
  font-style: italic;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  line-clamp: 3;
  overflow: hidden;
}

@media (max-width: 600px) {
  .card {
    padding: 20px;
  }
  .title {
    font-size: 20px;
  }
  .subtitle {
    font-size: 15px;
  }
}
</style>
