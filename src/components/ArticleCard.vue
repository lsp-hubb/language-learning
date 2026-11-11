<script setup>
import { ref, computed, onUnmounted, nextTick } from 'vue'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import { useArticleContextMenu } from '@/composables/useArticleContextMenu'
import { notifyError } from '@/utils/feedback'

const props = defineProps({
  article: { type: Object, required: true },
})
const emit = defineEmits(['view'])
const store = useFileExplorerStore()

// 右键菜单与顶部通知都用「跨卡片共享」的状态：
// 右键其它卡片、或发起新的删除确认时，上一次的弹层自动消失，不会叠加
const { menu, openMenu, closeMenu, notice, openNotice, closeNotice, activeMenu } = useArticleContextMenu()
const deleting = ref(false)

// ===== 就地重命名（仅改 title，不触碰 sections/type）=====
const renaming = ref(false)
const renameValue = ref('')
const renameInput = ref(null)

function onRenameClick() {
  closeMenu()
  renaming.value = true
  renameValue.value = props.article.title || ''
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

async function confirmRename() {
  if (!renaming.value) return
  const val = renameValue.value.trim()
  renaming.value = false
  if (!val || val === props.article.title) return
  try {
    await store.updateArticle(props.article.id, { title: val })
  } catch (err) {
    notifyError('重命名失败: ' + (err.message || '请检查后端服务是否已启动'))
  }
}

function cancelRename() {
  renaming.value = false
}

// ===== 移动到文件夹 =====
const moveOpen = ref(false)

// 列出可移动的目标文件夹（排除根目录与当前所在文件夹）
const moveTargets = computed(() => {
  const list = []
  for (const f of Object.values(store.folders)) {
    if (f.id === 'root') continue
    if (f.id === props.article.folderId) continue
    list.push(f)
  }
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name)))
})

function openMove() {
  moveOpen.value = true
}

function backToMain() {
  moveOpen.value = false
}

async function moveArticle(targetId) {
  moveOpen.value = false
  closeMenu()
  if (targetId === props.article.folderId) return
  try {
    await store.updateArticle(props.article.id, { folderId: targetId })
  } catch (err) {
    notifyError('移动失败: ' + (err.message || '请检查后端服务是否已启动'))
  }
}

function onContextMenu(e) {
  openMenu(e, props.article.id)
  moveOpen.value = false
  // 点击页面任意处关闭菜单（一次性监听）
  document.addEventListener('click', closeMenuOnce)
}

function closeMenuOnce() {
  closeMenu()
  document.removeEventListener('click', closeMenuOnce)
}

function onDeleteClick() {
  closeMenu()
  openNotice(props.article.id, props.article.title)
}

function cancelDelete() {
  closeNotice()
}

async function confirmDelete() {
  if (deleting.value) return
  deleting.value = true
  try {
    await store.deleteArticle(props.article.id)
    closeNotice()
  } catch (err) {
    notifyError('删除失败: ' + (err.message || '请检查后端服务是否已启动'))
  } finally {
    deleting.value = false
  }
}

onUnmounted(() => {
  document.removeEventListener('click', closeMenuOnce)
})

