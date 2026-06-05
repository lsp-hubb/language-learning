<script setup>
import { ref, computed } from 'vue'
import { useFileExplorerStore } from '@/stores/fileExplorer'

const emit = defineEmits(['contextmenu'])
const store = useFileExplorerStore()

const expandedFolders = ref(new Set(['root']))

function toggleExpand(id) {
  if (expandedFolders.value.has(id)) {
    expandedFolders.value.delete(id)
  } else {
    expandedFolders.value.add(id)
  }
}

function renderTree(parentId = 'root', level = 0) {
  const children = store.getChildren(parentId)
  if (!children.length) return []

  const items = []
  for (const child of children) {
    const hasChildren = child.children.length > 0
    const isExpanded = expandedFolders.value.has(child.id)
    items.push({ ...child, level, hasChildren, isExpanded })
    if (isExpanded && hasChildren) {
      items.push(...renderTree(child.id, level + 1))
    }
  }
  return items
}

const treeItems = computed(() => renderTree())
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-title">文件夹</div>
    <div class="tree">
      <div
        v-for="item in treeItems"
        :key="item.id"
        class="tree-node"
        :class="{
          selected: item.id === store.currentFolderId,
          'no-children': !item.hasChildren,
        }"
        :style="{ paddingLeft: 12 + item.level * 18 + 'px' }"
        @click="store.navigateTo(item.id)"
        @contextmenu.prevent.stop="emit('contextmenu', $event, item.id)"
      >
        <span
          v-if="item.hasChildren"
          class="arrow"
          :class="{ expanded: item.isExpanded }"
          @click.stop="toggleExpand(item.id)"
        >▶</span>
        <span v-else class="arrow-placeholder"></span>
        <span class="icon">📁</span>
        <span class="name">{{ item.name }}</span>
      </div>
      <div v-if="treeItems.length === 0" class="tree-empty">空目录</div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 240px;
  background: #fafafa;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}
.sidebar-title {
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: #888;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}
.tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  cursor: pointer;
  border-radius: 0;
  transition: background 0.1s;
  font-size: 13px;
}
.tree-node:hover {
  background: #e8f0fe;
}
.tree-node.selected {
  background: #d4e4f7;
  font-weight: 500;
}
.tree-node.no-children {
  cursor: default;
}
.arrow {
  font-size: 10px;
  color: #888;
  width: 14px;
  flex-shrink: 0;
  transition: transform 0.15s;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.arrow.expanded {
  transform: rotate(90deg);
}
.arrow-placeholder {
  width: 14px;
  flex-shrink: 0;
  display: inline-block;
}
.icon {
  font-size: 16px;
  flex-shrink: 0;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-empty {
  padding: 20px 16px;
  color: #aaa;
  font-size: 13px;
  text-align: center;
}
</style>
