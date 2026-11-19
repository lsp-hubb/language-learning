import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pool from './db.js'
import {
  buildAudioSidecar,
  buildExport,
  createImportRouter,
  validateAudioSidecarForImport,
  writeAudioSidecar,
} from './folderBundle.js'
import {
  forceDeleteFolder,
  guardRoot,
  restoreFolder,
  softDeleteFolder,
  withTransaction,
} from './folderDelete.js'
import { parseYoudaoResult } from './youdaoParser.js'
import {
  normalizeTtsText,
  readTtsDiskFile,
  readTtsDiskHas,
  readTtsKey,
  READ_TTS_DISK,
  READ_TTS_RATE,
  READ_TTS_VOICES,
  writeTtsDiskFile,
} from './ttsCache.js'

const app = express()
const PORT = process.env.SERVER_PORT || 3000

app.use(cors())
// 文件夹数据包导入：自带 100MB 解析器，必须注册在全局 2mb 解析之前
app.use('/api/folders/import', createImportRouter(pool))

// 音频边车导出（P3）：body 含主包清单，可能 > 2 MB，故挂在全局 express.json(2mb) 之前。
// 回传主包的 exportedAt / source / audioManifest，后端只读磁盘打包，保证边车与主包严格一致。
const MAX_AUDIO_SIDECAR_BYTES = 100 * 1024 * 1024
const audioExportRouter = express.Router()
audioExportRouter.use(express.json({ limit: '100mb' }))
audioExportRouter.post('/', (req, res) => {
  try {
    const { exportedAt, source, audioManifest } = req.body || {}
    if (!exportedAt || typeof exportedAt !== 'string') {
      return res.status(400).json({ status: 'error', message: '缺少主包导出时间（exportedAt）' })
    }
    const sidecar = buildAudioSidecar(source, audioManifest, exportedAt)
    if (sidecar.bytes > MAX_AUDIO_SIDECAR_BYTES) {
      return res.status(413).json({
        status: 'error',
        message: `本文件夹音频约 ${(sidecar.bytes / 1024 / 1024).toFixed(1)} MB，超过单文件 100 MB 上限，请按子文件夹分别导出`,
      })
    }
    res.json(sidecar)
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message })
  }
})
app.use('/api/folders/export-audio', audioExportRouter)

// 音频边车独立导入（文本已先导入、音频后补的可选步骤）：body 仅含 audioSidecar，
// 可能 > 2 MB，挂在全局 express.json(2mb) 之前，自带 100mb。白名单用当前库 live keys，
// 不依赖主包对象——这样音频可以脱离主包单独导入，且仍防止任意 key 落盘。
const audioSidecarImportRouter = express.Router()
audioSidecarImportRouter.use(express.json({ limit: '100mb' }))
audioSidecarImportRouter.post('/', async (req, res) => {
  try {
    const { audioSidecar } = req.body || {}
    const rawBytes = audioSidecar && Array.isArray(audioSidecar.audio)
      ? audioSidecar.audio.reduce((s, a) => s + (typeof a?.audio === 'string' ? a.audio.length : 0), 0)
      : 0
    if (rawBytes > MAX_AUDIO_SIDECAR_BYTES) {
      return res.status(413).json({
        status: 'error',
        message: `音频边车约 ${(rawBytes / 1024 / 1024).toFixed(1)} MB，超过单文件 100 MB 上限，请按子文件夹分别导出`,
      })
    }
    const live = await collectLiveTtsKeys()
    const { audio } = validateAudioSidecarForImport(audioSidecar, live)
    const { written, failed } = writeAudioSidecar(audio)
    res.json({ status: 'ok', data: { written, failed, total: audio.length, liveKeys: live.size } })
  } catch (err) {
    res.status(err.status || 400).json({ status: 'error', message: err.message })
  }
})
app.use('/api/tts/import-sidecar', audioSidecarImportRouter)

// 笔记整篇可能较大：放宽请求体上限（默认 100kb 会先于数据库限制返回 413）
app.use(express.json({ limit: '2mb' }))

// 启动时自动迁移：确保 notes / marks 列存在，并把旧库的 notes 从 TEXT 升级为 MEDIUMTEXT
;(async () => {
  try { await pool.query('ALTER TABLE articles ADD COLUMN notes MEDIUMTEXT') } catch (_) {}
  try {
    const [rows] = await pool.query(
      'SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['articles', 'notes'],
    )
    if (rows[0] && rows[0].DATA_TYPE !== 'mediumtext') {
      await pool.query('ALTER TABLE articles MODIFY COLUMN notes MEDIUMTEXT COLLATE utf8mb4_unicode_ci NULL')
    }
  } catch (_) {}
  // marks：重点词汇标记状态（JSON 文本），键为 `noteIndex__词汇`，值为 true
  try { await pool.query('ALTER TABLE articles ADD COLUMN marks TEXT') } catch (_) {}
  // note_favorites：笔记卡片收藏（JSON 文本，存被收藏卡片内容的拷贝数组，每个元素为 {english, chinese, vocabItems}）
  try { await pool.query('ALTER TABLE articles ADD COLUMN note_favorites MEDIUMTEXT') } catch (_) {}
  // type：文章类型（预留字段，现仅普通文章，默认空串）
  try { await pool.query("ALTER TABLE articles ADD COLUMN type VARCHAR(32) DEFAULT ''") } catch (_) {}

  // content：题目原文正文（早期表可能缺失，补齐以保证兼容；新表建表已含，失败可忽略）
  try { await pool.query('ALTER TABLE articles ADD COLUMN content TEXT') } catch (_) {}
})()