const preview = computed(() => {
  if (!props.article.content) return ''
  const text = props.article.content.replace(/\r/g, '').split('\n').filter(Boolean)[0] || ''
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
  <!-- .prevent 阻止浏览器默认菜单；.stop 阻止冒泡到 ContentArea，
       避免同时弹出通用的 ContextMenu（新建文件夹/新建外刊那一套） -->
  <div class="card" @click="emit('view', article.id)" @contextmenu.prevent.stop="onContextMenu">
    <div class="card-header">
      <input
        v-if="renaming"
        ref="renameInput"
        v-model="renameValue"
        class="title-edit"
        @keyup.enter="confirmRename"
        @keyup.esc="cancelRename"
        @blur="confirmRename"
        @click.stop
      />
      <h1 v-else class="title">{{ article.title }}</h1>
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

  <!-- 右键菜单 + 顶部通知确认（Teleport 到 body，避免被卡片容器裁剪） -->
  <Teleport to="body">
    <div
      v-if="menu.visible && menu.articleId === article.id && activeMenu === 'card'"
      class="ctx-menu ctx-menu-wide"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
    >
      <template v-if="!moveOpen">
        <div class="ctx-item" @click="onRenameClick">✏ 重命名</div>
        <div class="ctx-item" @click="openMove">📁 移动到…</div>
        <div class="ctx-item ctx-danger" @click="onDeleteClick">🗑 删除</div>
      </template>
      <template v-else>
        <div class="ctx-item ctx-back" @click="backToMain">← 返回</div>
        <div class="ctx-hint">仅可移入其它文件夹</div>
        <div class="ctx-folder-list">
          <div v-if="!moveTargets.length" class="ctx-empty">无可移动的目标文件夹</div>
          <div
            v-for="f in moveTargets"
            :key="f.id"
            class="ctx-item ctx-folder"
            :title="f.name"
            @click="moveArticle(f.id)"
          >{{ f.name }}</div>
        </div>
      </template>
    </div>

    <div v-if="notice.visible && notice.articleId === article.id" class="top-notice">
      <span class="notice-icon">🗑️</span>
      <div class="notice-body">
        <div class="notice-title">删除文章</div>
        <div class="notice-text" :title="notice.title">确定删除《{{ notice.title }}》？删除后可在回收站恢复。</div>
      </div>
      <button class="notice-btn danger" :disabled="deleting" @click="confirmDelete">
        {{ deleting ? '删除中…' : '确认删除' }}
      </button>
      <button class="notice-btn" @click="cancelDelete">取消</button>
    </div>
  </Teleport>
</template>

<style scoped>
.card {
  width: 100%;
  min-width: 0;
  background: #fffaf0;
  border: 2px solid #d4c4a8;
  border-radius: 12px;
  padding: 16px 30px 30px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
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

/* 就地重命名的输入框：复用标题排版观感 */
.title-edit {
  flex: 1;
  min-width: 0;
  font-size: 20px;
  font-weight: bold;
  color: #2c2c2c;
  line-height: 1.35;
  font-family: inherit;
  padding: 0 4px;
  margin: 0;
  border: 1px solid #b36b5e;
  border-radius: 6px;
  background: #fffdf8;
  outline: none;
  box-sizing: border-box;
}
.title-edit:focus {
  box-shadow: 0 0 0 2px rgba(179, 107, 94, 0.18);
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

/* ===== 右键菜单 ===== */
.ctx-menu {
  position: fixed;
  z-index: 4000;
  min-width: 120px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
  padding: 4px;
}
.ctx-item {
  padding: 7px 12px;
  font-size: 13px;
  color: #475569;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.ctx-item:hover {
  background: #f5f7fa;
}
.ctx-danger {
  color: #c45656;
}
.ctx-danger:hover {
  background: #fef0f0;
}

/* ===== 移动到：二级目录列表 ===== */
.ctx-menu-wide {
  min-width: 210px;
  max-width: 280px;
}
.ctx-back {
  color: #5b6b7e;
  border-bottom: 1px solid #eef0f3;
  margin-bottom: 2px;
}
.ctx-hint {
  font-size: 11px;
  color: #9aa4b2;
  padding: 2px 12px 6px;
  user-select: none;
}
.ctx-folder-list {
  max-height: 240px;
  overflow-y: auto;
  margin: 0 -4px;
}
.ctx-folder {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ctx-empty {
  font-size: 12px;
  color: #a8adb5;
  padding: 6px 12px;
  user-select: none;
}

/* ===== 顶部通知（确认删除）===== */
.top-notice {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5000;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, 92vw);
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #f3d9d9;
  border-left: 4px solid #e74c3c;
  border-radius: 12px;
  box-shadow: 0 14px 36px rgba(30, 45, 70, 0.2);
  font-size: 13px;
  color: #475569;
  animation: notice-in 0.18s ease-out;
}
@keyframes notice-in {
  from { opacity: 0; transform: translate(-50%, -10px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
.notice-icon {
  flex-shrink: 0;
  font-size: 20px;
  line-height: 1;
}
.notice-body {
  flex: 1;
  min-width: 0;
}
.notice-title {
  font-size: 13px;
  font-weight: 600;
  color: #2c3e50;
  line-height: 1.4;
}
.notice-text {
  margin-top: 2px;
  font-size: 12px;
  color: #7f8c8d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notice-btn {
  flex-shrink: 0;
  border: 1px solid #dcdfe6;
  background: #f8fafc;
  color: #475569;
  border-radius: 7px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.notice-btn:hover {
  background: #eef2f7;
}
.notice-btn.danger {
  background: #e74c3c;
  border-color: #e74c3c;
  color: #fff;
}
.notice-btn.danger:hover {
  background: #c0392b;
}
.notice-btn:disabled {
  opacity: 0.6;
  cursor: default;
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
