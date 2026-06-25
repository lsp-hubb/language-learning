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
  const text = paragraphs[1] || ''
  return text.length > 120 ? text.slice(0, 120) + '…' : text
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
        <span class="icon-btn" title="复习" @click="onReviewClick">📜</span>
        <span
          class="icon-btn fav-bookmark"
          title="收藏"
          :class="{ favorited: store.isFavorited(article.id) }"
          @click="onFavClick"
        >
          <svg
            v-if="store.isFavorited(article.id)"
            viewBox="0 0 384 512"
            width="20"
            height="20"
            fill="currentColor"
          >
            <path
              d="M0 48V487.7C0 501.1 10.9 512 24.3 512c5 0 9.9-1.5 14-4.4L192 400 345.7 507.6c4.1 2.9 9 4.4 14 4.4c13.4 0 24.3-10.9 24.3-24.3V48c0-26.5-21.5-48-48-48H48C21.5 0 0 21.5 0 48z"
            />
          </svg>
          <svg
            v-else
            viewBox="0 0 384 512"
            width="20"
            height="20"
            fill="transparent"
            stroke="currentColor"
            stroke-width="36"
          >
            <path
              d="M0 48V487.7C0 501.1 10.9 512 24.3 512c5 0 9.9-1.5 14-4.4L192 400 345.7 507.6c4.1 2.9 9 4.4 14 4.4c13.4 0 24.3-10.9 24.3-24.3V48c0-26.5-21.5-48-48-48H48C21.5 0 0 21.5 0 48z"
            />
          </svg>
        </span>
      </div>
    </div>
    <p class="subtitle" v-if="preview">{{ preview }}</p>
  </div>
</template>

<style scoped>
.card {
  width: 100%;
  min-width: 0;
  background: linear-gradient(135deg, #fffaf0 0%, #fff 100%);
  border: 2px solid #d4c4a8;
  border-radius: 12px;
  padding: 16px 30px 30px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  position: relative;
  overflow: hidden;
  contain: paint;
  cursor: default;
  transition:
    box-shadow 0.25s ease,
    border-color 0.25s ease;
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
  margin-bottom: 8px;
}

.title {
  font-size: 20px;
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
  font-size: 20px;
  color: #888;
  flex-shrink: 0;
}
.icon-btn {
  cursor: pointer;
  transition:
    color 0.2s,
    transform 0.2s;
  user-select: none;
  width: 28px;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-btn:hover {
  color: #b36b5e;
  transform: scale(1.15);
}
.fav-bookmark {
  width: 28px;
  opacity: 0.45;
  color: #94a3b8;
  transition:
    opacity 0.2s,
    color 0.2s,
    transform 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.fav-bookmark:hover {
  opacity: 0.8;
}
.fav-bookmark.favorited {
  opacity: 1;
  color: #b36b5e;
}

.subtitle {
  font-size: 15px;
  color: #555;
  line-height: 1.5;
  margin: 0;
  font-style: italic;
  overflow: hidden;
  max-width: 100%;
}

@media (max-width: 600px) {
  .card {
    padding: 20px;
  }
  .title {
    font-size: 18px;
  }
  .subtitle {
    font-size: 14px;
  }
  .icons {
    font-size: 18px;
  }
}
</style>
