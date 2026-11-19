import crypto from 'node:crypto'
import express from 'express'
import {
  normalizeTtsText,
  readTtsDiskFile,
  readTtsDiskHas,
  readTtsDiskSize,
  readTtsKey,
  READ_TTS_RATE,
  READ_TTS_VOICES,
  writeTtsDiskFile,
} from './ttsCache.js'

// ===== 文件夹数据导入 / 导出（P0 + P1 + 笔记卡片收藏）=====
// 契约见 markdown/FOLDER_IMPORT_EXPORT.md：
// 纯 JSON、100 MB、folders + articles（含 notes/marks/type/note_favorites）
// + annotations / favorites / canvasStrokes（P1），
// 不导出回收站内容，导入固定 create-new 且 ID 全量重生成。

export const BUNDLE_FORMAT = 'language-learning/folder-bundle'
export const BUNDLE_VERSION = 2
export const SUPPORTED_BUNDLE_VERSIONS = [1, 2]
export const AUDIO_SIDECAR_FORMAT = 'language-learning/tts-audio-bundle'
export const AUDIO_SIDECAR_VERSION = 1
export const MAX_AUDIO_ITEMS = 20000 // 边车条目上限（5000 篇 × 4 段 × 3 音色留余量）
export const MAX_ARTICLES = 5000
export const MAX_FOLDERS = 2000
export const MAX_ANNOTATIONS = 50000
export const MAX_FAVORITES = MAX_ARTICLES       // 一篇文章最多一条收藏
export const MAX_CANVAS_STROKES = MAX_ARTICLES  // 一篇文章最多一条笔迹记录

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
// sentence 是历史遗留类型（前端已不再产生），仍允许回导旧包
const ANNOTATION_TYPES = new Set(['highlight', 'underline', 'sentence'])

function fail(message, status = 400) {
  const err = new Error(message)
  err.status = status
  return err
}

function pick(obj, keys) {
  const out = {}
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k)) continue
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]
  }
  return out
}

function parseMarks(value) {
  if (value == null || value === '') return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (_) {
    return {}
  }
}

function toDate(value) {
  if (!value) return new Date()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function str(value) {
  return typeof value === 'string' ? value : ''
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0
}

function parseStrokes(value) {
  // mysql2 对 JSON 列通常已反序列化；老数据也可能是 JSON 字符串
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : null
    } catch (_) {
      return null
    }
  }
  return null
}

