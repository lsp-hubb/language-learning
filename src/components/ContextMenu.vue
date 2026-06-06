<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  folderId: null,
})

const emit = defineEmits(['create-folder', 'create-article', 'rename', 'delete'])

function show(e, folderId) {
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, folderId }
}

function showMain(e) {
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, folderId: null }
}

function close() {
  contextMenu.value.visible = false
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
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <div class="menu-item" @click="emit('create-folder'); close()">
        <span class="menu-icon">📁</span> 新建文件夹
      </div>
      <div
        v-if="!contextMenu.folderId"
        class="menu-item"
        @click="emit('create-article'); close()"
      >
        <span class="menu-icon">📰</span> 新建外刊
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
}
</style>
