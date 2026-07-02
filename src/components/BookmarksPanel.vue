<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  articles: { type: Array, default: () => [] },
  currentArticleId: { type: String, default: '' },
})

const emit = defineEmits(['close', 'select'])

function onSelect(id) {
  emit('select', id)
}
</script>

<template>
  <Teleport to="body">
    <div class="bookmarks-overlay" :class="{ visible }" @click.self="emit('close')">
      <div class="bookmarks-panel">
        <div class="bookmarks-header">
          <span>书签 ({{ articles.length }})</span>
          <button class="bookmarks-close" @click="emit('close')">✕</button>
        </div>
        <div class="bookmarks-body">
          <div
            v-for="art in articles"
            :key="art.id"
            class="bookmark-item"
            :class="{ active: art.id === currentArticleId }"
            @click="onSelect(art.id)"
          >
            <span class="bookmark-title">{{ art.title }}</span>
          </div>
          <div v-if="!articles.length" class="bookmarks-empty">暂无其他文章</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bookmarks-overlay {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 8000;
  pointer-events: none;
}
.bookmarks-overlay.visible {
  pointer-events: auto;
}
.bookmarks-panel {
  position: absolute;
  left: -320px;
  top: 0;
  width: 300px;
  height: 100vh;
  background: #fff;
  border-right: 1px solid #e8e0d4;
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  transition: left 0.35s ease;
  z-index: 8001;
}
.bookmarks-overlay.visible .bookmarks-panel {
  left: 0;
}
.bookmarks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  font-size: 15px;
  font-weight: 600;
  color: #1a1a2e;
  border-bottom: 1px solid #eee;
}
.bookmarks-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: #f0f0f0;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.bookmarks-close:hover {
  background: #e0e0e0;
}
.bookmarks-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.bookmark-item {
  padding: 10px 20px;
  cursor: pointer;
  transition: background 0.15s;
  border-left: 3px solid transparent;
  display: flex;
  align-items: center;
}
.bookmark-item:hover {
  background: #f5f0e8;
}
.bookmark-item.active {
  background: #f0e8d8;
  border-left-color: #8b3a2a;
}
.bookmark-item.active .bookmark-title {
  color: #8b3a2a;
  font-weight: 600;
}
.bookmark-title {
  font-size: 14px;
  color: #333;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bookmarks-empty {
  padding: 40px 20px;
  text-align: center;
  color: #bbb;
  font-size: 14px;
}
@media (min-width: 1600px) {
  .bookmarks-panel {
    left: -340px;
    width: 320px;
  }
}
</style>
