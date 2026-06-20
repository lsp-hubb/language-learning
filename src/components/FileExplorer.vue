<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import FolderTree from './FolderTree.vue'
import ContentArea from './ContentArea.vue'
import FolderDialog from './FolderDialog.vue'
import ArticleDialog from './ArticleDialog.vue'
import ContextMenu from './ContextMenu.vue'

const router = useRouter()
const store = useFileExplorerStore()

const confirm = (msg) => window.confirm(msg)

const folderDialog = ref(null)
const articleDialog = ref(null)
const contextMenu = ref(null)

// ===== 事件处理 =====
function onFolderTreeContextMenu(e, folderId) {
  contextMenu.value?.show(e, folderId)
}

function onContentAreaContextMenu(e, folderId) {
  contextMenu.value?.show(e, folderId)
}

function onContentAreaMainContextMenu(e) {
  contextMenu.value?.showMain(e)
}

function onViewArticle(articleId) {
  const url = router.resolve({ name: 'article', params: { id: articleId } }).href
  const fullUrl = window.location.origin + url
  const win = window.open(fullUrl, `article-${articleId}`, 'noopener,noreferrer')
  if (!win) {
    const a = document.createElement('a')
    a.href = fullUrl
    a.target = '_blank'
    a.click()
  }
}

// ===== 生命周期 =====
onMounted(async () => {
  if (!store.initialized) {
    await store.initDB()
    await store.loadFolders()
  }
  await store.restoreFolder()
  store.loadFavorites()
})

onUnmounted(() => {
  // ContextMenu 自己管理 click listener
})
</script>

<template>
  <div class="explorer">
    <!-- ===== 加载状态 ===== -->
    <div v-if="store.loading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <div class="loading-text">加载中...</div>
    </div>

    <!-- ===== 顶部工具栏 ===== -->
    <div class="toolbar">
      <button class="btn btn-primary" @click="folderDialog?.open('create')">
        ＋ 新建文件夹
      </button>
      <button
        v-if="store.currentFolderId !== 'root'"
        class="btn btn-accent"
        @click="articleDialog?.open()"
      >📰 新建外刊</button>
      <div class="breadcrumb">
        <span
          v-for="(item, idx) in store.breadcrumb"
          :key="item.id"
          class="crumb"
          :class="{ active: idx === store.breadcrumb.length - 1 }"
          @click="store.navigateTo(item.id)"
        >
          {{ item.name }}
          <span v-if="idx < store.breadcrumb.length - 1" class="sep">›</span>
        </span>
      </div>
      <button
        class="btn btn-trash"
        :class="{ active: store.showTrash }"
        @click="store.showTrash ? (store.showTrash = false) : (store.showTrash = true, store.loadTrash())"
      >🗑️ 回收站</button>
    </div>

    <div class="explorer-body">
      <FolderTree @contextmenu="onFolderTreeContextMenu" @trash-click="store.showTrash = true; store.loadTrash()" />
      <ContentArea
        v-if="!store.showTrash"
        @contextmenu-folder="onContentAreaContextMenu"
        @contextmenu-main="onContentAreaMainContextMenu"
        @view-article="onViewArticle"
      />
      <div v-else class="trash-view">
        <div class="trash-header">🗑️ 回收站</div>
        <div class="trash-section" v-if="store.trashedFolders.length">
          <div class="trash-section-title">文件夹</div>
          <div v-for="f in store.trashedFolders" :key="f.id" class="trash-item">
            <span class="trash-name">📁 {{ f.name }}</span>
            <span class="trash-time">{{ new Date(f.deletedAt).toLocaleString() }}</span>
            <span class="trash-actions">
              <button class="trash-btn restore" @click="store.restoreFromTrash(f.id)">♻️ 恢复</button>
              <button class="trash-btn delete" @click="confirm(`永久删除文件夹[${f.name}]？\n其下文章也将被永久删除！`) && store.permanentDelete(f.id)">🗑️ 永久删除</button>
            </span>
          </div>
        </div>
        <div class="trash-section" v-if="store.trashedArticles.length">
          <div class="trash-section-title">文章</div>
          <div v-for="a in store.trashedArticles" :key="a.id" class="trash-item">
            <span class="trash-name">📄 {{ a.title }}</span>
            <span class="trash-time">{{ new Date(a.deletedAt).toLocaleString() }}</span>
            <span class="trash-actions">
              <span class="trash-hint">恢复文件夹即可恢复文章</span>
            </span>
          </div>
        </div>
        <div v-if="!store.trashedFolders.length && !store.trashedArticles.length" class="trash-empty">回收站为空</div>
      </div>
    </div>

    <!-- ===== 弹层组件 ===== -->
    <ContextMenu
      ref="contextMenu"
      @create-folder="folderDialog?.open('create')"
      @create-article="articleDialog?.open()"
      @rename="(id) => {
        const folder = store.folders[id]
        if (folder) folderDialog?.open('rename', id, folder.name)
      }"
      @delete="async (id) => {
        const folder = store.folders[id]
        if (!folder) { console.error('文件夹未找到:', id); return }
        if (!confirm(`确定要删除文件夹[${folder.name}]吗？\n其下所有子文件夹也将一并删除。`)) return
        try {
          await store.deleteFolder(id)
        } catch (err) {
          alert('删除失败: ' + (err.message || '请检查后端服务是否已启动'))
        }
      }"
    />
    <FolderDialog ref="folderDialog" />
    <ArticleDialog ref="articleDialog" />
  </div>