// 笔记卡片收藏（articles.note_favorites，MEDIUMTEXT/JSON 数组，元素为内容拷贝 {english, chinese, vocabItems}）
function parseNoteFavorites(value) {
  if (Array.isArray(value)) return value
  if (value == null || value === '') return []
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

// 笔迹是自由 JSON，递归剔除原型污染键后再入库
function sanitizeJsonValue(value, depth = 0) {
  if (depth > 20) return null
  if (Array.isArray(value)) return value.map((v) => sanitizeJsonValue(v, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue
      out[k] = sanitizeJsonValue(value[k], depth + 1)
    }
    return out
  }
  return value
}

function validAnnotationShape(a) {
  return Boolean(
    a && typeof a === 'object' &&
    typeof a.id === 'string' && a.id &&
    typeof a.articleId === 'string' && a.articleId &&
    isNonNegativeInt(a.paragraphIndex) &&
    isNonNegativeInt(a.startOffset) &&
    isNonNegativeInt(a.endOffset) &&
    a.startOffset < a.endOffset &&
    typeof a.text === 'string' &&
    ANNOTATION_TYPES.has(a.type) &&
    typeof a.color === 'string' && a.color.length <= 20 &&
    typeof a.note === 'string'
  )
}

// 老库可能尚未建 favorites / canvas_strokes 表（其建表在各自 API 里惰性执行）：
// 缺表时按「无数据」处理，避免导出整体失败。
async function queryOptional(conn, sql, params) {
  try {
    const [rows] = await conn.query(sql, params)
    return rows
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return []
    throw err
  }
}

// ===== 导出：只读聚合 =====
// 按与后端清理 / 前端预热完全相同的规则，为导出文章生成音频清单（只列磁盘上真实存在的 key）。
// 规则：normalizeTtsText → '\n' 切段 → 丢纯空白行 → 三音色 × +0% → readTtsKey。
function buildAudioManifestForArticles(articles) {
  const files = []
  let missing = 0
  let bytes = 0
  for (const article of articles) {
    for (const [paraIndex, line] of normalizeTtsText(article.content).split('\n').entries()) {
      if (!line.trim()) continue
      for (const voice of READ_TTS_VOICES) {
        const key = readTtsKey(line, voice, READ_TTS_RATE)
        if (!readTtsDiskHas(key)) { missing++; continue }
        const size = readTtsDiskSize(key)
        bytes += size
        files.push({ key, articleId: article.id, paragraphIndex: paraIndex, voice, rate: READ_TTS_RATE, bytes: size })
      }
    }
  }
  return { files, missing, bytes }
}

export async function buildExport(pool, folderId) {
  const isRoot = !folderId || folderId === 'root' || folderId === 'null'

  const [allFolders] = await pool.query(
    'SELECT id, name, parent_id AS parentId, created_at AS createdAt FROM folders WHERE deleted_at IS NULL ORDER BY created_at ASC'
  )

  // 一次性拉取全部未删除文件夹，在内存里按 parentId 建索引后做 BFS，
  // 避免逐层递归查询；root 模式直接取全部。
  const childrenOf = new Map()
  for (const f of allFolders) {
    const key = f.parentId || null
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key).push(f)
  }

  let selected
  let sourceName = '全部文件夹'
  if (isRoot) {
    selected = allFolders
  } else {
    const target = allFolders.find((f) => f.id === folderId)
    if (!target) throw fail('文件夹不存在或已在回收站中', 404)
    sourceName = target.name
    const seen = new Set()
    const queue = [folderId]
    while (queue.length) {
      const cur = queue.shift()
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const child of childrenOf.get(cur) || []) queue.push(child.id)
    }
    selected = allFolders.filter((f) => seen.has(f.id))
  }

  const selectedIds = new Set(selected.map((f) => f.id))
  const folders = selected.map((f) => ({
    id: f.id,
    name: f.name,
    // 父文件夹不在导出集合内（例如父级已软删）时按顶层项处理
    parentId: f.parentId && selectedIds.has(f.parentId) ? f.parentId : null,
    createdAt: f.createdAt ? toDate(f.createdAt).toISOString() : null,
  }))

  let articles = []
  let skippedOrphans = 0
  let noteFavCount = 0
  if (selectedIds.size) {
    const ids = [...selectedIds]
    const placeholders = ids.map(() => '?').join(',')
    const [rows] = await pool.query(
      `SELECT id, title, content, folder_id AS folderId, notes, marks, type, note_favorites, created_at AS createdAt
       FROM articles WHERE deleted_at IS NULL AND folder_id IN (${placeholders})`,
      ids
    )
    articles = rows.map((r) => {
      const noteFavorites = parseNoteFavorites(r.note_favorites)
      noteFavCount += noteFavorites.length
      return {
        id: r.id,
        folderId: r.folderId,
        title: r.title,
        content: r.content == null ? '' : r.content, // 逐字保留，不做任何清洗
        notes: r.notes == null ? '' : r.notes,
        marks: parseMarks(r.marks),
        type: r.type == null ? '' : r.type,
        noteFavorites,
        createdAt: r.createdAt ? toDate(r.createdAt).toISOString() : null,
      }
    })
    if (isRoot) {
      const [cnt] = await pool.query(
        `SELECT COUNT(*) AS n FROM articles WHERE deleted_at IS NULL AND folder_id NOT IN (${placeholders})`,
        ids
      )
      skippedOrphans = cnt[0]?.n || 0
    }
  } else if (isRoot) {
    const [cnt] = await pool.query('SELECT COUNT(*) AS n FROM articles WHERE deleted_at IS NULL')
    skippedOrphans = cnt[0]?.n || 0
  }

  // ===== P1：文章附属数据（只取已导出文章，天然排除回收站文章与孤儿行）=====
  let annotations = []
  let favorites = []
  let canvasStrokes = []
  let skippedInvalidAnnotations = 0
  let skippedInvalidCanvasStrokes = 0
  if (articles.length) {
    const exportedArticleIds = new Set(articles.map((a) => a.id))
    const ids = [...exportedArticleIds]
    const placeholders = ids.map(() => '?').join(',')

    const annRows = await queryOptional(
      pool,
      `SELECT id, article_id AS articleId, paragraph_index AS paragraphIndex,
              start_offset AS startOffset, end_offset AS endOffset,
              text, type, color, note, created_at AS createdAt
       FROM annotations WHERE article_id IN (${placeholders})
       ORDER BY article_id ASC, paragraph_index ASC, start_offset ASC`,
      ids
    )
    for (const r of annRows) {
      const item = {
        id: r.id,
        articleId: r.articleId,
        paragraphIndex: r.paragraphIndex,
        startOffset: r.startOffset,
        endOffset: r.endOffset,
        text: r.text == null ? '' : r.text,
        type: r.type == null ? '' : r.type,
        color: r.color == null ? '' : r.color,
        note: r.note == null ? '' : r.note,
        createdAt: r.createdAt ? toDate(r.createdAt).toISOString() : null,
      }
      if (!exportedArticleIds.has(item.articleId)) continue
      if (!validAnnotationShape(item)) {
        skippedInvalidAnnotations++
        continue
      }
      annotations.push(item)
    }

    const favRows = await queryOptional(
      pool,
      `SELECT article_id AS articleId, created_at AS createdAt
       FROM favorites WHERE article_id IN (${placeholders}) ORDER BY created_at DESC`,
      ids
    )
    const seenFavorites = new Set()
    for (const r of favRows) {
      if (!exportedArticleIds.has(r.articleId) || seenFavorites.has(r.articleId)) continue
      seenFavorites.add(r.articleId)
      favorites.push({
        articleId: r.articleId,
        createdAt: r.createdAt ? toDate(r.createdAt).toISOString() : null,
      })
    }

    const strokeRows = await queryOptional(
      pool,
      `SELECT article_id AS articleId, strokes_data AS strokesData
       FROM canvas_strokes WHERE article_id IN (${placeholders})`,
      ids
    )
    const seenStrokes = new Set()
    for (const r of strokeRows) {
      if (!exportedArticleIds.has(r.articleId) || seenStrokes.has(r.articleId)) continue
      const strokes = parseStrokes(r.strokesData)
      if (strokes === null) {
        skippedInvalidCanvasStrokes++
        continue
      }
      seenStrokes.add(r.articleId)
      canvasStrokes.push({ articleId: r.articleId, strokes })
    }
  }

  const audio = buildAudioManifestForArticles(articles)

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      folderId: isRoot ? 'root' : folderId,
      folderName: sourceName,
      app: 'language-learning',
    },
    counts: {
      folders: folders.length,
      articles: articles.length,
      annotations: annotations.length,
      favorites: favorites.length,
      canvasStrokes: canvasStrokes.length,
      noteFavorites: noteFavCount,
      audioFiles: audio.files.length,
      audioBytes: audio.bytes,
    },
    audioManifest: {
      rate: READ_TTS_RATE,
      voices: [...READ_TTS_VOICES],
      files: audio.files,
      missing: audio.missing,
    },
    folders,
    articles,
    annotations,
    favorites,
    canvasStrokes,
    skippedOrphans, // 孤儿文章（folder 不存在/已删）未导出，仅计数提示
    skippedInvalidAnnotations, // 偏移/类型异常的批注跳过，保证导出包可回导
    skippedInvalidCanvasStrokes, // strokes_data 非数组的记录跳过
  }
}

