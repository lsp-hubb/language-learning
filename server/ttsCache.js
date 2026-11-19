import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ===== 朗读 TTS 磁盘缓存的共享工具（key 规则 / 原子读写 / 音色常量）=====
// 被 server/index.js（合成 / 清理 / 状态查询）与 server/folderBundle.js（音频随包迁移）共用。
// 契约见 markdown/READ_ALOUD.md 与 markdown/FOLDER_IMPORT_EXPORT.md §13。

export const READ_TTS_VOICES = ['en-US-AndrewNeural', 'en-US-EmmaMultilingualNeural', 'en-GB-RyanNeural']
export const READ_TTS_RATE = '+0%'
export const READ_TTS_DISK = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tts-cache')
try { mkdirSync(READ_TTS_DISK, { recursive: true }) } catch (_) {}

// key 只依赖 text + voice + rate，与文章 / 文件夹 ID 无关。
export function readTtsKey(text, voice, rate = READ_TTS_RATE) {
  return crypto.createHash('sha256').update(`${text}\u0000${voice}\u0000${rate}`).digest('hex')
}

// 与前端 normalizeQuotes 一致：库里旧正文可能含弯引号，归一后才能算出与前端相同的 key。
export function normalizeTtsText(text) {
  return String(text == null ? '' : text)
    .replace(/[‘’]|&lsquo;|&rsquo;|&#8216;|&#8217;/g, "'")
    .replace(/[“”]|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
}

export function readTtsDiskFile(key) {
  try {
    const file = path.join(READ_TTS_DISK, `${key}.json`)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (_) {
    return null
  }
}

// 仅判断存在（状态查看 / 清单生成用，避免读取整段 base64 音频）
export function readTtsDiskHas(key) {
  try { return existsSync(path.join(READ_TTS_DISK, `${key}.json`)) } catch (_) { return false }
}

// 磁盘缓存文件字节数（清单统计用）
export function readTtsDiskSize(key) {
  try { return statSync(path.join(READ_TTS_DISK, `${key}.json`)).size } catch (_) { return 0 }
}

// 临时文件 + renameSync 原子替换，避免写到一半被读到半截 JSON。
// 返回是否成功，供导入时统计 audioFailed。
export function writeTtsDiskFile(key, payload) {
  try {
    const file = path.join(READ_TTS_DISK, `${key}.json`)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(payload), 'utf8')
    renameSync(tmp, file)
    return true
  } catch (err) {
    console.error('[tts] 写磁盘缓存失败:', err.message)
    return false
  }
}

// 删除单个磁盘缓存文件（导入边车校验失败时清理半写入用；返回是否删除成功）
export function deleteTtsDiskFile(key) {
  try {
    const file = path.join(READ_TTS_DISK, `${key}.json`)
    if (!existsSync(file)) return true
    unlinkSync(file)
    return true
  } catch (_) {
    return false
  }
}
