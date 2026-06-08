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
  return paragraphs.slice(0, 3).join('\n')
})

function onFavClick(e) {
  e.stopPropagation()
  store.toggleFavorite(props.article.id)
}
</script>

<template>
  <div class="article-card" @click="emit('view', article.id)">
    <div class="card-top-bar">
      <button
        class="fav-btn"
        :class="{ favorited: store.isFavorited(article.id) }"
        @click="onFavClick"
        title="收藏"
      >★</button>
    </div>
    <div class="card-body">
      <h3 class="card-title">{{ article.title }}</h3>
      <div class="card-excerpt">{{ preview }}</div>
    </div>
  </div>
</template>

<style scoped>
.article-card {
  position: relative;
  width: 320px;
  min-height: 180px;
  background: #fcf9f4;
  border: 1px solid #e8e0d4;
  border-radius: 4px;
  cursor: default;
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.25s ease, border-color 0.25s ease;
}
.article-card:hover {
  border-color: #c8bca8;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.card-top-bar {
  position: relative;
  height: 4px;
  background: linear-gradient(90deg, #8b3a2a 0%, #c49a6c 60%, #5a7a5a 100%);
  border-radius: 4px 4px 0 0;
  flex-shrink: 0;
}

.fav-btn {
  position: absolute;
  top: -4px;
  right: 6px;
  z-index: 1;
  border: none;
  background: none;
  font-size: 20px;
  color: #d4c5b0;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.2s, transform 0.2s;
}
.fav-btn:hover {
  color: #f0b400;
  transform: scale(1.2);
}
.fav-btn.favorited {
  color: #f0b400;
}

.card-body {
  flex: 1;
  padding: 18px 20px 16px;
  display: flex;
  flex-direction: column;
}

.card-title {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 18px;
  font-weight: 700;
  color: #1a1a1a;
  line-height: 1.35;
  letter-spacing: -0.3px;
  margin: 0 0 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  overflow: hidden;
}

.card-excerpt {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 13px;
  color: #5a5a5a;
  line-height: 1.65;
  white-space: pre-wrap;
  margin: 0;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  line-clamp: 4;
  overflow: hidden;
}

</style>