// ===== 音频边车（P3，见 markdown/FOLDER_IMPORT_EXPORT.md §13）=====
// 只导出主包清单里列出的 key：从磁盘读 {audio, words} 原样打包，不改动 payload。
export function buildAudioSidecar(bundleSource, audioManifest, bundleExportedAt) {
  if (!audioManifest || !Array.isArray(audioManifest.files)) throw fail('数据包没有音频清单，无法生成音频边车')
  const audio = []
  let bytes = 0
  for (const entry of audioManifest.files) {
    const payload = readTtsDiskFile(entry.key)
    if (!payload || typeof payload.audio !== 'string' || !Array.isArray(payload.words)) continue
    audio.push({ key: entry.key, audio: payload.audio, words: payload.words })
    bytes += Buffer.byteLength(payload.audio, 'utf8')
  }
  return {
    format: AUDIO_SIDECAR_FORMAT,
    version: AUDIO_SIDECAR_VERSION,
    exportedAt: bundleExportedAt,
    source: { bundleExportedAt, folderId: bundleSource?.folderId || '' },
    audio,
    bytes,
  }
}

// 边车公共形状校验（format/version/数组/条数/每条 key·audio·words），返回清洗后的 audio。
// allowedKeys 为 null 时不校验白名单；否则每条 key 必须命中。denyMsg(i) 定制白名单拒绝文案。
function parseSidecarAudio(sidecar, allowedKeys, denyMsg) {
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) throw fail('音频边车内容不是有效对象')
  if (sidecar.format !== AUDIO_SIDECAR_FORMAT) throw fail('不是有效的音频边车文件（format 不匹配）')
  if (sidecar.version !== AUDIO_SIDECAR_VERSION) throw fail(`不支持的音频边车版本：${sidecar.version}`)
  if (!Array.isArray(sidecar.audio)) throw fail('音频边车缺少 audio 数组')
  if (sidecar.audio.length > MAX_AUDIO_ITEMS) throw fail(`音频条目超过上限 ${MAX_AUDIO_ITEMS}`)
  const audio = sidecar.audio.map((item, i) => {
    const o = pick(item, ['key', 'audio', 'words'])
    if (typeof o.key !== 'string' || !/^[0-9a-f]{64}$/i.test(o.key)) throw fail(`音频边车第 ${i + 1} 条 key 非法`)
    if (allowedKeys && !allowedKeys.has(o.key)) throw fail(denyMsg(i))
    if (typeof o.audio !== 'string' || !o.audio || o.audio.length > 1024 * 1024 * 4) throw fail(`音频边车第 ${i + 1} 条音频数据非法或过大`)
    if (!Array.isArray(o.words)) throw fail(`音频边车第 ${i + 1} 条词边界必须是数组`)
    o.words = o.words.map((w, j) => {
      const word = pick(w, ['text', 'offset', 'duration'])
      if (typeof word.text !== 'string' || !Number.isFinite(word.offset) || !Number.isFinite(word.duration)) {
        throw fail(`音频边车第 ${i + 1} 条第 ${j + 1} 个词边界非法`)
      }
      return word
    })
    return o
  })
  return { audio, count: audio.length, bytes: audio.reduce((s, a) => s + Buffer.byteLength(a.audio, 'utf8'), 0) }
}