// ===== 初始化数据库表 =====
app.post('/api/init', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS folders (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        parent_id VARCHAR(64) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id VARCHAR(64) PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        content TEXT,
        folder_id VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS annotations (
        id VARCHAR(64) PRIMARY KEY,
        article_id VARCHAR(64) NOT NULL,
        paragraph_index INT NOT NULL,
        start_offset INT NOT NULL,
        end_offset INT NOT NULL,
        text TEXT NOT NULL,
        type VARCHAR(20) NOT NULL,
        color VARCHAR(20) NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        article_id VARCHAR(64) PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS canvas_strokes (
        article_id VARCHAR(64) PRIMARY KEY,
        strokes_data JSON NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)
    // 回收站：添加 deleted_at 字段
    try { await pool.query('ALTER TABLE folders ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL') } catch (_) {}
    try { await pool.query('ALTER TABLE articles ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL') } catch (_) {}
    res.json({ status: 'ok', message: '数据库初始化成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 获取所有文件夹（不含回收站） =====
app.get('/api/folders', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, parent_id AS parentId, created_at AS createdAt FROM folders WHERE deleted_at IS NULL ORDER BY created_at ASC'
    )
    res.json({ status: 'ok', data: rows })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 导出文件夹数据包（:id 可为真实文件夹 ID 或 root）=====
// 直接返回纯 JSON bundle（不包 status/data），便于前端 blob 下载后文本编辑器可读。
app.get('/api/folders/:id/export', async (req, res) => {
  try {
    const bundle = await buildExport(pool, req.params.id)
    res.json(bundle)
  } catch (err) {
    res.status(err.status || 500).json({ status: 'error', message: err.message })
  }
})


// ===== 创建文件夹 =====
app.post('/api/folders', async (req, res) => {
  const { name, parentId } = req.body
  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: '文件夹名称不能为空' })
  }

  const id = crypto.randomUUID()
  try {
    await pool.query(
      'INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)',
      [id, name.trim(), parentId === 'root' ? null : parentId]
    )
    res.json({
      status: 'ok',
      data: {
        id,
        name: name.trim(),
        parentId: parentId === 'root' ? null : parentId,
        createdAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 重命名文件夹 =====
app.put('/api/folders/:id', async (req, res) => {
  const { name } = req.body
  if (!name || !name.trim()) {
    return res.status(400).json({ status: 'error', message: '文件夹名称不能为空' })
  }
  try {
    const [result] = await pool.query('UPDATE folders SET name = ? WHERE id = ?', [name.trim(), req.params.id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '文件夹不存在' })
    }
    res.json({ status: 'ok', message: '重命名成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 删除文件夹（移入回收站，包含文件夹和文章）=====
// 事务逻辑 / 环检测 / root 防护在 folderDelete.js，便于单测；这里只负责 HTTP 响应。
app.delete('/api/folders/:id', async (req, res) => {
  const folderId = req.params.id
  const rootErr = guardRoot(folderId, '删除')
  if (rootErr) return res.status(400).json({ status: 'error', message: rootErr })
  try {
    await withTransaction(pool, (conn) => softDeleteFolder(folderId, conn))
    res.json({ status: 'ok', message: '已移入回收站' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 回收站列表（文件夹+文章） =====
app.get('/api/trash', async (req, res) => {
  try {
    const [folders] = await pool.query(
      'SELECT id, name, parent_id AS parentId, created_at AS createdAt, deleted_at AS deletedAt FROM folders WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
    )
    const [articles] = await pool.query(
      'SELECT id, title, folder_id AS folderId, created_at AS createdAt, deleted_at AS deletedAt FROM articles WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
    )
    res.json({ status: 'ok', data: { folders, articles } })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 从回收站恢复 =====
app.post('/api/folders/:id/restore', async (req, res) => {
  const folderId = req.params.id
  const rootErr = guardRoot(folderId, '恢复')
  if (rootErr) return res.status(400).json({ status: 'error', message: rootErr })
  try {
    await withTransaction(pool, (conn) => restoreFolder(folderId, conn))
    res.json({ status: 'ok', message: '恢复成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 永久删除（从回收站彻底删除，含文章） =====
app.delete('/api/folders/:id/force', async (req, res) => {
  const folderId = req.params.id
  const rootErr = guardRoot(folderId, '永久删除')
  if (rootErr) return res.status(400).json({ status: 'error', message: rootErr })
  try {
    const { articleIds } = await withTransaction(pool, (conn) => forceDeleteFolder(folderId, conn))
    // 级联删掉的文章音频已无引用：后台清理（事务提交后触发，避免回滚留下已清缓存）
    if (articleIds.length > 0) cleanupTtsCacheAfterDelete('folder-force-delete')
    res.json({ status: 'ok', message: '永久删除成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 外刊文章 API =====
// 获取单篇文章
app.get('/api/article/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, content, notes, folder_id AS folderId, type, created_at AS createdAt FROM articles WHERE id = ?',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ status: 'error', message: '文章不存在' })
    const row = rows[0]

    res.json({ status: 'ok', data: row })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 获取某个文件夹下的所有文章
app.get('/api/articles/:folderId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, content, folder_id AS folderId, created_at AS createdAt FROM articles WHERE folder_id = ? ORDER BY title ASC',
      [req.params.folderId]
    )
    res.json({ status: 'ok', data: rows })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 创建文章
app.post('/api/articles', async (req, res) => {
  const { title, content, folderId, type } = req.body
  if (!title || !title.trim()) {
    return res.status(400).json({ status: 'error', message: '文章标题不能为空' })
  }
  // 禁止在根目录（'root' 或空）下新建文章：文章必须归属某个具体文件夹
  if (!folderId || folderId === 'root') {
    return res.status(400).json({ status: 'error', message: '根目录下不能新建文章，请先进入一个文件夹' })
  }

  const id = crypto.randomUUID()
  try {
    const finalType = type || ''
    await pool.query(
      'INSERT INTO articles (id, title, content, folder_id, type) VALUES (?, ?, ?, ?, ?)',
      [id, title.trim(), content || '', folderId, finalType]
    )
    res.json({
      status: 'ok',
      data: {
        id,
        title: title.trim(),
        content: content || '',
        folderId,
        type: finalType,
        createdAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 删除文章
// 更新文章
app.put('/api/articles/:id', async (req, res) => {
  const { title, content, type, folderId } = req.body
  try {
    // 正文是否真的变了（只改标题不触发音频缓存清理）
    let contentChanged = false
    if (content !== undefined) {
      const [rows] = await pool.query('SELECT content FROM articles WHERE id = ?', [req.params.id])
      contentChanged = rows.length > 0 && (rows[0].content || '') !== (content || '')
    }
    const sets = []
    const vals = []
    if (title !== undefined) { sets.push('title = ?'); vals.push(title.trim()) }
    if (content !== undefined) { sets.push('content = ?'); vals.push(content || '') }
    if (type !== undefined) { sets.push('type = ?'); vals.push(type || '') }
    // folderId：移动文章到其它文件夹（仅更新归属，不再按目录重算文章类型）
    if (folderId !== undefined && folderId && folderId !== 'root') {
      sets.push('folder_id = ?'); vals.push(folderId)
    }
    if (!sets.length) {
      return res.status(400).json({ status: 'error', message: '无更新内容' })
    }
    vals.push(req.params.id)
    const [result] = await pool.query(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`, vals)
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '文章不存在' })
    }
    // 旧段落文本的音频已无文章引用：后台清理，不阻塞响应
    if (contentChanged) cleanupUnusedTtsCache('article-update')
    res.json({ status: 'ok', message: '更新成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 获取某文章的笔记（生文本，原样返回）
app.get('/api/articles/:id/notes', async (req, res) => {
  const { id } = req.params
  try {
    const [rows] = await pool.query('SELECT notes FROM articles WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ status: 'error', message: '文章未找到' })
    const notes = typeof rows[0].notes === 'string' ? rows[0].notes : ''
    res.json({ status: 'ok', data: notes })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 保存笔记（生文本，原样存储，不做解析/处理）
app.put('/api/articles/:id/notes', async (req, res) => {
  const { id } = req.params
  const { notes } = req.body || {}
  try {
    const notesText = typeof notes === 'string' ? notes : (notes ? JSON.stringify(notes) : '')
    const [result] = await pool.query('UPDATE articles SET notes = ? WHERE id = ?', [notesText, id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '文章未找到' })
    }
    res.json({ status: 'ok', length: notesText.length })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 获取某文章的重点标记（JSON 对象，键为 `noteIndex__词汇`，值为 true）
app.get('/api/articles/:id/marks', async (req, res) => {
  const { id } = req.params
  try {
    const [rows] = await pool.query('SELECT marks FROM articles WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ status: 'error', message: '文章未找到' })
    let marks = {}
    if (rows[0].marks) {
      try { marks = JSON.parse(rows[0].marks) } catch (_) { marks = {} }
    }
    res.json({ status: 'ok', data: marks })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 保存某文章的重点标记（整体覆盖，传入 JSON 对象）
app.put('/api/articles/:id/marks', async (req, res) => {
  const { id } = req.params
  const { marks } = req.body || {}
  try {
    const finalText = marks && typeof marks === 'object' ? JSON.stringify(marks) : '{}'
    const [result] = await pool.query('UPDATE articles SET marks = ? WHERE id = ?', [finalText, id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '文章未找到' })
    }
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 获取某文章的笔记卡片收藏（JSON 数组，每个元素为被收藏卡片内容的拷贝 {english, chinese, vocabItems}）
app.get('/api/articles/:id/note-favorites', async (req, res) => {
  const { id } = req.params
  try {
    const [rows] = await pool.query('SELECT note_favorites FROM articles WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ status: 'error', message: '文章未找到' })
    let favorites = []
    if (rows[0].note_favorites) {
      try { favorites = JSON.parse(rows[0].note_favorites) } catch (_) { favorites = [] }
    }
    if (!Array.isArray(favorites)) favorites = []
    res.json({ status: 'ok', data: favorites })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 保存某文章的笔记卡片收藏（整体覆盖，传入 JSON 数组）
app.put('/api/articles/:id/note-favorites', async (req, res) => {
  const { id } = req.params
  const { favorites } = req.body || {}
  try {
    const finalText =
      Array.isArray(favorites) ? JSON.stringify(favorites) : '[]'
    const [result] = await pool.query('UPDATE articles SET note_favorites = ? WHERE id = ?', [finalText, id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '文章未找到' })
    }
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

app.delete('/api/articles/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM canvas_strokes WHERE article_id = ?', [req.params.id])
    const [result] = await pool.query('DELETE FROM articles WHERE id = ?', [req.params.id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '文章不存在' })
    }
    // 文章已删：其段落音频不再被引用，后台清理（含延迟补清，覆盖在途合成后写盘）
    cleanupTtsCacheAfterDelete('article-delete')
    res.json({ status: 'ok', message: '删除成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 批注 CRUD =====

// 获取某文章的所有批注
app.get('/api/annotations/:articleId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, article_id AS articleId, paragraph_index AS paragraphIndex, start_offset AS startOffset, end_offset AS endOffset, text, type, color, note, created_at AS createdAt FROM annotations WHERE article_id = ? ORDER BY paragraph_index ASC, start_offset ASC',
      [req.params.articleId]
    )
    res.json({ status: 'ok', data: rows })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 创建批注
app.post('/api/annotations', async (req, res) => {
  const { id, articleId, paragraphIndex, startOffset, endOffset, text, type, color, note } = req.body
  if (!id || !articleId) {
    return res.status(400).json({ status: 'error', message: '参数不完整' })
  }
  try {
    await pool.query(
      'INSERT INTO annotations (id, article_id, paragraph_index, start_offset, end_offset, text, type, color, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, articleId, paragraphIndex, startOffset, endOffset, text, type, color, note || '']
    )
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 更新批注注释
app.put('/api/annotations/:id', async (req, res) => {
  const { note } = req.body
  try {
    const [result] = await pool.query('UPDATE annotations SET note = ? WHERE id = ?', [note || '', req.params.id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '批注不存在' })
    }
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 删除批注
app.delete('/api/annotations/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM annotations WHERE id = ?', [req.params.id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '批注不存在' })
    }
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 单词查询（有道词典） =====

// 内存缓存：缓存查词结果，避免重复请求有道
const lookupCache = new Map()
const CACHE_MAX_SIZE = 2000 // 最多缓存 2000 个词

// 请求去重：同一个词正在请求中时，复用同一个 Promise
const pendingLookups = new Map()

function cacheGet(word) {
  const entry = lookupCache.get(word)
  if (!entry) return null
  // 命中后移到末尾（LRU）
  lookupCache.delete(word)
  lookupCache.set(word, entry)
  return entry
}

function cacheSet(word, result) {
  // 只缓存成功结果（30 分钟）；错误结果绝不缓存，否则重试在 TTL 内恒失败
  if (result && result.error) return
  lookupCache.set(word, { result, expiresAt: Date.now() + 30 * 60_000 })
  if (lookupCache.size > CACHE_MAX_SIZE) {
    const oldest = lookupCache.keys().next().value
    lookupCache.delete(oldest)
  }
}

// 定时全局清扫过期缓存（不只命中时删除当前词）
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of lookupCache) {
    if (entry.expiresAt <= now) lookupCache.delete(key)
  }
}, 5 * 60_000).unref()

// 有道 HTML 解析已抽到 youdaoParser.js（含实体解码 + 音标 trim + 单测），直接使用 parseYoudaoResult()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 仅对瞬态错误重试：连接重置 / 超时 / undici 连接错误 / 5xx
function isTransientError(err, status) {
  if (status >= 500) return true
  const msg = `${err?.message || ''} ${err?.cause?.code || ''} ${err?.code || ''}`
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|UND_ERR|fetch failed|socket hang up|timeout|aborted/i.test(msg)
}

// 带有限重试 + 总超时的有道 HTML 抓取；失败信息统一为中文并打日志。
// 最多 3 次尝试，退避 250ms / 600ms，全部尝试受一个 8s AbortController 约束。
async function fetchYoudaoHtml(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  const delays = [0, 250, 600]
  let timedOut = false
  try {
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt]) await sleep(delays[attempt])
      // 总超时或已中止：不再发起新尝试
      if (controller.signal.aborted) {
        timedOut = true
        break
      }
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9',
          },
          signal: controller.signal,
        })
        if (!response.ok) {
          const httpErr = new Error(`词典服务返回 ${response.status}`)
          if (!isTransientError(httpErr, response.status) || attempt === delays.length - 1) {
            throw httpErr
          }
          console.warn(`[lookup] HTTP ${response.status}，第 ${attempt + 1} 次尝试失败，重试中`)
          continue
        }
        return await response.text()
      } catch (err) {
        if (controller.signal.aborted) {
          timedOut = true
          break
        }
        if (!isTransientError(err) || attempt === delays.length - 1) throw err
        console.warn(`[lookup] ${err.message}，第 ${attempt + 1} 次尝试失败，重试中`)
      }
    }
    if (timedOut) throw new Error('查询超时，请稍后重试')
    throw new Error('词典服务连接失败，请稍后重试')
  } finally {
    clearTimeout(timeout)
  }
}

// ===== 有道联想词 =====
app.get('/api/suggest', async (req, res) => {
  const keyword = (req.query.q || '').trim().toLowerCase()
  if (!keyword || !/[a-z]/.test(keyword)) {
    return res.json({ status: 'ok', data: [] })
  }
  // 超时控制：联想词不应长时间挂起；失败与「无联想词」用不同响应区分
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const url = `https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q=${encodeURIComponent(keyword)}`
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: controller.signal,
    })
    if (!resp.ok) throw new Error(`联想词服务返回 ${resp.status}`)
    const json = await resp.json()
    // 有道返回格式: { result: { code: 200 }, data: { entries: [{ entry, explain }] } }
    if (json?.result?.code !== 200) {
      return res.json({ status: 'ok', data: [] })
    }
    const entries = json?.data?.entries || []
    return res.json({
      status: 'ok',
      data: entries.map((e) => ({ entry: e.entry, explain: e.explain })),
    })
  } catch (err) {
    console.error('[suggest] 请求失败:', err.message)
    // 与「无联想词」(status:ok, data:[]) 区分：故障返回非 2xx + message
    return res.status(502).json({ status: 'error', message: '联想词服务暂时不可用' })
  } finally {
    clearTimeout(timeout)
  }
})

// 统一错误契约：失败一律「非 2xx + { message }」，成功 200 + 数据；错误绝不写缓存。
function toChineseLookupError(err) {
  const msg = String(err?.message || '')
  if (/超时|timeout|abort/i.test(msg)) return '查询超时，请稍后重试'
  if (/连接失败|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|UND_ERR|socket hang up/i.test(msg)) {
    return '词典服务连接失败，请稍后重试'
  }
  if (/词典服务返回/.test(msg)) return '词典服务暂时不可用，请稍后重试'
  return msg || '查询失败，请稍后重试'
}

function sendLookupResult(res, word, result) {
  if (result && result.error) {
    console.error('[lookup] 查询失败:', result.error)
    return res.status(502).json({ message: toChineseLookupError(new Error(result.error)) })
  }
  res.json({ word, ...result })
}

app.get('/api/lookup', async (req, res) => {
  const word = (req.query.word || '').trim().toLowerCase()
  if (!word || !/[a-z]/.test(word)) {
    return res.status(400).json({ message: '无效的查询内容' })
  }

  // 1. 检查缓存
  const cached = cacheGet(word)
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ word, ...cached.result })
  }
  if (cached) lookupCache.delete(word)

  // 2. 请求去重：同一个词正在请求中时复用同一结果（含失败结果）
  if (pendingLookups.has(word)) {
    try {
      return sendLookupResult(res, word, await pendingLookups.get(word))
    } catch (err) {
      console.warn('[lookup] 复用请求异常，重新发起:', err.message)
    }
  }

  // 3. 发起新请求；TTS 预热与释义查询并行启动
  const lookupPromise = doLookup(word)
  pendingLookups.set(word, lookupPromise)
  warmupTts(word)

  try {
    const result = await lookupPromise
    if (!result.error) cacheSet(word, result) // 只缓存成功结果
    sendLookupResult(res, word, result)
  } catch (err) {
    console.error('[lookup] 查询异常:', err.message)
    res.status(502).json({ message: toChineseLookupError(err) })
  } finally {
    pendingLookups.delete(word)
  }
})

async function doLookup(word) {
  try {
    const url = `https://dict.youdao.com/result?word=${encodeURIComponent(word)}&lang=en`
    const html = await fetchYoudaoHtml(url)
    return parseYoudaoResult(html)
  } catch (err) {
    return { error: toChineseLookupError(err) }
  }
}

// ===== 收藏 API =====

// 确保收藏表存在
async function ensureFavoritesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      article_id VARCHAR(64) PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    )
  `)
}

// 获取所有收藏的文章 ID
app.get('/api/favorites', async (req, res) => {
  try {
    await ensureFavoritesTable()
    const [rows] = await pool.query('SELECT article_id AS articleId FROM favorites ORDER BY created_at DESC')
    res.json({ status: 'ok', data: rows.map((r) => r.articleId) })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 切换收藏（有则删除，无则添加）
app.post('/api/favorites/:articleId', async (req, res) => {
  const { articleId } = req.params
  try {
    await ensureFavoritesTable()
    const [existing] = await pool.query('SELECT article_id FROM favorites WHERE article_id = ?', [articleId])
    if (existing.length) {
      await pool.query('DELETE FROM favorites WHERE article_id = ?', [articleId])
      res.json({ status: 'ok', favorited: false })
    } else {
      await pool.query('INSERT INTO favorites (article_id) VALUES (?)', [articleId])
      res.json({ status: 'ok', favorited: true })
    }
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 画布笔迹 =====
async function _ensureCanvasTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_strokes (
      article_id VARCHAR(64) PRIMARY KEY,
      strokes_data JSON NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)
  try { await pool.query('ALTER TABLE canvas_strokes DROP FOREIGN KEY canvas_strokes_ibfk_1') } catch (_) {}
}

app.get('/api/canvas-strokes/:articleId', async (req, res) => {
  const { articleId } = req.params
  try {
    const [rows] = await pool.query(
      'SELECT strokes_data FROM canvas_strokes WHERE article_id = ?',
      [articleId]
    )
    const data = rows.length ? rows[0].strokes_data : []
    res.json({ status: 'ok', data })
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      try {
        await _ensureCanvasTable()
        const [rows] = await pool.query(
          'SELECT strokes_data FROM canvas_strokes WHERE article_id = ?',
          [articleId]
        )
        const data = rows.length ? rows[0].strokes_data : []
        return res.json({ status: 'ok', data })
      } catch (e) {
        return res.status(500).json({ status: 'error', message: e.message })
      }
    }
    res.status(500).json({ status: 'error', message: err.message })
  }
})

app.post('/api/canvas-strokes/:articleId', async (req, res) => {
  const { articleId } = req.params
  const { strokes } = req.body
  if (!Array.isArray(strokes)) {
    return res.status(400).json({ status: 'error', message: 'strokes 必须是数组' })
  }
  try {
    await pool.query(
      `INSERT INTO canvas_strokes (article_id, strokes_data)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE strokes_data = VALUES(strokes_data)`,
      [articleId, JSON.stringify(strokes)]
    )
    res.json({ status: 'ok' })
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      try {
        await _ensureCanvasTable()
        await pool.query(
          `INSERT INTO canvas_strokes (article_id, strokes_data)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE strokes_data = VALUES(strokes_data)`,
          [articleId, JSON.stringify(strokes)]
        )
        return res.json({ status: 'ok' })
      } catch (e) {
        return res.status(500).json({ status: 'error', message: e.message })
      }
    }
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 有道 TTS 发音代理（服务端缓存 + 请求去重，避免重复请求有道 & 浏览器 CORS） =====
const ttsCache = new Map()
const TTS_CACHE_MAX = 500
const pendingTts = new Map()

// 提取的 TTS 抓取函数，供 API 和预热共用。
// Node 原生 fetch 基于 undici，默认启用 keep-alive 连接池；旧代码传的 `agent: https.Agent`
// 对 undici 无效（应使用 dispatcher），已移除。加 8s 超时避免挂起。
async function fetchTtsAudio(word, accent) {
  const type = accent === 'uk' ? 1 : 2
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const resp = await fetch(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`, {
      signal: controller.signal,
    })
    if (!resp.ok) throw new Error(`TTS fetch failed: ${resp.status}`)
    return Buffer.from(await resp.arrayBuffer())
  } finally {
    clearTimeout(timeout)
  }
}

function storeTtsCache(cacheKey, buf) {
  if (ttsCache.size >= TTS_CACHE_MAX) {
    const key = ttsCache.keys().next().value
    ttsCache.delete(key)
  }
  ttsCache.set(cacheKey, buf)
}

// 查词成功后后台预热 TTS 缓存，不阻塞响应。
// 失败时立即从 pendingTts 清除（不留 undefined 让去重分支误判后再发一次请求）。
function warmupTts(word) {
  if (!word || word.length > 50 || !/^[a-zA-Z\s'-]+$/.test(word)) return
  for (const accent of ['uk', 'us']) {
    const cacheKey = `${word}:${accent}`
    if (ttsCache.has(cacheKey) || pendingTts.has(cacheKey)) continue
    const fetchPromise = fetchTtsAudio(word, accent)
      .then((buf) => { storeTtsCache(cacheKey, buf); return buf })
      .catch((err) => {
        console.warn(`[tts] 预热 ${cacheKey} 失败:`, err.message)
        return null
      })
      .finally(() => pendingTts.delete(cacheKey))
    pendingTts.set(cacheKey, fetchPromise)
  }
}

app.get('/api/tts', async (req, res) => {
  let word = (req.query.word || '').trim().toLowerCase()
  const accent = req.query.accent || 'uk'
  if (!word || word.length > 50 || !/^[a-zA-Z\s'-]+$/.test(word)) {
    return res.status(400).end()
  }
  const cacheKey = `${word}:${accent}`
  // 1. 缓存命中
  if (ttsCache.has(cacheKey)) {
    const buf = ttsCache.get(cacheKey)
    res.set('Content-Type', 'audio/mpeg')
    res.set('X-Cache', 'HIT')
    return res.end(buf)
  }
  // 2. 请求去重：同一单词+口音正在请求时复用
  if (pendingTts.has(cacheKey)) {
    try {
      const buf = await pendingTts.get(cacheKey)
      if (buf) {
        res.set('Content-Type', 'audio/mpeg')
        res.set('X-Cache', 'DEDUP')
        return res.end(buf)
      }
    } catch {}
  }
  // 3. 发起新请求
  const fetchPromise = fetchTtsAudio(word, accent)
  pendingTts.set(cacheKey, fetchPromise)
  try {
    const buf = await fetchPromise
    storeTtsCache(cacheKey, buf)
    res.set('Content-Type', 'audio/mpeg')
    res.set('X-Cache', 'MISS')
    res.end(buf)
  } catch {
    res.status(502).end()
  } finally {
    pendingTts.delete(cacheKey)
  }
})

// ===== 健康检查 =====
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok')
    res.json({ status: 'ok', message: 'MySQL 连接成功', data: rows })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== Python 解释器路径（朗读 TTS 子进程使用）=====
// 换机只改这里，也可用环境变量 PYTHON_HOME 覆盖
const PYTHON_HOME = process.env.PYTHON_HOME || 'D:\\PythonFiles\\.venv'

// ===== 朗读 TTS（Edge TTS / Andrew，服务端缓存 + 请求去重）=====
// 与单词发音 /api/tts（有道）不同：这里走 edge-tts 合成整段，返回 base64 mp3 + 词级时间戳。
// 浏览器 Web Speech API 无法导出/缓存音频，故放到服务端合成并缓存，前端一次下载、本地播放，
// 避免每次播放/跳转都在线加载。WordBoundary 的 offset/duration 单位是 100ns tick。
const readTtsCache = new Map()
const READ_TTS_CACHE_MAX = 200
const pendingReadTts = new Map()
const READ_TTS_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tts_synth.py')
const READ_TTS_VOICE = 'en-US-AndrewNeural'
// 磁盘缓存工具 / 音色常量已抽到 ./ttsCache.js（供 folderBundle 复用）；
// 这里只保留进程内的内存 LRU 与进行中去重（不跨模块共享）。
function storeReadTts(key, payload) {
  if (readTtsCache.size >= READ_TTS_CACHE_MAX) {
    readTtsCache.delete(readTtsCache.keys().next().value)
  }
  readTtsCache.set(key, payload)
}
// 与 tts_synth.py 一致：单段最多 3 次尝试、每次限时 20s、退避 1s+2s。
// Python 用 asyncio.gather 并发合成，故整批超时按「单次重试最坏耗时 + 30s 启动余量」给，不按段数累加。
const TTS_MAX_ATTEMPTS = 3
const TTS_ATTEMPT_TIMEOUT_MS = 20000
const TTS_RETRY_BACKOFF_MS = 3000

// 收集当前库里「还有文章在用」的缓存 key（段落文本 × 三音色）。
// 段落切分规则与前端 paragraphs 一致：按 \n 切、丢弃纯空白行。
async function collectLiveTtsKeys() {
  const [rows] = await pool.query('SELECT content FROM articles')
  const paragraphs = new Set()
  for (const row of rows) {
    for (const line of normalizeTtsText(row.content).split('\n')) {
      if (line.trim()) paragraphs.add(line)
    }
  }
  const keys = new Set()
  for (const text of paragraphs) {
    for (const voice of READ_TTS_VOICES) keys.add(readTtsKey(text, voice, READ_TTS_RATE))
  }
  return keys
}

// 清理无用音频：删掉内存 / 磁盘里不再对应任何文章段落的缓存文件（历史编辑、旧音色、已删文章）。
// 启动时跑一次兜底；正文变更 / 文章永久删除后再异步跑一次。并发调用合并为一次补跑。
let ttsCleanupRunning = false
let ttsCleanupAgain = false
async function cleanupUnusedTtsCache(reason = '') {
  if (ttsCleanupRunning) {
    ttsCleanupAgain = true
    return
  }
  ttsCleanupRunning = true
  try {
    const live = await collectLiveTtsKeys()
    for (const key of [...readTtsCache.keys()]) {
      if (!live.has(key)) readTtsCache.delete(key)
    }
    let removed = 0
    for (const entry of readdirSync(READ_TTS_DISK, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const isJson = entry.name.endsWith('.json')
      const key = isJson ? entry.name.slice(0, -5) : ''
      if (isJson && live.has(key)) continue
      // 非 .json（写入中途的 .tmp）只清 1 分钟前的，避免和正在进行的原子写抢文件
      if (!isJson) {
        try {
          if (Date.now() - statSync(path.join(READ_TTS_DISK, entry.name)).mtimeMs < 60_000) continue
        } catch (_) {
          continue
        }
      }
      try {
        unlinkSync(path.join(READ_TTS_DISK, entry.name))
        removed++
      } catch (_) {}
    }
    if (removed) console.log(`[tts] 清理无用音频缓存 ${removed} 个${reason ? `（${reason}）` : ''}`)
  } catch (err) {
    console.error('[tts] 清理音频缓存失败:', err.message)
  } finally {
    ttsCleanupRunning = false
    if (ttsCleanupAgain) {
      ttsCleanupAgain = false
      cleanupUnusedTtsCache(reason)
    }
  }
}

// 删除类操作专用：客户端「取消在途请求」只断前端连接，已到后端的合成仍会完成并写盘，
// 若写盘发生在首轮清理之后就会留下孤儿。故立即清一次 + 延迟补清一次覆盖该窗口。
// 定时器 unref，不阻塞进程退出；即便错过窗口，下次启动 / 编辑 / 删除也会再清。
function cleanupTtsCacheAfterDelete(reason) {
  cleanupUnusedTtsCache(reason)
  const timer = setTimeout(() => cleanupUnusedTtsCache(`${reason}-recheck`), 25_000)
  if (timer.unref) timer.unref()
}

// spawn 单个 Python 进程批量合成：一次传多段，进程内 asyncio.gather 并发，
// 省掉每段重复 spawn + import 的开销（实测 4 段 7.3s → 2.9s）。
// stdin 写 {items:[{id,text}],voice,rate}，stdout 读 {results:{id:{audio,words}}}。
function synthTtsBatch(items, voice, rate) {
  return new Promise((resolve, reject) => {
    if (!existsSync(path.join(PYTHON_HOME, 'Scripts', 'python.exe'))) {
      reject(new Error('Python 解释器不存在（检查 PYTHON_HOME）'))
      return
    }
    if (!existsSync(READ_TTS_SCRIPT)) {
      reject(new Error(`TTS 脚本不存在: ${READ_TTS_SCRIPT}`))
      return
    }
    const proc = spawn(path.join(PYTHON_HOME, 'Scripts', 'python.exe'), [READ_TTS_SCRIPT], {
      cwd: path.dirname(READ_TTS_SCRIPT),
      stdio: ['pipe', 'pipe', 'pipe'],
      // 后端是无控制台启动的；console 版 python.exe 被 spawn 时 Windows 会新建控制台窗口（黑框）。
      // windowsHide → CREATE_NO_WINDOW，保留 python.exe 才能用 stdout 读合成结果（pythonw 没有 stdout）。
      windowsHide: true,
      // 强制 Python UTF-8 模式：Windows 默认 locale 可能是 GBK，导致中文错误提示回传后乱码。
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    let out = ''
    let err = ''
    // Python 内并发 + 单段最多 3 次 × 20s + 退避 3s，取最坏耗时再留 30s 启动余量
    const timer = setTimeout(
      () => proc.kill(),
      30000 + TTS_MAX_ATTEMPTS * TTS_ATTEMPT_TIMEOUT_MS + TTS_RETRY_BACKOFF_MS,
    )
    proc.stdout.on('data', (d) => { out += d.toString('utf8') })
    proc.stderr.on('data', (d) => { err += d.toString('utf8') })
    proc.on('error', reject)
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`TTS 进程退出 ${code}: ${err.slice(0, 200)}`))
        return
      }
      try {
        const result = JSON.parse(out)
        if (result.error) reject(new Error(result.error))
        else resolve(result.results || {})
      } catch (e) {
        reject(new Error(`TTS 结果解析失败: ${e.message}`))
      }
    })
    proc.stdin.write(JSON.stringify({ items, voice, rate }))
    proc.stdin.end()
  })
}

// 取一段音频：内存 → 磁盘 → 合成（合成后写回两级缓存）。返回 { ...payload, cache }。
// force=true（底层能力，当前编辑流程不再使用）跳过缓存强制重合成并覆盖写回，标 cache='REBUILT'。
async function getReadTts(text, voice, rate, force = false) {
  const key = readTtsKey(text, voice, rate)
  if (!force) {
    if (readTtsCache.has(key)) return { ...readTtsCache.get(key), cache: 'HIT' }
    const disk = readTtsDiskFile(key)
    if (disk) {
      storeReadTts(key, disk)
      return { ...disk, cache: 'DISK' }
    }
    if (pendingReadTts.has(key)) {
      try {
        const payload = await pendingReadTts.get(key)
        return { ...payload, cache: 'DEDUP' }
      } catch {}
    }
  }
  const task = synthTtsBatch([{ id: 0, text }], voice, rate).then((results) => {
    const payload = results[0]
    if (!payload || payload.error) throw new Error(payload?.error || 'TTS 合成失败')
    storeReadTts(key, payload)
    writeTtsDiskFile(key, payload) // force 时覆盖同一 key 的旧文件
    return payload
  })
  pendingReadTts.set(key, task)
  try {
    const payload = await task
    return { ...payload, cache: force ? 'REBUILT' : 'MISS' }
  } finally {
    pendingReadTts.delete(key)
  }
}

app.post('/api/tts/read', async (req, res) => {
  const text = (req.body?.text || '').trim()
  const voice = (req.body?.voice || READ_TTS_VOICE).toString()
  const rate = (req.body?.rate || '+0%').toString()
  const force = req.body?.force === true
  if (!text || text.length > 3000) {
    return res.status(400).json({ error: '文本为空或过长（上限 3000 字）' })
  }
  try {
    const payload = await getReadTts(text, voice, rate, force)
    res.set('X-Cache', payload.cache)
    res.json(payload)
  } catch (err) {
    console.error('[tts/read] 合成失败:', err.message)
    res.status(502).json({ error: err.message })
  }
})

// 批量预取：先查内存/磁盘分出命中项，只把未命中的段合并为【一次】spawn 交 Python 进程内并发合成。
// 这样已缓存段瞬时返回、未缓存段共享一次进程启动开销。items:[{id,text}] → results:{id:payload}，
// 每项带 cache: HIT/DISK/DEDUP/MISS；单项失败仅该项带 error，不拖垮整批。
app.post('/api/tts/read/batch', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : []
  const voice = (req.body?.voice || READ_TTS_VOICE).toString()
  const rate = (req.body?.rate || '+0%').toString()
  const force = req.body?.force === true
  const valid = items
    .map((it, idx) => ({ id: it?.id ?? idx, text: (it?.text || '').trim() }))
    .filter((it) => it.text && it.text.length <= 3000)
  if (!valid.length) return res.json({ results: [] })

  const results = {}
  const pending = [] // 未命中、需合成的 { id, text, key }
  // 1) 先查内存 + 磁盘 + 进行中的去重请求；force 时跳过缓存查询、全部强制重新合成
  for (const it of valid) {
    const key = readTtsKey(it.text, voice, rate)
    if (force) {
      pending.push({ ...it, key })
    } else if (readTtsCache.has(key)) {
      results[it.id] = { ...readTtsCache.get(key), cache: 'HIT' }
    } else {
      const disk = readTtsDiskFile(key)
      if (disk) {
        storeReadTts(key, disk)
        results[it.id] = { ...disk, cache: 'DISK' }
      } else if (pendingReadTts.has(key)) {
        pending.push({ ...it, key, wait: pendingReadTts.get(key) })
      } else {
        pending.push({ ...it, key })
      }
    }
  }
  // 2) 等待进行中的单段合成（去重命中）
  for (const p of pending) {
    if (p.wait) {
      try {
        const payload = await p.wait
        results[p.id] = { ...payload, cache: 'DEDUP' }
      } catch {}
    }
  }
  // 3) 真正未命中且无进行中请求的段 → 合并为一次 spawn，进程内并发合成
  const toSynth = pending.filter((p) => !p.wait)
  if (toSynth.length) {
    const byKey = new Map()
    for (const p of toSynth) if (!byKey.has(p.key)) byKey.set(p.key, p)
    const synthItems = [...byKey.values()]
    // 每个 key 一个独立 deferred：去重占位只 resolve 自己那段的 payload，
    // 避免 getReadTts 命中去重时误拿到整批 map。
    const deferred = new Map()
    for (const s of synthItems) {
      let resolve, reject
      const promise = new Promise((res, rej) => { resolve = res; reject = rej })
      // 可能没有并发的 getReadTts 来 await 它；抑制未处理 rejection，错误经 results 回传即可
      promise.catch(() => {})
      deferred.set(s.key, { promise, resolve, reject })
      pendingReadTts.set(s.key, promise)
    }
    const payloadByKey = new Map()
    try {
      const raw = await synthTtsBatch(
        synthItems.map((s, i) => ({ id: i, text: s.text })), voice, rate,
      )
      synthItems.forEach((s, i) => {
        const payload = raw[i]
        payloadByKey.set(s.key, payload)
        if (payload && !payload.error) {
          storeReadTts(s.key, payload)
          writeTtsDiskFile(s.key, payload)
          deferred.get(s.key).resolve(payload)
        } else {
          deferred.get(s.key).reject(new Error(payload?.error || 'TTS 合成失败'))
        }
      })
    } catch (err) {
      console.error('[tts/read/batch] 合成失败:', err.message)
      for (const s of synthItems) deferred.get(s.key).reject(err)
    } finally {
      for (const s of synthItems) pendingReadTts.delete(s.key)
    }
    for (const p of toSynth) {
      const payload = payloadByKey.get(p.key)
      results[p.id] = payload && !payload.error
        ? { ...payload, cache: force ? 'REBUILT' : 'MISS' }
        : { error: payload?.error || 'TTS 合成失败' }
    }
  }
  res.json({ results })
})

// 朗读音频准备情况（只读）：按当前文章段落文本 × 三音色，逐段检查内存 / 磁盘 /
// 进行中合成，供前端「音频准备情况查看器」展示。只查询、绝不触发合成。
// 请求 { texts: string[], voices?: string[], rate?: string } →
// 响应 { total, voices:[{id,name,memory,disk,pending,miss,ready,total}],
//        paragraphs:[{index,preview,status:{<voice>: 'memory'|'disk'|'pending'|'miss'}}] }
app.post('/api/tts/read/status', (req, res) => {
  const texts = Array.isArray(req.body?.texts)
    ? req.body.texts.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 500)
    : []
  const rate = (req.body?.rate || READ_TTS_RATE).toString()
  const requested = Array.isArray(req.body?.voices) ? req.body.voices.filter((v) => READ_TTS_VOICES.includes(v)) : []
  const voiceIds = requested.length ? requested : READ_TTS_VOICES
  const voiceNames = {
    'en-US-AndrewNeural': 'Andrew',
    'en-US-EmmaMultilingualNeural': 'Emma',
    'en-GB-RyanNeural': 'Ryan',
  }
  const paragraphs = texts.map((text, index) => {
    const status = {}
    for (const voice of voiceIds) {
      const key = readTtsKey(text, voice, rate)
      status[voice] = readTtsCache.has(key)
        ? 'memory'
        : pendingReadTts.has(key)
          ? 'pending'
          : readTtsDiskHas(key)
            ? 'disk'
            : 'miss'
    }
    return { index, preview: text.slice(0, 80), status }
  })
  const voices = voiceIds.map((id) => {
    const memory = paragraphs.filter((p) => p.status[id] === 'memory').length
    const disk = paragraphs.filter((p) => p.status[id] === 'disk').length
    const pending = paragraphs.filter((p) => p.status[id] === 'pending').length
    const miss = paragraphs.filter((p) => p.status[id] === 'miss').length
    return { id, name: voiceNames[id] || id, memory, disk, pending, miss, ready: memory + disk, total: paragraphs.length }
  })
  res.json({ total: paragraphs.length, voices, paragraphs })
})

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
  console.log(`📦 MySQL: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`)
  // 启动兜底：清掉历史遗留（旧音色 / 已改文本 / 已删文章）的无用音频缓存
  cleanupUnusedTtsCache('startup')
})
