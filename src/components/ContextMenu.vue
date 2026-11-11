<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
// 与文章卡片的右键菜单共用「活跃菜单」标记，保证两者不会同时出现。
// 注意：activeMenu / setActiveMenu 由 useArticleContextMenu() 返回，
// 不是模块的具名导出，必须调用函数获取（否则构建会报 MISSING_EXPORT 而白屏）。
import { useArticleContextMenu } from '@/composables/useArticleContextMenu'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import exportIcon from './icons/导出.svg'
import importIcon from './icons/导入.svg'
import rootIcon from './icons/根目录.svg'

// 三个图标统一以 mask 渲染成同一种蓝色：导出 / 导入自带 #1890FF，
// 根目录.svg 未写 fill（默认纯黑），用 mask 染色后视觉才一致。
function iconStyle(url) {
  return { '--menu-icon': `url("${url}")` }
}

const { activeMenu, setActiveMenu } = useArticleContextMenu()
const store = useFileExplorerStore()

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  folderId: null,
})

const emit = defineEmits([
  'create-folder',
  'create-article',
  'rename',
  'delete',
  'export-folder',
  'export-root',
  'import-folder',
])

function show(e, folderId) {
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, folderId }
  // 登记为当前活跃菜单 → 文章卡片菜单会被自动挤掉
  setActiveMenu('context')
}

function showMain(e) {
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, folderId: null }
  setActiveMenu('context')
}

function close() {
  contextMenu.value.visible = false
  if (activeMenu.value === 'context') setActiveMenu('')
}

function handleGlobalClick() {
  close()
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
})
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
})

defineExpose({ show, showMain, close })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="contextMenu.visible && activeMenu === 'context'"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <div class="menu-item" @click="emit('create-folder'); close()">
        <span class="menu-icon">📁</span> 新建文件夹
      </div>
      <div
        v-if="!contextMenu.folderId"
        class="menu-item"
        @click="emit('create-article'); close()"
      >
        <span class="menu-icon">📰</span>
        新建外刊
      </div>
      <div
        v-if="contextMenu.folderId && contextMenu.folderId !== 'root'"
        class="menu-item"
        @click="emit('rename', contextMenu.folderId); close()"
      >
        <span class="menu-icon">✏️</span> 重命名
      </div>
      <div
        v-if="contextMenu.folderId && contextMenu.folderId !== 'root'"
        class="menu-item danger"
        @click="emit('delete', contextMenu.folderId); close()"
      >
        <span class="menu-icon">🗑️</span> 删除
      </div>
      <div
        v-if="contextMenu.folderId && contextMenu.folderId !== 'root'"
        class="menu-item"
        @click="emit('export-folder', contextMenu.folderId); close()"
      >
        <span class="menu-icon"><span class="icon-img" aria-hidden="true" :style="iconStyle(exportIcon)"></span></span>
        导出文件夹…
      </div>
      <div class="menu-item" @click="emit('export-root'); close()">
        <span class="menu-icon"><span class="icon-img" aria-hidden="true" :style="iconStyle(rootIcon)"></span></span>
        导出全部文件夹…
      </div>
      <div class="menu-item" @click="emit('import-folder'); close()">
        <span class="menu-icon"><span class="icon-img" aria-hidden="true" :style="iconStyle(importIcon)"></span></span>
        导入文件夹…
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 2000;
  min-width: 180px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  overflow: hidden;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s;
}
.menu-item:hover {
  background: #e8f0fe;
}
.menu-item.danger:hover {
  background: #ffe8e8;
  color: #d32f2f;
}
.menu-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}
.menu-icon .icon-img {
  display: block;
  width: 16px;
  height: 16px;
  margin: 0 auto;
  background-color: #1890ff;
  -webkit-mask-image: var(--menu-icon);
  mask-image: var(--menu-icon);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
</style>
