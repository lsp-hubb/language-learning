import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import crypto from 'node:crypto'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import pool from './db.js'

const app = express()
const PORT = process.env.SERVER_PORT || 3000

// 读音 Keep-Alive Agent：复用 TCP 连接到有道 dictvoice
const ttsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 2 })

app.use(cors())
app.use(express.json())

// 启动时自动迁移：确保 notes / marks 列存在
;(async () => {
  try { await pool.query('ALTER TABLE articles ADD COLUMN notes TEXT') } catch (_) {}
  // marks：重点词汇标记状态（JSON 文本），键为 `noteIndex__词汇`，值为 true
  try { await pool.query('ALTER TABLE articles ADD COLUMN marks TEXT') } catch (_) {}
  // type：文章类型。空串 = 普通文章；'kaoyan' = 考研英语试题。
  // 由所属目录（祖先链根为「考研英语」）自动写入，便于迁移与直接按字段判定。
  try { await pool.query("ALTER TABLE articles ADD COLUMN type VARCHAR(32) DEFAULT ''") } catch (_) {}
  // answers：考研英语正确答案（JSON 文本），如 { "12": "A", "13": "C" }，录入文章时一并写入
  try { await pool.query('ALTER TABLE articles ADD COLUMN answers TEXT') } catch (_) {}
  // questions：考研英语「题目区」原文（题干 + 选项），与 content（题目原文）分开录入，便于解析
  try { await pool.query('ALTER TABLE articles ADD COLUMN questions TEXT') } catch (_) {}
  // explanations：每题解析文本（JSON 文本），形如 { "1": "..." }，普通文章选择题面板的解析导入入口
  try { await pool.query('ALTER TABLE articles ADD COLUMN explanations TEXT') } catch (_) {}
  // sections：考研英语按题型分组的内容（JSON），
  // 形如 { "kaoyan-cloze": { content, questions, answers }, "kaoyan-partA-1": {...} }
  // 一篇文章（一套真题）可包含多个题型，顶栏切换查看。
  try { await pool.query('ALTER TABLE articles ADD COLUMN sections TEXT') } catch (_) {}
  // picked：用户在各题型下所选答案（JSON 文本），
  // 形如 { "kaoyan-cloze": { "1": "A" }, "kaoyan-partA-1": { "21": "B" } }，落库以便跨会话保留作答进度。
  try { await pool.query('ALTER TABLE articles ADD COLUMN picked TEXT') } catch (_) {}
  // quiz_submitted：普通文章选择题面板是否已提交判分（0/1），落库以便刷新后恢复「已提交」状态
  try { await pool.query('ALTER TABLE articles ADD COLUMN quiz_submitted INTEGER DEFAULT 0') } catch (_) {}
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

// ===== 删除文件夹（移入回收站，包含文件夹和文章） =====
app.delete('/api/folders/:id', async (req, res) => {
  const folderId = req.params.id
  try {
    const folderIds = await collectDescendantIds(folderId)
    folderIds.push(folderId)
    const fPlaceholders = folderIds.map(() => '?').join(',')
    await pool.query(`UPDATE folders SET deleted_at = NOW() WHERE id IN (${fPlaceholders})`, folderIds)
    // 同时软删除文件夹下的所有文章
    const articleIds = await collectArticleIdsInFolders(folderIds)
    if (articleIds.length > 0) {
      const aPlaceholders = articleIds.map(() => '?').join(',')
      await pool.query(`UPDATE articles SET deleted_at = NOW() WHERE id IN (${aPlaceholders})`, articleIds)
    }
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
  try {
    const folderIds = await collectDescendantIds(folderId)
    folderIds.push(folderId)
    const fPlaceholders = folderIds.map(() => '?').join(',')
    await pool.query(`UPDATE folders SET deleted_at = NULL WHERE id IN (${fPlaceholders})`, folderIds)
    // 同时恢复文件夹下的所有文章
    const articleIds = await collectArticleIdsInFolders(folderIds)
    if (articleIds.length > 0) {
      const aPlaceholders = articleIds.map(() => '?').join(',')
      await pool.query(`UPDATE articles SET deleted_at = NULL WHERE id IN (${aPlaceholders})`, articleIds)
    }
    res.json({ status: 'ok', message: '恢复成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 永久删除（从回收站彻底删除，含文章） =====
app.delete('/api/folders/:id/force', async (req, res) => {
  const folderId = req.params.id
  try {
    const folderIds = await collectDescendantIds(folderId)
    folderIds.push(folderId)
    // 先删文章（cascade 自动删 annotations/favorites）
    const articleIds = await collectArticleIdsInFolders(folderIds)
    if (articleIds.length > 0) {
      const aPlaceholders = articleIds.map(() => '?').join(',')
      await pool.query(`DELETE FROM articles WHERE id IN (${aPlaceholders})`, articleIds)
    }
    // 再删文件夹
    const fPlaceholders = folderIds.map(() => '?').join(',')
    await pool.query(`DELETE FROM folders WHERE id IN (${fPlaceholders})`, folderIds)
    res.json({ status: 'ok', message: '永久删除成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 递归收集所有子孙文件夹 ID
async function collectDescendantIds(parentId) {
  const [rows] = await pool.query('SELECT id FROM folders WHERE parent_id = ?', [parentId])
  const ids = []
  for (const row of rows) {
    const children = await collectDescendantIds(row.id)
    ids.push(row.id, ...children)
  }
  return ids
}

// 收集指定文件夹列表下的所有文章 ID
async function collectArticleIdsInFolders(folderIds) {
  if (!folderIds.length) return []
  const placeholders = folderIds.map(() => '?').join(',')
  const [rows] = await pool.query(`SELECT id FROM articles WHERE folder_id IN (${placeholders})`, folderIds)
  return rows.map((r) => r.id)
}

// ===== 考研英语：按目录归属自动判定题型 =====
// 若文章所属目录位于名为「考研英语」的文件夹下（祖先链任意一层命中即可，
// 因此其子目录也生效），则自动标记为考研英语题，默认题型为完形填空。
// 前端显式传 type 时以前端为准（录入面板选题型标签后会覆盖）。
async function resolveExamType(folderId) {
  if (!folderId) return ''
  try {
    const [rows] = await pool.query('SELECT id, name, parent_id FROM folders')
    const map = new Map(rows.map((r) => [r.id, r]))
    let cur = map.get(folderId)
    let guard = 0
    while (cur && guard++ < 50) {
      if (String(cur.name || '').trim() === '考研英语') return 'kaoyan-cloze'
      if (!cur.parent_id) break
      cur = map.get(cur.parent_id)
    }
  } catch (_) {}
  return ''
}

// 判定文章是否为考研英语试题（type 以 kaoyan 前缀）
const isKaoyanType = (t) => String(t || '').startsWith('kaoyan')

// ===== 外刊文章 API =====
// 获取单篇文章
app.get('/api/article/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, content, notes, folder_id AS folderId, type, answers, questions, sections, picked, explanations, quiz_submitted, created_at AS createdAt FROM articles WHERE id = ?',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ status: 'error', message: '文章不存在' })
    const row = rows[0]
    // answers 以 JSON 文本入库，出库反序列化为对象（与 marks 处理一致）
    try { row.answers = row.answers ? JSON.parse(row.answers) : {} } catch (_) { row.answers = {} }
    // sections 以 JSON 文本入库，出库反序列化为对象
    try { row.sections = row.sections ? JSON.parse(row.sections) : {} } catch (_) { row.sections = {} }
    // picked 以 JSON 文本入库，出库反序列化为对象
    try { row.picked = row.picked ? JSON.parse(row.picked) : {} } catch (_) { row.picked = {} }
    // explanations 以 JSON 文本入库，出库反序列化为对象
    try { row.explanations = row.explanations ? JSON.parse(row.explanations) : {} } catch (_) { row.explanations = {} }
    // type 为空时按目录归属补全（仅本次响应，不入库；保存录入内容时会真正写入）。
    // 这样在「考研英语」目录下已存在的旧文章也能正确进入试题页。
    if (!row.type) row.type = await resolveExamType(row.folderId)
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
  const { title, content, folderId, type, answers, questions, sections, explanations } = req.body
  if (!title || !title.trim()) {
    return res.status(400).json({ status: 'error', message: '文章标题不能为空' })
  }
  // 禁止在根目录（'root' 或空）下新建文章：文章必须归属某个具体文件夹
  if (!folderId || folderId === 'root') {
    return res.status(400).json({ status: 'error', message: '根目录下不能新建文章，请先进入一个文件夹' })
  }

  const id = crypto.randomUUID()
  try {
    // 未显式指定 type 时，按所属目录自动判定是否为考研英语题
    const finalType = type || (await resolveExamType(folderId))
    await pool.query(
      'INSERT INTO articles (id, title, content, folder_id, type, answers, questions, sections, explanations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, title.trim(), content || '', folderId, finalType, answers ? JSON.stringify(answers) : null, questions || '', sections ? JSON.stringify(sections) : null, explanations ? JSON.stringify(explanations) : null]
    )
    res.json({
      status: 'ok',
      data: {
        id,
        title: title.trim(),
        content: content || '',
        folderId,
        type: finalType,
        answers: answers || {},
        questions: questions || '',
        sections: sections || {},
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
  const { title, content, type, answers, questions, sections, picked, folderId, explanations, quiz_submitted } = req.body
  try {
    const sets = []
    const vals = []
    if (title !== undefined) { sets.push('title = ?'); vals.push(title.trim()) }
    if (content !== undefined) { sets.push('content = ?'); vals.push(content || '') }
    if (type !== undefined) { sets.push('type = ?'); vals.push(type || '') }
    // answers：考研英语正确答案对象，以 JSON 文本存储
    if (answers !== undefined) { sets.push('answers = ?'); vals.push(answers ? JSON.stringify(answers) : null) }
    // questions：考研英语题目区原文（题干 + 选项），与 content 分开存储
    if (questions !== undefined) { sets.push('questions = ?'); vals.push(questions || '') }
    // sections：按题型分组的内容对象，以 JSON 文本存储
    if (sections !== undefined) { sets.push('sections = ?'); vals.push(sections ? JSON.stringify(sections) : null) }
    // picked：用户在各题型下所选答案（按题型分组），以 JSON 文本存储
    if (picked !== undefined) { sets.push('picked = ?'); vals.push(picked ? JSON.stringify(picked) : null) }
    // quiz_submitted：普通文章选择题面板是否已提交判分（0/1）
    if (quiz_submitted !== undefined) { sets.push('quiz_submitted = ?'); vals.push(quiz_submitted ? 1 : 0) }
    // explanations：每题解析文本（JSON 文本）
    if (explanations !== undefined) { sets.push('explanations = ?'); vals.push(explanations ? JSON.stringify(explanations) : null) }
    // folderId：移动文章到其它文件夹。移动后按新目录归属重算 type，
    // 保证「考研文章只在考研目录下、普通文章只在普通目录下」的判定不串（数据库层兜底）。
    if (folderId !== undefined && folderId && folderId !== 'root') {
      sets.push('folder_id = ?'); vals.push(folderId)
      const newType = await resolveExamType(folderId)
      sets.push('type = ?'); vals.push(newType)
    }
    if (!sets.length) {
      return res.status(400).json({ status: 'error', message: '无更新内容' })
    }
    vals.push(req.params.id)
    const [result] = await pool.query(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`, vals)
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '文章不存在' })
    }
    res.json({ status: 'ok', message: '更新成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 获取某文章的笔记（生文本，原样返回）
// 普通文章：notes 为纯文本，直接返回；考研文章：notes 按题型分节存为 JSON 对象，
// 带 ?section=题型 时返回该节文本（旧纯文本数据返回整段，待首次分节保存自然迁移）。
app.get('/api/articles/:id/notes', async (req, res) => {
  const { id } = req.params
  const { section } = req.query
  try {
    const [rows] = await pool.query('SELECT notes, type FROM articles WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ status: 'error', message: '文章未找到' })
    const row = rows[0]
    let notes = typeof row.notes === 'string' ? row.notes : ''
    if (section && isKaoyanType(row.type)) {
      try {
        const obj = JSON.parse(notes)
        if (obj && typeof obj === 'object') notes = typeof obj[section] === 'string' ? obj[section] : ''
      } catch (_) {
        // 旧纯文本：前端仅考研下带 section，这里整段返回即可
      }
    }
    res.json({ status: 'ok', data: notes })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 保存笔记（生文本，原样存储，不做解析/处理）
// 带 ?section=题型 时（仅考研前端），按题型分节合并进 JSON 对象；否则普通文章原样存储。
app.put('/api/articles/:id/notes', async (req, res) => {
  const { id } = req.params
  const { notes } = req.body || {}
  const { section } = req.query
  try {
    const notesText = typeof notes === 'string' ? notes : (notes ? JSON.stringify(notes) : '')
    let finalText = notesText
    if (section) {
      // 分节模式：读取现有 notes，按题型合并（仅考研文章走此分支）
      const [rows] = await pool.query('SELECT notes, type FROM articles WHERE id = ?', [id])
      if (!rows.length) return res.status(404).json({ status: 'error', message: '文章未找到' })
      let obj = {}
      const cur = rows[0].notes
      if (cur) {
        try { const p = JSON.parse(cur); if (p && typeof p === 'object') obj = p } catch (_) { /* 旧纯文本无分节归属，首次分节保存时丢弃 */ }
      }
      obj[section] = notesText
      finalText = JSON.stringify(obj)
    }
    const [result] = await pool.query('UPDATE articles SET notes = ? WHERE id = ?', [finalText, id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: '文章未找到' })
    }
    res.json({ status: 'ok', length: finalText.length })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 获取某文章的重点标记（JSON 对象，键为 `noteIndex__词汇`，值为 true）
// 带 ?section=题型 时（仅考研前端），返回该节的重点对象；否则普通文章返回整篇对象。
app.get('/api/articles/:id/marks', async (req, res) => {
  const { id } = req.params
  const { section } = req.query
  try {
    const [rows] = await pool.query('SELECT marks, type FROM articles WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ status: 'error', message: '文章未找到' })
    const row = rows[0]
    let marks = {}
    if (row.marks) {
      try { marks = JSON.parse(row.marks) } catch (_) { marks = {} }
    }
    if (section && isKaoyanType(row.type)) {
      marks = (marks && typeof marks === 'object' && marks[section] && typeof marks[section] === 'object') ? marks[section] : {}
    }
    res.json({ status: 'ok', data: marks })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// 保存某文章的重点标记（整体覆盖，传入 JSON 对象）
// 带 ?section=题型 时（仅考研前端），按题型分节合并进 JSON 对象；否则普通文章原样存储。
app.put('/api/articles/:id/marks', async (req, res) => {
  const { id } = req.params
  const { marks } = req.body || {}
  const { section } = req.query
  try {
    let finalText
    if (section) {
      // 分节模式：读取现有 marks，按题型合并（仅考研文章走此分支）
      const [rows] = await pool.query('SELECT marks, type FROM articles WHERE id = ?', [id])
      if (!rows.length) return res.status(404).json({ status: 'error', message: '文章未找到' })
      let obj = {}
      const cur = rows[0].marks
      if (cur) {
        try { const p = JSON.parse(cur); if (p && typeof p === 'object') obj = p } catch (_) { /* 旧数据忽略 */ }
      }
      obj[section] = (marks && typeof marks === 'object') ? marks : {}
      finalText = JSON.stringify(obj)
    } else {
      finalText = marks && typeof marks === 'object' ? JSON.stringify(marks) : '{}'
    }
    const [result] = await pool.query('UPDATE articles SET marks = ? WHERE id = ?', [finalText, id])
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
  // 有 error 的结果也短期缓存（60s），正常结果长期缓存
  const ttl = result.error ? 60_000 : 30 * 60_000 // 错误60s，正常30分钟
  lookupCache.set(word, { result, expiresAt: Date.now() + ttl })
  // 超容量时淘汰最旧的
  if (lookupCache.size > CACHE_MAX_SIZE) {
    const oldest = lookupCache.keys().next().value
    lookupCache.delete(oldest)
  }
}

function extractYoudaoPhonetic(html) {
  const result = { uk: '', us: '' }

  // 方法1（首选）：匹配 div.phone_con > div.per-phone > span + span.phonetic
  const phoneConRe = /<div[^>]*class="phone_con"[^>]*>([\s\S]*?)<\/div>/i
  const phoneConMatch = phoneConRe.exec(html)
  if (phoneConMatch) {
    const perPhoneRe = /<div[^>]*class="per-phone"[^>]*>([\s\S]*?)<\/div>/gi
    let m
    while ((m = perPhoneRe.exec(phoneConMatch[1])) !== null) {
      const block = m[1]
      const langMatch = /<span[^>]*>([^<]*)<\/span>/i.exec(block)
      const phoneMatch = /<span[^>]*class="phonetic"[^>]*>([^<]+)<\/span>/i.exec(block)
      if (langMatch && phoneMatch) {
        const lang = langMatch[1].trim()
        const phone = phoneMatch[1].replace(/^\s+|\s+$/g, '').replace(/^\/|\/$/g, '')
        if (lang.includes('英')) result.uk = `/${phone}/`
        else if (lang.includes('美')) result.us = `/${phone}/`
      }
    }
  }

  // 方法2（备选）：直接取所有 span.phonetic
  if (!result.uk && !result.us) {
    const phoneRe = /<span[^>]*class="phonetic"[^>]*>([^<]+)<\/span>/gi
    const phonetics = []
    let m
    while ((m = phoneRe.exec(html)) !== null) {
      phonetics.push(m[1].trim().replace(/^\/|\/$/g, ''))
    }
    if (phonetics[0]) result.uk = `/${phonetics[0]}/`
    if (phonetics[1]) result.us = `/${phonetics[1]}/`
  }

  return result
}

function extractYoudaoDefs(html) {
  const defs = []
  const blockRe = /<li[^>]*class="word-exp"[^>]*>([\s\S]*?)<\/li>/gi
  let block
  while ((block = blockRe.exec(html)) !== null) {
    const content = block[1]
    const posMatch = /<span[^>]*class="pos"[^>]*>([^<]*)<\/span>/i.exec(content)
    const transMatch = /<span[^>]*class="trans"[^>]*>([^<]*)<\/span>/i.exec(content)
    if (transMatch) {
      defs.push({
        part_of_speech: posMatch ? posMatch[1].trim() : '',
        translation: transMatch[1].trim(),
      })
    }
  }
  return defs
}

function extractYoudaoTranslation(html) {
  // 段落翻译（CSS 选择器: #catalogue_author > div.dict-book > div > div > p.trans-content）
  const re = /<p[^>]*class="trans-content"[^>]*>([\s\S]*?)<\/p>/i
  const m = re.exec(html)
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : ''
}

// ===== 有道联想词 =====
app.get('/api/suggest', async (req, res) => {
  const keyword = (req.query.q || '').trim().toLowerCase()
  if (!keyword || !/[a-z]/.test(keyword)) {
    return res.json({ status: 'ok', data: [] })
  }
  try {
    const url = `https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q=${encodeURIComponent(keyword)}`
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    })
    const json = await resp.json()
    // 有道返回格式: { result: { code: 200 }, data: { entries: [{ entry, explain }] } }
    if (json?.result?.code !== 200) {
      return res.json({ status: 'ok', data: [] })
    }
    const entries = json?.data?.entries || []
    res.json({
      status: 'ok',
      data: entries.map((e) => ({ entry: e.entry, explain: e.explain })),
    })
  } catch (err) {
    console.error('[suggest] error:', err.message)
    res.json({ status: 'ok', data: [] })
  }
})

app.get('/api/lookup', async (req, res) => {
  const word = (req.query.word || '').trim().toLowerCase()
  if (!word || !/[a-z]/.test(word)) {
    return res.status(400).json({ error: '无效的查询内容' })
  }

  // 1. 检查缓存
  const cached = cacheGet(word)
  if (cached && cached.expiresAt > Date.now()) {
    // 确保返回结果包含 word 字段
    return res.json({ word, ...cached.result })
  }
  // 过期缓存删除
  if (cached) lookupCache.delete(word)

  // 2. 请求去重：如果同一个词正在请求中，复用
  if (pendingLookups.has(word)) {
    try {
      const result = await pendingLookups.get(word)
      return res.json({ word, ...result })
    } catch (err) {
      // 之前请求失败了，继续走正常流程
    }
  }

  // 3. 发起新请求
  const lookupPromise = doLookup(word)
  pendingLookups.set(word, lookupPromise)
  // TTS 预热与释义查询并行启动，不等释义查完就开始抓发音
  warmupTts(word)

  try {
    const result = await lookupPromise
    cacheSet(word, result)
    res.json({ word, ...result })
  } catch (err) {
    console.error('单词查询失败:', err.message)
    const errResult = { error: err.message }
    cacheSet(word, errResult) // 错误也缓存，避免短时间内重复请求
    res.json({ word, ...errResult })
  } finally {
    pendingLookups.delete(word)
  }
})

async function doLookup(word) {
  const result = { phonetic_uk: '', phonetic_us: '', definitions: [], translation: '' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const url = `https://dict.youdao.com/result?word=${encodeURIComponent(word)}&lang=en`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      result.error = `Youdao returned ${response.status}`
      return result
    }

    const html = await response.text()
    const { uk, us } = extractYoudaoPhonetic(html)
    result.phonetic_uk = uk
    result.phonetic_us = us
    result.definitions = extractYoudaoDefs(html)

    if (!result.definitions.length) {
      result.translation = extractYoudaoTranslation(html)
    }

    return result
  } catch (err) {
    if (err.name === 'AbortError') {
      result.error = '请求超时，请稍后重试'
    } else {
      result.error = err.message
    }
    return result
  } finally {
    clearTimeout(timeout)
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

// 提取的 TTS 抓取函数，供 API 和预热共用
async function fetchTtsAudio(word, accent) {
  const type = accent === 'uk' ? 1 : 2
  const resp = await fetch(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`, { agent: ttsAgent })
  if (!resp.ok) throw new Error(`TTS fetch failed: ${resp.status}`)
  return Buffer.from(await resp.arrayBuffer())
}

function storeTtsCache(cacheKey, buf) {
  if (ttsCache.size >= TTS_CACHE_MAX) {
    const key = ttsCache.keys().next().value
    ttsCache.delete(key)
  }
  ttsCache.set(cacheKey, buf)
}

// 查词成功后后台预热 TTS 缓存，不阻塞响应
function warmupTts(word) {
  // 只对合理单词/短语预热（过长/含特殊字符跳过）
  if (!word || word.length > 50 || !/^[a-zA-Z\s'-]+$/.test(word)) return
  for (const accent of ['uk', 'us']) {
    const cacheKey = `${word}:${accent}`
    if (ttsCache.has(cacheKey) || pendingTts.has(cacheKey)) continue
    const fetchPromise = fetchTtsAudio(word, accent)
      .then((buf) => { storeTtsCache(cacheKey, buf); return buf })
      .catch(() => {})
    pendingTts.set(cacheKey, fetchPromise)
    fetchPromise.finally(() => pendingTts.delete(cacheKey))
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

// ===== 启动 Python GUI 脚本 =====
// 路径集中在这两个常量，换机只改这里；也可用环境变量覆盖（PYTHON_HOME / PYTHON_SCRIPT_DIR）
const PYTHON_HOME = process.env.PYTHON_HOME || 'D:\\PythonFiles\\.venv'
const PYTHON_SCRIPT_DIR = process.env.PYTHON_SCRIPT_DIR || 'D:\\PythonFiles\\Python'

app.post('/api/run-python', async (req, res) => {
  const { key } = req.body
  const SCRIPTS = {
    'clipboard_to_txt': path.join(PYTHON_SCRIPT_DIR, 'clipboard_to_txt.py'),
  }
  const scriptPath = SCRIPTS[key]
  if (!scriptPath) {
    return res.status(400).json({ error: `未知脚本: ${key}` })
  }
  const pythonBin = path.join(PYTHON_HOME, 'Scripts', 'pythonw.exe')
  // 换机后路径可能失效：先校验存在性，避免 spawn 静默失败（点了没反应）
  if (!existsSync(pythonBin)) {
    return res.status(500).json({ error: `Python 解释器不存在: ${pythonBin}（请检查 PYTHON_HOME）` })
  }
  if (!existsSync(scriptPath)) {
    return res.status(500).json({ error: `脚本文件不存在: ${scriptPath}（请把脚本放到该目录，或用 PYTHON_SCRIPT_DIR 指定）` })
  }
  const proc = spawn(pythonBin, [scriptPath], {
    cwd: PYTHON_SCRIPT_DIR,
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  res.json({ status: 'ok', message: '脚本已启动' })
})

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
  console.log(`📦 MySQL: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`)
})
