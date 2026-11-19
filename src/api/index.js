// 可配置 API 前缀：默认同源 '/api'；生产环境可用 VITE_API_BASE_URL 指向独立后端
const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || '/api'

async function request(path, options = {}, timeoutMs = 10000) {
  const url = `${BASE_URL}${path}`
  // 默认 10 秒超时（不与调用方传入的 signal 冲突）；大文件夹导入/预检可放宽
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const mergedSignal = options.signal
    ? anySignal([options.signal, ctrl.signal])
    : ctrl.signal
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      signal: mergedSignal,
    })
    // 优先用 text() 以便对非 JSON 响应给出可辨认提示；mock / 老环境无 text() 时回退 json()
    let data
    if (typeof res.text === 'function') {
      const text = await res.text()
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(`接口 ${path} 返回了非 JSON 内容（HTTP ${res.status}），通常是后端未重启或路由不存在，请重启后端后重试`)
      }
    } else {
      data = await res.json()
    }
    // 兼容后端三种错误体：{message} / {error} / HTTP 200 + error（由调用方处理）
    if (!res.ok) throw new Error(data.message || data.error || '请求失败')
    return data
  } finally {
    clearTimeout(timer)
  }
}

function anySignal(signals) {
  const ctrl = new AbortController()
  for (const s of signals) {
    if (s.aborted) { ctrl.abort(s.reason); return ctrl.signal }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true })
  }
  return ctrl.signal
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

// ===== 文件夹数据包导入（导出走 src/utils/folderBundle.js 的 blob 下载）=====
// 大包上传可能超过默认 10 秒，这里放宽到 2 分钟。
export function validateFolderBundle(payload) {
  return request(
    '/folders/import/validate',
    { method: 'POST', body: JSON.stringify(payload) },
    120000
  )
}

export function importFolder(payload) {
  return request(
    '/folders/import',
    { method: 'POST', body: JSON.stringify(payload) },
    120000
  )
}

// 音频边车独立导入（文本已先导入、音频后补的可选步骤）
export function importAudioSidecar(audioSidecar) {
  return request(
    '/tts/import-sidecar',
    { method: 'POST', body: JSON.stringify({ audioSidecar }) },
    120000
  )
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

export function fetchSuggestions(keyword, signal) {
  return request(`/suggest?q=${encodeURIComponent(keyword)}`, signal ? { signal } : {})
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

/**
 * 页面隐藏/关闭兜底：把尚未确认落库的最新快照发出去。
 * 笔迹现在每笔即时入库，正常路径不会用到它；仅覆盖「请求在途时刷新/关闭」。
 * sendBeacon 在页面卸载后仍由浏览器保证投递；失败时回退 fetch keepalive。
 */
export function sendCanvasStrokesBeacon(articleId, strokes) {
  if (!articleId || articleId === 'default') return false
  const url = `${BASE_URL}/canvas-strokes/${encodeURIComponent(articleId)}`
  const body = JSON.stringify({ strokes })
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(url, blob)) return true
    }
  } catch {}
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
    return true
  } catch {
    return false
  }
}

// 朗读音频准备情况（只读，不触发合成）：texts 为当前文章各段送合成的文本
export function fetchReadTtsStatus(texts, signal) {
  return request('/tts/read/status', {
    method: 'POST',
    body: JSON.stringify({ texts }),
    signal,
  })
}
