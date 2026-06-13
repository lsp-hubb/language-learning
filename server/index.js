import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import crypto from 'node:crypto'
import pool from './db.js'

const app = express()
const PORT = process.env.SERVER_PORT || 3000

app.use(cors())
app.use(express.json())

// ===== 一次性访问验证码（每次重启生成新码） =====
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}
const ACCESS_CODE = generateCode()

console.log('')
console.log('  ╔══════════════════════════════╗')
console.log(`  ║  🔑  验证码: ${ACCESS_CODE}       ║`)
console.log('  ╚══════════════════════════════╝')
console.log('')
console.log(`  ${ACCESS_CODE}`)
console.log('')
console.log('')

// 验证访问码
app.post('/api/verify-code', (req, res) => {
  if (req.body.code === ACCESS_CODE) {
    res.json({ ok: true })
  } else {
    res.status(403).json({ ok: false, message: '验证码错误' })
  }
})

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
    // 迁移旧表
    try { await pool.query('ALTER TABLE articles ADD COLUMN content TEXT') } catch (_) {}
    try { await pool.query('ALTER TABLE articles DROP COLUMN subtitle') } catch (_) {}
    try { await pool.query('ALTER TABLE articles DROP COLUMN journal_name') } catch (_) {}
    try { await pool.query('ALTER TABLE articles DROP COLUMN publish_date') } catch (_) {}
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
    res.json({ status: 'ok', message: '数据库初始化成功' })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

// ===== 获取所有文件夹 =====
app.get('/api/folders', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, parent_id AS parentId, created_at AS createdAt FROM folders ORDER BY created_at ASC'
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

// ===== 删除文件夹（递归） =====
app.delete('/api/folders/:id', async (req, res) => {
  const folderId = req.params.id
  try {
    // 递归查找所有子文件夹 ID
    const allIds = await collectDescendantIds(folderId)
    allIds.push(folderId)

    if (allIds.length > 0) {
      const placeholders = allIds.map(() => '?').join(',')
      await pool.query(`DELETE FROM folders WHERE id IN (${placeholders})`, allIds)
    }
    res.json({ status: 'ok', message: '删除成功' })
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

// ===== 外刊文章 API =====
// 获取单篇文章
app.get('/api/article/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, content, folder_id AS folderId, created_at AS createdAt FROM articles WHERE id = ?',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ status: 'error', message: '文章不存在' })
    res.json({ status: 'ok', data: rows[0] })
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
  const { title, content, folderId } = req.body
  if (!title || !title.trim()) {
    return res.status(400).json({ status: 'error', message: '文章标题不能为空' })
  }
  if (!folderId) {
    return res.status(400).json({ status: 'error', message: '所属文件夹不能为空' })
  }

  const id = crypto.randomUUID()
  try {
    await pool.query(
      'INSERT INTO articles (id, title, content, folder_id) VALUES (?, ?, ?, ?)',
      [id, title.trim(), content || '', folderId]
    )
    res.json({
      status: 'ok',
      data: {
        id,
        title: title.trim(),
        content: content || '',
        folderId,
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
  const { title, content } = req.body
  try {
    const sets = []
    const vals = []
    if (title !== undefined) { sets.push('title = ?'); vals.push(title.trim()) }
    if (content !== undefined) { sets.push('content = ?'); vals.push(content || '') }
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
    // 调试日志
    console.log('[suggest] keyword=%s response=%j', keyword, json)
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

// ===== 健康检查 =====
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok')
    res.json({ status: 'ok', message: 'MySQL 连接成功', data: rows })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
  console.log(`📦 MySQL: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`)
})
