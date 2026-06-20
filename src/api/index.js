const BASE_URL = '/api'

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || '请求失败')
  return data
}

export function fetchFolders() {
  return request('/folders')
}

export function createFolder(name, parentId) {
  return request('/folders', {
    method: 'POST',
    body: JSON.stringify({ name, parentId }),
  })
}

export function renameFolder(id, name) {
  return request(`/folders/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
}

export function deleteFolder(id) {
  return request(`/folders/${id}`, { method: 'DELETE' })
}

export function fetchTrash() {
  return request('/trash')
}

export function restoreFolder(id) {
  return request(`/folders/${id}/restore`, { method: 'POST' })
}

export function forceDeleteFolder(id) {
  return request(`/folders/${id}/force`, { method: 'DELETE' })
}

export function initDatabase() {
  return request('/init', { method: 'POST' })
}

// ===== 外刊文章 API =====

export function fetchArticles(folderId) {
  return request(`/articles/${folderId}`)
}

export function fetchArticle(id) {
  return request(`/article/${id}`)
}

export function createArticle(data) {
  return request('/articles', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function deleteArticle(id) {
  return request(`/articles/${id}`, { method: 'DELETE' })
}

export function updateArticle(id, data) {
  return request(`/articles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ===== 批注 =====

export function fetchAnnotations(articleId) {
  return request(`/annotations/${articleId}`)
}

export function createAnnotation(data) {
  return request('/annotations', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateAnnotation(id, note) {
  return request(`/annotations/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ note }),
  })
}

export function deleteAnnotation(id) {
  return request(`/annotations/${id}`, { method: 'DELETE' })
}

// ===== 单词查询 =====

export function lookupWord(word, signal) {
  return request(`/lookup?word=${encodeURIComponent(word)}`, signal ? { signal } : {})
}

export function fetchSuggestions(keyword) {
  return request(`/suggest?q=${encodeURIComponent(keyword)}`)
}

// ===== 收藏 =====

export function fetchFavorites() {
  return request('/favorites')
}

export function toggleFavorite(articleId) {
  return request(`/favorites/${articleId}`, { method: 'POST' })
}

// ===== 画布笔迹 =====

export function fetchCanvasStrokes(articleId) {
  return request(`/canvas-strokes/${articleId}`)
}

export function saveCanvasStrokes(articleId, strokes) {
  return request(`/canvas-strokes/${articleId}`, {
    method: 'POST',
    body: JSON.stringify({ strokes }),
  })
}