// 随包导入校验：与主包 exportedAt 对齐 + 主包 audioManifest 白名单（签名/文案保持不变）。
export function validateAudioSidecar(sidecar, bundle) {
  // 先做基础形状判断，保证 format/version 不匹配时优先报对应错误（兼容既有测试与调用预期）
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) throw fail('音频边车内容不是有效对象')
  if (sidecar.format !== AUDIO_SIDECAR_FORMAT) throw fail('不是有效的音频边车文件（format 不匹配）')
  if (sidecar.version !== AUDIO_SIDECAR_VERSION) throw fail(`不支持的音频边车版本：${sidecar.version}`)
  if (!bundle?.exportedAt || sidecar.source?.bundleExportedAt !== bundle.exportedAt) {
    throw fail('音频边车与主包不匹配（导出时间不一致），请确认二者来自同一次导出')
  }
  const allowed = new Set((bundle.audioManifest?.files || []).map((f) => f.key))
  return parseSidecarAudio(sidecar, allowed, (i) => `音频边车第 ${i + 1} 条的 key 不在主包清单内，已拒绝`)
}

// 独立导入校验（文本已先导入、音频后补）：无主包对象，改为校验每条 key 命中
// 「当前库 live key 集合」（由调用方传入），保证落盘的音频对现有文章有用、防任意 key 落盘。
export function validateAudioSidecarForImport(sidecar, liveKeys) {
  const allowed = liveKeys instanceof Set ? liveKeys : new Set(liveKeys || [])
  return parseSidecarAudio(sidecar, allowed, (i) => `音频边车第 ${i + 1} 条的 key 与当前文章不匹配（正文未导入或已变更），已拒绝`)
}

