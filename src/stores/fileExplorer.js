import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '@/api'

export const useFileExplorerStore = defineStore('fileExplorer', () => {
  const folders = ref({})        // id → folder object
  const articles = ref({})       // articleId → article object
  const currentFolderId = ref('root')
  const loading = ref(false)
  const initialized = ref(false)

  // ===== 从 API 加载数据 =====
  async function loadFolders() {
    loading.value = true
    try {
      const res = await api.fetchFolders()
      const map = {}
      // 虚拟根目录
      map.root = { id: 'root', name: '根目录', parentId: null, children: [], createdAt: '' }

      for (const item of res.data) {
        map[item.id] = {
          id: item.id,
          name: item.name,
          parentId: item.parentId || 'root',
          children: [],
          createdAt: item.createdAt,
        }
      }

      // 建立 children 链表
      for (const item of Object.values(map)) {
        if (item.parentId && map[item.parentId]) {
          map[item.parentId].children.push(item.id)
        }
      }

      folders.value = map
      initialized.value = true
    } catch (err) {
      console.error('加载文件夹失败:', err)
    } finally {
      loading.value = false
    }
  }

  // ===== 初始化数据库表 =====
  async function initDB() {
    try {
      await api.initDatabase()
    } catch (err) {
      console.error('数据库初始化失败:', err)
    }
  }

  // ===== 计算属性 =====
  const currentFolder = computed(() => folders.value[currentFolderId.value])
  const currentChildren = computed(() =>
    currentFolder.value ? currentFolder.value.children.map((id) => folders.value[id]).filter(Boolean) : []
  )

  const breadcrumb = computed(() => {
    const path = []
    let cur = folders.value[currentFolderId.value]
    while (cur) {
      path.unshift(cur)
      cur = cur.parentId ? folders.value[cur.parentId] : null
    }
    return path
  })

  function getChildren(parentId) {
    const parent = folders.value[parentId]
    if (!parent) return []
    return parent.children.map((id) => folders.value[id]).filter(Boolean)
  }

  // ===== 创建文件夹 =====
  async function createFolder(name) {
    try {
      const res = await api.createFolder(name, currentFolderId.value)
      const newFolder = {
        id: res.data.id,
        name: res.data.name,
        parentId: res.data.parentId || 'root',
        children: [],
        createdAt: res.data.createdAt,
      }
      folders.value[newFolder.id] = newFolder
      const parent = folders.value[newFolder.parentId]
      if (parent) parent.children.push(newFolder.id)
      return true
    } catch (err) {
      console.error('创建文件夹失败:', err)
      return false
    }
  }

  // ===== 重命名文件夹 =====
  async function renameFolder(folderId, newName) {
    try {
      await api.renameFolder(folderId, newName)
      if (folders.value[folderId]) {
        folders.value[folderId].name = newName
      }
    } catch (err) {
      console.error('重命名失败:', err)
    }
  }

  // ===== 删除文件夹 =====
  async function deleteFolder(folderId) {
    if (folderId === 'root') throw new Error('根目录不可删除')
    await api.deleteFolder(folderId)
    const folder = folders.value[folderId]
    if (!folder) throw new Error('文件夹不存在')

    // 从父文件夹 children 中移除
    const parent = folders.value[folder.parentId]
    if (parent) {
      const idx = parent.children.indexOf(folderId)
      if (idx !== -1) parent.children.splice(idx, 1)
    }

    // 递归删除本地缓存
    const delRecursive = (id) => {
      const f = folders.value[id]
      if (!f) return
      ;[...f.children].forEach(delRecursive)
      delete folders.value[id]
    }
    delRecursive(folderId)

    if (currentFolderId.value === folderId) {
      currentFolderId.value = folder.parentId || 'root'
    }
  }

  // ===== 导航 =====
  function navigateTo(folderId) {
    if (folders.value[folderId]) {
      currentFolderId.value = folderId
      loadArticles(folderId)
    }
  }

  // ===== 外刊文章 =====
  const currentArticles = computed(() =>
    Object.values(articles.value).filter((a) => a.folderId === currentFolderId.value)
  )

  async function loadArticles(folderId) {
    try {
      const res = await api.fetchArticles(folderId)
      for (const item of res.data) {
        articles.value[item.id] = item
      }
    } catch (err) {
      console.error('加载文章失败:', err)
    }
  }

  async function createArticle(data) {
    try {
      const res = await api.createArticle(data)
      articles.value[res.data.id] = res.data
      return true
    } catch (err) {
      console.error('创建文章失败:', err)
      return false
    }
  }

  async function deleteArticle(articleId) {
    try {
      await api.deleteArticle(articleId)
      delete articles.value[articleId]
      return true
    } catch (err) {
      console.error('删除文章失败:', err)
      return false
    }
  }

  async function updateArticle(articleId, data) {
    try {
      await api.updateArticle(articleId, data)
      if (articles.value[articleId]) {
        if (data.title !== undefined) articles.value[articleId].title = data.title
        if (data.content !== undefined) articles.value[articleId].content = data.content
      }
      return true
    } catch (err) {
      console.error('更新文章失败:', err)
      return false
    }
  }

  return {
    folders,
    articles,
    currentFolderId,
    currentFolder,
    currentChildren,
    currentArticles,
    breadcrumb,
    loading,
    initialized,
    loadFolders,
    initDB,
    getChildren,
    createFolder,
    renameFolder,
    deleteFolder,
    navigateTo,
    loadArticles,
    createArticle,
    deleteArticle,
    updateArticle,
  }
})
