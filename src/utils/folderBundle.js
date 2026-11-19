// 文件夹数据包（.llfolder.json）：前端下载与快速预检
// 契约见 markdown/FOLDER_IMPORT_EXPORT.md，后端为准的校验在 server/folderBundle.js

export const BUNDLE_FORMAT = 'language-learning/folder-bundle'
export const BUNDLE_VERSION = 2
export const SUPPORTED_BUNDLE_VERSIONS = [1, 2]
export const AUDIO_SIDECAR_FORMAT = 'language-learning/tts-audio-bundle'
export const AUDIO_SIDECAR_VERSION = 1
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
  if (!SUPPORTED_BUNDLE_VERSIONS.includes(bundle.version)) {
    throw new Error(`不支持的数据包版本：${bundle.version}（当前支持 v${SUPPORTED_BUNDLE_VERSIONS.join('/')}）`)
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

function downloadJson(text, fileName) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return blob.size
}

// 音频边车导出（P3）：用刚下载主包的字段回传，保证与主包严格对齐。
// 超限（413）直接抛后端提示「请按子文件夹分别导出」，不做自动分片。
export async function exportAudioSidecar(bundle) {
  if (!bundle?.audioManifest?.files?.length) return null
  const res = await fetch('/api/folders/export-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      exportedAt: bundle.exportedAt,
      source: bundle.source,
      audioManifest: bundle.audioManifest,
    }),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.message) msg = data.message
    } catch (_) { /* 非 JSON 错误页忽略 */ }
    throw new Error(msg)
  }
  const text = await res.text()
  let sidecar
  try {
    sidecar = JSON.parse(text)
  } catch (_) {
    throw new Error('音频边车内容不是有效 JSON')
  }
  const stem = `${safeFileName(bundle.source?.folderName || '文件夹')}-${dateTag()}`
  const fileName = `${stem}.llaudio.json`
  const bytes = downloadJson(text, fileName)
  return { sidecar, bytes, fileName }
}

// 前端快速预检边车：格式 / 版本 / 上限 / 与主包导出时间一致（完整校验在后端导入时做）
export async function readAudioSidecarFile(file, bundle) {
  if (!file) return null
  if (file.size > MAX_BUNDLE_BYTES) {
    throw new Error(`音频边车 ${formatBytes(file.size)} 超过 100 MB 上限，请按子文件夹分别导出`)
  }
  const text = await file.text()
  let sidecar
  try {
    sidecar = JSON.parse(text)
  } catch (_) {
    throw new Error('音频边车不是有效 JSON')
  }
  if (sidecar?.format !== AUDIO_SIDECAR_FORMAT) throw new Error('不是有效的音频边车文件（format 不匹配）')
  if (sidecar.version !== AUDIO_SIDECAR_VERSION) {
    throw new Error(`不支持的音频边车版本：${sidecar.version}（当前支持 v${AUDIO_SIDECAR_VERSION}）`)
  }
  if (!Array.isArray(sidecar.audio)) throw new Error('音频边车缺少 audio 数组')
  if (bundle && sidecar.source?.bundleExportedAt !== bundle.exportedAt) {
    throw new Error('音频边车与主包不匹配（导出时间不一致），请确认二者来自同一次导出')
  }
  return { sidecar, bytes: file.size, fileName: file.name }
}