// 落盘：必须在主数据 DB 事务【提交成功后】调用，避免回滚后留下孤儿缓存。
// 返回 { written, failed }，写失败的 key 只计数、不影响已提交的主数据。
export function writeAudioSidecar(sidecarAudio) {
  let written = 0
  let failed = 0
  for (const item of sidecarAudio || []) {
    if (writeTtsDiskFile(item.key, { audio: item.audio, words: item.words })) written++
    else failed++
  }
  return { written, failed }
}

// ===== 校验：返回清洗后的 bundle 与摘要 =====
export function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw fail('导入文件内容不是有效对象')
  if (bundle.format !== BUNDLE_FORMAT) throw fail('不是有效的文件夹数据包（format 不匹配）')
  if (!SUPPORTED_BUNDLE_VERSIONS.includes(bundle.version)) throw fail(`不支持的数据包版本：${bundle.version}（当前支持 v${SUPPORTED_BUNDLE_VERSIONS.join('/')}）`)
  if (!Array.isArray(bundle.folders)) throw fail('缺少 folders 数组')
  if (!Array.isArray(bundle.articles)) throw fail('缺少 articles 数组')
  // P0 包可能没有这三个数组，按空数组兼容
  const annotationsRaw = bundle.annotations ?? []
  const favoritesRaw = bundle.favorites ?? []
  const canvasStrokesRaw = bundle.canvasStrokes ?? []
  if (!Array.isArray(annotationsRaw)) throw fail('annotations 必须是数组')
  if (!Array.isArray(favoritesRaw)) throw fail('favorites 必须是数组')
  if (!Array.isArray(canvasStrokesRaw)) throw fail('canvasStrokes 必须是数组')
  if (bundle.folders.length > MAX_FOLDERS) throw fail(`文件夹数超过上限 ${MAX_FOLDERS}`)
  if (bundle.articles.length > MAX_ARTICLES) throw fail(`文章数超过上限 ${MAX_ARTICLES}`)
  if (annotationsRaw.length > MAX_ANNOTATIONS) throw fail(`批注数超过上限 ${MAX_ANNOTATIONS}`)
  if (favoritesRaw.length > MAX_FAVORITES) throw fail(`收藏数超过上限 ${MAX_FAVORITES}`)
  if (canvasStrokesRaw.length > MAX_CANVAS_STROKES) throw fail(`画布笔迹数超过上限 ${MAX_CANVAS_STROKES}`)

  const folders = bundle.folders.map((f, i) => {
    const o = pick(f, ['id', 'name', 'parentId', 'createdAt'])
    if (!o.id || typeof o.id !== 'string') throw fail(`第 ${i + 1} 个文件夹缺少 id`)
    if (typeof o.name !== 'string' || !o.name.trim()) throw fail(`文件夹「${o.id}」名称为空`)
    return {
      id: o.id,
      name: o.name,
      parentId: typeof o.parentId === 'string' && o.parentId ? o.parentId : null,
      createdAt: o.createdAt || null,
    }
  })
  const folderIds = new Set(folders.map((f) => f.id))
  if (folderIds.size !== folders.length) throw fail('文件夹 id 重复')
  for (const f of folders) {
    if (f.parentId && !folderIds.has(f.parentId)) throw fail(`文件夹「${f.name}」的 parentId 指向不存在的文件夹`)
  }

  const articleIds = new Set()
  const articles = bundle.articles.map((a, i) => {
    const o = pick(a, ['id', 'folderId', 'title', 'content', 'notes', 'marks', 'type', 'noteFavorites', 'createdAt'])
    if (!o.id || typeof o.id !== 'string') throw fail(`第 ${i + 1} 篇文章缺少 id`)
    if (articleIds.has(o.id)) throw fail(`文章 id 重复：${o.id}`)
    articleIds.add(o.id)
    if (!folderIds.has(o.folderId)) throw fail(`文章「${o.title || o.id}」的 folderId 不在包内`)
    if (o.content != null && typeof o.content !== 'string') throw fail(`文章「${o.title}」的 content 不是文本`)
    if (o.notes != null && typeof o.notes !== 'string') throw fail(`文章「${o.title}」的 notes 不是文本`)
    if (o.noteFavorites != null && !Array.isArray(o.noteFavorites)) throw fail(`文章「${o.title}」的 noteFavorites 必须是数组`)
    return {
      id: o.id,
      folderId: o.folderId,
      title: str(o.title),
      content: o.content == null ? '' : o.content,
      notes: o.notes == null ? '' : o.notes,
      marks: o.marks && typeof o.marks === 'object' && !Array.isArray(o.marks) ? o.marks : {},
      type: str(o.type),
      noteFavorites: Array.isArray(o.noteFavorites) ? o.noteFavorites : [],
      createdAt: o.createdAt || null,
    }
  })

  // ===== P1：附属数据白名单 + 引用完整性 =====
  const annotationIds = new Set()
  const annotations = annotationsRaw.map((n, i) => {
    const o = pick(n, ['id', 'articleId', 'paragraphIndex', 'startOffset', 'endOffset', 'text', 'type', 'color', 'note', 'createdAt'])
    if (!o.id || typeof o.id !== 'string') throw fail(`第 ${i + 1} 条批注缺少 id`)
    if (annotationIds.has(o.id)) throw fail(`批注 id 重复：${o.id}`)
    annotationIds.add(o.id)
    if (!articleIds.has(o.articleId)) throw fail(`第 ${i + 1} 条批注的 articleId 不在包内`)
    const item = {
      id: o.id,
      articleId: o.articleId,
      paragraphIndex: o.paragraphIndex,
      startOffset: o.startOffset,
      endOffset: o.endOffset,
      text: str(o.text),
      type: str(o.type),
      color: str(o.color),
      note: str(o.note),
      createdAt: o.createdAt || null,
    }
    if (
      !isNonNegativeInt(item.paragraphIndex) ||
      !isNonNegativeInt(item.startOffset) ||
      !isNonNegativeInt(item.endOffset) ||
      item.startOffset >= item.endOffset
    ) {
      throw fail(`第 ${i + 1} 条批注的段落/偏移必须是非负整数且 startOffset < endOffset`)
    }
    if (!ANNOTATION_TYPES.has(item.type)) throw fail(`第 ${i + 1} 条批注的 type 不支持：${item.type}`)
    if (item.color.length > 20) throw fail(`第 ${i + 1} 条批注的 color 过长`)
    return item
  })

  const seenFavorites = new Set()
  const favorites = []
  favoritesRaw.forEach((f, i) => {
    // 兼容 v1 早期写法：字符串即 articleId
    const o = typeof f === 'string' ? { articleId: f } : pick(f, ['articleId', 'createdAt'])
    if (!o.articleId || typeof o.articleId !== 'string') throw fail(`第 ${i + 1} 条收藏缺少 articleId`)
    if (!articleIds.has(o.articleId)) throw fail(`第 ${i + 1} 条收藏的 articleId 不在包内`)
    if (seenFavorites.has(o.articleId)) return
    seenFavorites.add(o.articleId)
    favorites.push({
      articleId: o.articleId,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : null,
    })
  })

  const seenStrokes = new Set()
  const canvasStrokes = []
  canvasStrokesRaw.forEach((s, i) => {
    const o = pick(s, ['articleId', 'strokes'])
    if (!o.articleId || typeof o.articleId !== 'string') throw fail(`第 ${i + 1} 条画布笔迹缺少 articleId`)
    if (!articleIds.has(o.articleId)) throw fail(`第 ${i + 1} 条画布笔迹的 articleId 不在包内`)
    if (!Array.isArray(o.strokes)) throw fail(`第 ${i + 1} 条画布笔迹的 strokes 必须是数组`)
    if (seenStrokes.has(o.articleId)) return // 一篇文章只保留一条笔迹记录
    seenStrokes.add(o.articleId)
    canvasStrokes.push({ articleId: o.articleId, strokes: sanitizeJsonValue(o.strokes) })
  })

  // 拓扑排序（父在前），顺便检测环
  const byId = new Map(folders.map((f) => [f.id, f]))
  const done = new Set()
  const visiting = new Set()
  const ordered = []
  function visit(f) {
    if (done.has(f.id)) return
    if (visiting.has(f.id)) throw fail('文件夹层级存在循环，无法导入')
    visiting.add(f.id)
    if (f.parentId) visit(byId.get(f.parentId))
    visiting.delete(f.id)
    done.add(f.id)
    ordered.push(f)
  }
  folders.forEach(visit)

  // v2 音频清单：可选字段，v1 包缺失按空处理；只做形状与条数校验，实际 key 白名单在边车校验时用
  let audioManifest = null
  if (bundle.audioManifest != null) {
    const am = bundle.audioManifest
    if (!am || typeof am !== 'object' || Array.isArray(am)) throw fail('audioManifest 必须是对象')
    if (!Array.isArray(am.files)) throw fail('audioManifest.files 必须是数组')
    if (am.files.length > MAX_AUDIO_ITEMS) throw fail(`音频清单条目超过上限 ${MAX_AUDIO_ITEMS}`)
    const audioFiles = am.files.map((f, i) => {
      const o = pick(f, ['key', 'articleId', 'paragraphIndex', 'voice', 'rate', 'bytes'])
      if (typeof o.key !== 'string' || !/^[0-9a-f]{64}$/i.test(o.key)) throw fail(`音频清单第 ${i + 1} 条 key 非法`)
      if (typeof o.voice !== 'string' || !o.voice) throw fail(`音频清单第 ${i + 1} 条 voice 非法`)
      return o
    })
    audioManifest = {
      rate: typeof am.rate === 'string' ? am.rate : READ_TTS_RATE,
      voices: Array.isArray(am.voices) ? am.voices.filter((v) => typeof v === 'string') : [...READ_TTS_VOICES],
      files: audioFiles,
      missing: Number.isInteger(am.missing) && am.missing >= 0 ? am.missing : 0,
    }
  }

  return {
    sanitized: {
      ...pick(bundle, ['format', 'version', 'exportedAt', 'source']),
      folders: ordered,
      articles,
      annotations,
      favorites,
      canvasStrokes,
      ...(audioManifest ? { audioManifest } : {}),
    },
    summary: {
      folders: folders.length,
      articles: articles.length,
      annotations: annotations.length,
      favorites: favorites.length,
      canvasStrokes: canvasStrokes.length,
      noteFavorites: articles.reduce((s, a) => s + (a.noteFavorites?.length || 0), 0),
      audioFiles: audioManifest?.files.length || 0,
      audioBytes: Number(bundle.counts?.audioBytes) || 0,
      audioMissing: audioManifest?.missing || 0,
      skippedOrphans: bundle.skippedOrphans || 0,
      skippedInvalidAnnotations: bundle.skippedInvalidAnnotations || 0,
      skippedInvalidCanvasStrokes: bundle.skippedInvalidCanvasStrokes || 0,
      sourceName: bundle.source?.folderName || '',
      sourceFolderId: bundle.source?.folderId || '',
    },
  }
}

