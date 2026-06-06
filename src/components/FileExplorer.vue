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
  router.push({ name: 'article', params: { id: articleId } })
}

// ===== 生命周期 =====
onMounted(async () => {
  await store.initDB()
  await store.loadFolders()
  store.restoreFolder()
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
    </div>

    <div class="explorer-body">
      <FolderTree @contextmenu="onFolderTreeContextMenu" />
      <ContentArea
        @contextmenu-folder="onContentAreaContextMenu"
        @contextmenu-main="onContentAreaMainContextMenu"
        @view-article="onViewArticle"
      />
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
      @delete="(id) => {
        const folder = store.folders[id]
        if (!folder) return
        if (confirm(`确定要删除文件夹「${folder.name}」吗？\n其下所有子文件夹也将一并删除。`)) {
          store.deleteFolder(id).catch((err) => alert('删除失败: ' + (err.message || '请检查后端服务是否已启动')))
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
  background: #fff;
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
