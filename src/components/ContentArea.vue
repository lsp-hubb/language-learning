<script setup>
import { useFileExplorerStore } from '@/stores/fileExplorer'
import ArticleCard from './ArticleCard.vue'

const emit = defineEmits(['contextmenu-folder', 'contextmenu-main', 'view-article'])
const store = useFileExplorerStore()
</script>

<template>
  <main class="content" @contextmenu.prevent="emit('contextmenu-main', $event)">
    <div class="content-header">
      <span class="content-title">{{ store.currentFolder?.name || '根目录' }}</span>
      <span class="content-count">{{ store.currentChildren.length + store.currentArticles.length }} 项</span>
    </div>

    <div v-if="store.currentChildren.length" class="folder-grid">
      <div
        v-for="item in store.currentChildren"
        :key="item.id"
        class="folder-card"
        @dblclick="store.navigateTo(item.id)"
        @contextmenu.prevent.stop="emit('contextmenu-folder', $event, item.id)"
      >
        <div class="folder-icon">📁</div>
        <div class="folder-name">{{ item.name }}</div>
      </div>
    </div>

    <div v-if="!store.currentChildren.length && !store.currentArticles.length" class="folder-grid">
      <div class="empty-hint">
        此文件夹为空<br />
        <span class="sub-hint">点击「＋ 新建文件夹」或「📰 新建外刊」创建内容</span>
      </div>
    </div>

    <div v-if="store.currentArticles.length" class="article-grid">
      <ArticleCard
        v-for="article in store.currentArticles"
        :key="article.id"
        :article="article"
        @view="emit('view-article', $event)"
      />
    </div>
  </main>
</template>

<style scoped>
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f8f5f0;
}
.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}
.content-title {
  font-size: 16px;
  font-weight: 600;
}
.content-count {
  font-size: 13px;
  color: #999;
}
.folder-grid {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 4px;
  padding: 12px;
  overflow-y: auto;
}
.folder-card {
  width: 110px;
  height: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
}
.folder-card:hover {
  background: #eef3fc;
}
.folder-icon {
  font-size: 40px;
  line-height: 1;
}
.folder-name {
  font-size: 12px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  max-width: 100%;
  word-break: break-all;
  padding: 0 4px;
}
.empty-hint {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #bbb;
  font-size: 14px;
  padding: 60px 20px;
  text-align: center;
  line-height: 1.8;
}
.sub-hint {
  font-size: 12px;
  color: #ccc;
}
.article-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 0 12px 12px;
  overflow-y: auto;
  min-height: 0;
}
</style>