// ===== 导入：在调用方给定的连接上执行（调用方负责 begin/commit/rollback）=====
export async function importBundle(conn, bundle, targetParentId) {
  let parentId = null
  if (targetParentId && targetParentId !== 'root' && targetParentId !== 'null') {
    const [rows] = await conn.query('SELECT id FROM folders WHERE id = ? AND deleted_at IS NULL', [targetParentId])
    if (!rows.length) throw fail('目标文件夹不存在或已在回收站中')
    parentId = targetParentId
  }

  // 全量重生成 ID：跨设备导入不会撞主键，重复导入也产生独立副本
  const folderIdMap = new Map(bundle.folders.map((f) => [f.id, crypto.randomUUID()]))
  const articleIdMap = new Map(bundle.articles.map((a) => [a.id, crypto.randomUUID()]))
  const annotations = bundle.annotations || []
  const favorites = bundle.favorites || []
  const canvasStrokes = bundle.canvasStrokes || []
  const annotationIdMap = new Map(annotations.map((n) => [n.id, crypto.randomUUID()]))

  for (const f of bundle.folders) {
    const newParent = f.parentId ? folderIdMap.get(f.parentId) : parentId
    await conn.query(
      'INSERT INTO folders (id, name, parent_id, created_at, deleted_at) VALUES (?, ?, ?, ?, NULL)',
      [folderIdMap.get(f.id), f.name, newParent, toDate(f.createdAt)]
    )
  }
  for (const a of bundle.articles) {
    await conn.query(
      `INSERT INTO articles (id, title, content, folder_id, notes, marks, type, note_favorites, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        articleIdMap.get(a.id),
        a.title,
        a.content,
        folderIdMap.get(a.folderId),
        a.notes,
        JSON.stringify(a.marks || {}),
        a.type || '',
        JSON.stringify(a.noteFavorites || []),
        toDate(a.createdAt),
      ]
    )
  }

  // 批注：偏移三元组原样保留，只重映射 articleId / 重生成自身 id
  for (const n of annotations) {
    await conn.query(
      `INSERT INTO annotations (id, article_id, paragraph_index, start_offset, end_offset, text, type, color, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        annotationIdMap.get(n.id),
        articleIdMap.get(n.articleId),
        n.paragraphIndex,
        n.startOffset,
        n.endOffset,
        n.text,
        n.type,
        n.color,
        n.note,
        toDate(n.createdAt),
      ]
    )
  }
  for (const f of favorites) {
    await conn.query('INSERT INTO favorites (article_id, created_at) VALUES (?, ?)', [
      articleIdMap.get(f.articleId),
      toDate(f.createdAt),
    ])
  }
  // canvas_strokes 无外键，必须显式按映射后的 articleId 插入
  for (const s of canvasStrokes) {
    await conn.query('INSERT INTO canvas_strokes (article_id, strokes_data) VALUES (?, ?)', [
      articleIdMap.get(s.articleId),
      JSON.stringify(s.strokes),
    ])
  }

  const roots = bundle.folders.filter((f) => !f.parentId).map((f) => ({
    id: folderIdMap.get(f.id),
    name: f.name,
  }))
  return {
    folderCount: bundle.folders.length,
    articleCount: bundle.articles.length,
    annotationCount: annotations.length,
    favoriteCount: favorites.length,
    canvasStrokeCount: canvasStrokes.length,
    noteFavoriteCount: bundle.articles.reduce((s, a) => s + (a.noteFavorites?.length || 0), 0),
    roots,
    folderIds: [...folderIdMap.values()],
    articleIds: [...articleIdMap.values()],
  }
}

