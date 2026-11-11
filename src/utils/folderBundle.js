// 文件夹数据包（.llfolder.json）：前端下载与快速预检
// 契约见 markdown/FOLDER_IMPORT_EXPORT.md，后端为准的校验在 server/folderBundle.js

export const BUNDLE_FORMAT = 'language-learning/folder-bundle'
export const BUNDLE_VERSION = 1
export const MAX_BUNDLE_BYTES = 100 * 1024 * 1024

export function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function safeFileName(name) {
  return String(name || '文件夹')
    .replace(/[\\/:*?"<>|\r\n]/g, '_')
    .slice(0, 60)
}

function dateTag() {
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

// 前端快速预检（不替代后端 validate）：避免把明显不合法的文件发到服务端
export async function readBundleFile(file) {
  if (!file) throw new Error('请先选择 .llfolder.json 文件')
  if (file.size > MAX_BUNDLE_BYTES) {
    const limitMB = MAX_BUNDLE_BYTES / 1024 / 1024
    throw new Error(`文件 ${formatBytes(file.size)} 超过 ${limitMB} MB 上限，请按子文件夹分批导出`)
  }
  const text = await file.text()
  let bundle
  try {
    bundle = JSON.parse(text)
  } catch (_) {
    throw new Error('文件不是有效 JSON')
  }
  if (bundle?.format !== BUNDLE_FORMAT) throw new Error('不是有效的文件夹数据包（format 不匹配）')
  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(`不支持的数据包版本：${bundle.version}（当前支持 v${BUNDLE_VERSION}）`)
  }
  if (!Array.isArray(bundle.folders) || !Array.isArray(bundle.articles)) {
    throw new Error('数据包缺少 folders / articles 数组')
  }
  return { bundle, bytes: file.size }
}

// 导出：后端返回纯 JSON，这里直接以文本下载（保证文件可被文本编辑器打开）
export async function exportFolderBundle(folderId, fallbackName = '') {
  const res = await fetch(`/api/folders/${encodeURIComponent(folderId)}/export`)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.message) msg += `：${data.message}`
    } catch (_) {
      /* 非 JSON 错误页忽略 */
    }
    throw new Error(msg)
  }
  const text = await res.text()
  let bundle
  try {
    bundle = JSON.parse(text)
  } catch (_) {
    throw new Error('导出内容不是有效 JSON')
  }
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const fileName = `${safeFileName(bundle.source?.folderName || fallbackName)}-${dateTag()}.llfolder.json`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { bundle, bytes: blob.size, fileName }
}