</template>

<style scoped>
/* ===== 全局布局 ===== */
.explorer {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8f5f0;
  color: #1a1a1a;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    sans-serif;
  user-select: none;
}

/* ===== 顶部工具栏 ===== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}
.btn {
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.btn-primary {
  background: #4a90d9;
  color: #fff;
}
.btn-primary:hover {
  background: #357abd;
}
.btn-accent {
  background: #2c5282;
  color: #fff;
}
.btn-accent:hover {
  background: #1a365d;
}

/* ===== 面包屑 ===== */
.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  font-size: 14px;
}
.crumb {
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  color: #555;
  transition: background 0.15s;
  display: flex;
  align-items: center;
}
.crumb:hover {
  background: #e0e0e0;
  color: #1a1a1a;
}
.crumb.active {
  color: #1a1a1a;
  font-weight: 600;
  cursor: default;
}
.sep {
  margin-left: 6px;
  color: #aaa;
  font-size: 18px;
  line-height: 1;
}

/* ===== 主体区域 ===== */
.explorer-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ===== 回收站按钮 ===== */
.btn-trash {
  background: transparent;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  margin-left: auto;
  transition: all 0.15s;
  white-space: nowrap;
}
.btn-trash:hover {
  background: #f0f0f0;
  border-color: #b0b0b0;
}
.btn-trash.active {
  background: #fce4ec;
  border-color: #e74c3c;
  color: #c0392b;
}

/* ===== 回收站视图 ===== */
.trash-view {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.trash-header {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: #555;
}
.trash-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.trash-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #e8e0d4;
  border-radius: 8px;
  font-size: 13px;
}
.trash-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trash-time {
  color: #999;
  font-size: 12px;
  white-space: nowrap;
}
.trash-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.trash-btn {
  border: none;
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.trash-btn.restore {
  background: #e3f2fd;
  color: #1565c0;
}
.trash-btn.restore:hover {
  background: #bbdefb;
}
.trash-btn.delete {
  background: #fce4ec;
  color: #c62828;
}
.trash-btn.delete:hover {
  background: #f8bbd0;
}
.trash-section {
  margin-bottom: 16px;
}
.trash-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #888;
  margin-bottom: 8px;
  padding-left: 2px;
}
.trash-hint {
  font-size: 11px;
  color: #aaa;
  font-style: italic;
}
.trash-empty {
  color: #bbb;
  text-align: center;
  padding: 40px;
  font-size: 14px;
}

/* ===== 加载动画 ===== */
.loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(255, 255, 255, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: #4a90d9;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.loading-text {
  font-size: 14px;
  color: #888;
}
</style>