// ===== 路由：必须注册在全局 express.json({limit:'2mb'}) 之前 =====

// favorites / canvas_strokes 原本由各自 API 惰性建表，直接导入时可能不存在。
// DDL 在 MySQL 会触发隐式提交，所以必须在 beginTransaction 之外、且只执行一次。
let bundleTablesReady = null
function ensureBundleTables(pool) {
  if (!bundleTablesReady) {
    bundleTablesReady = (async () => {
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
      // 与 server/index.js 的 _ensureCanvasTable 保持一致：不加外键
      await pool.query(`
        CREATE TABLE IF NOT EXISTS canvas_strokes (
          article_id VARCHAR(64) PRIMARY KEY,
          strokes_data JSON NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `)
    })().catch((err) => {
      bundleTablesReady = null
      throw err
    })
  }
  return bundleTablesReady
}

export function createImportRouter(pool) {
  const router = express.Router()
  router.use(express.json({ limit: '100mb' }))

  router.post('/validate', (req, res) => {
    try {
      const { bundle } = req.body || {}
      const { summary } = validateBundle(bundle)
      res.json({ status: 'ok', data: summary })
    } catch (err) {
      res.status(err.status || 400).json({ status: 'error', message: err.message })
    }
  })

  router.post('/', async (req, res) => {
    let conn = null
    try {
      await ensureBundleTables(pool)
      conn = await pool.getConnection()
      const { bundle, audioSidecar, targetParentId } = req.body || {}
      const { sanitized } = validateBundle(bundle)
      await conn.beginTransaction()
      const result = await importBundle(conn, sanitized, targetParentId)
      await conn.commit()
      // 音频边车：必须在主数据提交成功后处理；校验 / 写盘失败不影响已提交的业务数据。
      result.audioWritten = 0
      result.audioFailed = 0
      if (audioSidecar) {
        try {
          const { audio } = validateAudioSidecar(audioSidecar, sanitized)
          Object.assign(result, writeAudioSidecar(audio))
        } catch (err) {
          result.audioError = err.message
        }
      }
      res.json({ status: 'ok', data: result })
    } catch (err) {
      if (conn) {
        try { await conn.rollback() } catch (_) { /* 忽略 */ }
      }
      res.status(err.status || 500).json({ status: 'error', message: err.message })
    } finally {
      if (conn) conn.release()
    }
  })

  return router
}
