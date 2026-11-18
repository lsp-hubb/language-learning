import { onUnmounted, ref } from 'vue'
import { locateTtsWords } from '@/utils/selectionText'

// 逐段朗读（Edge TTS）：服务端合成并缓存音频，前端一次下载、本地 <audio> 播放，
// 用音频播放进度 currentTime 驱动词级高亮（Edge TTS 的 WordBoundary 时间戳）。
// 与 Web Speech API 不同，音频是真实 mp3 blob，可缓存、可跳转、无在线播放延迟。

// 可选朗读音色（Edge TTS ShortName，已实测存在）。默认 Andrew，与旧版一致。
export const READ_VOICES = [
  { id: 'en-US-AndrewNeural', name: 'Andrew', desc: 'Andrew · 美式英语（男）' },
  { id: 'en-US-EmmaMultilingualNeural', name: 'Emma', desc: 'Emma · 美式英语（女）' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', desc: 'Ryan · 英式英语（男）' },
]
export const DEFAULT_VOICE = READ_VOICES[0].id
const VOICE_STORAGE_KEY = 'read-aloud-voice'

function loadSavedVoice() {
  try {
    const saved = localStorage.getItem(VOICE_STORAGE_KEY)
    if (saved && READ_VOICES.some((v) => v.id === saved)) return saved
  } catch {}
  return DEFAULT_VOICE
}

// 当前音色：模块级响应式，跨组件实例共享；持久化到 localStorage，刷新后保持。
export const currentVoice = ref(loadSavedVoice())
export function setVoice(id) {
  if (!READ_VOICES.some((v) => v.id === id)) return
  currentVoice.value = id
  try { localStorage.setItem(VOICE_STORAGE_KEY, id) } catch {}
}
export function voiceName(id) {
  return READ_VOICES.find((v) => v.id === id)?.name || id
}

// 模块级缓存：跨组件实例 / 切文章复用，避免重复下载同一段。
// key = 音色 + NUL + 文本（多音色必须分开，否则切音色会串味）；value = { url, timedWords, cache }。
const cache = new Map()
const CACHE_MAX = 120
const pending = new Map()

function cacheKey(text, voice) {
  return `${voice}\u0000${text}`
}

function storeCache(key, payload) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    const old = cache.get(oldest)
    if (old?.url) URL.revokeObjectURL(old.url)
    cache.delete(oldest)
  }
  cache.set(key, payload)
}

// 把接口返回的 { audio(base64), words } 解成播放载荷。
function decodePayload(data, fullText, startOffset) {
  const bin = atob(data.audio || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'audio/mpeg' })
  const timedWords = locateTtsWords(data.words || [], fullText, startOffset)
  return { url: URL.createObjectURL(blob), timedWords, cache: data.cache }
}

// 取（或合成）一段音频。text 为送合成的完整文本（整段）；voice 为音色 ShortName。
// fullText/startOffset 用于把 TTS 词文本定位回【原段】全文坐标（高亮用）。
// force=true（编辑后全量重下）跳过缓存、请求后端强制重合成并覆盖。
async function prepare(text, fullText, startOffset = 0, voice = currentVoice.value, force = false) {
  const key = cacheKey(text, voice)
  if (!force) {
    if (cache.has(key)) return cache.get(key)
    if (pending.has(key)) {
      // 可能正在被单段合成或被批量预取填充。等待其完成；两种 task 成功后都会把
      // payload 写进 cache，故统一从 cache 取（不直接用 await 的返回值——批量/单段返回值语义不同）。
      await pending.get(key).catch(() => {})
      if (cache.has(key)) return cache.get(key)
      // 进行中的合成失败且未落缓存 → 落到下面自行单段重试
    }
  }

  const task = (async () => {
    const resp = await fetch('/api/tts/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, force }),
    })
    if (!resp.ok) {
      let msg = `TTS 请求失败 (${resp.status})`
      try { msg = (await resp.json()).error || msg } catch {}
      throw new Error(msg)
    }
    const data = await resp.json()
    if (data.error) throw new Error(data.error)
    const payload = decodePayload(data, fullText, startOffset)
    // force 覆盖旧缓存：先 revoke 旧 objectURL 避免内存泄漏
    if (force && cache.has(key)) {
      const old = cache.get(key)
      if (old?.url) URL.revokeObjectURL(old.url)
    }
    storeCache(key, payload)
    return payload
  })()

  pending.set(key, task)
  try {
    return await task
  } finally {
    pending.delete(key)
  }
}

// 批量并发预取：一次请求把多段送后端并发合成，结果全部写入缓存。
// items: [{ text, fullText, startOffset }]。返回 Promise 在全部段落落定后 resolve（永不 reject）。
// 已在缓存 / 正在合成的段跳过。每段用【独立】的 pending promise 占位：随后对某段的 prepare()
// 只等自己那一段完成，不会被同批其它段拖住；prepare 命中后从 cache 取载荷（批量 task 本身无返回值）。
// 单段失败只清该段占位，prepare 会因 cache 未命中而自行单段重试。
// force=true（编辑后全量重下）跳过缓存/去重过滤，请求后端强制重合成并覆盖。
function prefetch(items, voice = currentVoice.value, force = false) {
  const need = (items || []).filter(
    (it) => it?.text && (force || (!cache.has(cacheKey(it.text, voice)) && !pending.has(cacheKey(it.text, voice)))),
  )
  if (!need.length) return Promise.resolve()

  const entries = need.map((it) => {
    let done
    const promise = new Promise((resolve) => { done = resolve })
    return { it, key: cacheKey(it.text, voice), promise, done }
  })
  entries.forEach((e) => pending.set(e.key, e.promise))

  // 落定：成功写缓存、失败仅清占位（均 resolve 该段 promise，故 prepare 不会挂住）
  function settle(entry, payload) {
    if (payload) {
      if (force && cache.has(entry.key)) {
        const old = cache.get(entry.key)
        if (old?.url) URL.revokeObjectURL(old.url)
      }
      storeCache(entry.key, payload)
    }
    if (pending.get(entry.key) === entry.promise) pending.delete(entry.key)
    entry.done(payload || null)
  }

  ;(async () => {
    let results = {}
    try {
      const resp = await fetch('/api/tts/read/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: need.map((it, i) => ({ id: i, text: it.text })), voice, force }),
      })
      if (!resp.ok) throw new Error(`TTS 批量预取失败 (${resp.status})`)
      results = (await resp.json()).results || {}
    } catch {
      entries.forEach((e) => settle(e, null))
      return
    }
    entries.forEach((e, i) => {
      const r = results[i]
      settle(e, r && !r.error && r.audio ? decodePayload(r, e.it.fullText, e.it.startOffset) : null)
    })
  })()

  return Promise.all(entries.map((e) => e.promise))
}

// 清空朗读缓存（可选只清某音色），释放 objectURL。编辑文章后调用，配合 force 预热重新下载。
// 注意：不清除进行中的 pending（让在飞请求自然落定），仅清已缓存载荷。
export function clearReadCache(voice) {
  for (const [key, payload] of cache) {
    if (voice && !key.startsWith(`${voice}\u0000`)) continue
    if (payload?.url) URL.revokeObjectURL(payload.url)
    cache.delete(key)
  }
}

export function useReadAloud() {
  let audio = null
  let rafId = 0
  let onWordCb = null
  let onEndCb = null
  let onStartCb = null
  let current = null // 当前 { timedWords, lastIdx }

  function tick() {
    if (!audio || !current) return
    const t = audio.currentTime * 1000 // ms
    const words = current.timedWords
    // Edge TTS 的 offset 单调不减；找最后一个已开始的词
    let idx = -1
    for (let k = 0; k < words.length; k++) {
      if (words[k].timeMs <= t + 40) idx = k // +40ms 容差，提前一点点亮，观感更跟音频
      else break
    }
    if (idx >= 0 && idx !== current.lastIdx) {
      current.lastIdx = idx
      onWordCb?.(words[idx])
    }
    if (!audio.paused && !audio.ended) {
      rafId = requestAnimationFrame(tick)
    }
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    if (audio) {
      audio.pause()
      audio.onended = null
      audio.onerror = null
      audio = null
    }
    current = null
    onWordCb = null
    onEndCb = null
    onStartCb = null
  }

  // 播放一段。payload 来自 prepare()。onWord({start,end,timeMs,durMs,text}) 逐词回调。
  // startMs：从段内指定时间开始播（选中位置跳转用，见 ArticleReader）；onStart：真正开播回调（用于延后清选区）。
  function play(payload, { onWord, onEnd, onStart, startMs = 0 } = {}) {
    stop()
    onWordCb = onWord || null
    onEndCb = onEnd || null
    onStartCb = onStart || null
    current = { timedWords: payload.timedWords, lastIdx: -1 }
    audio = new Audio(payload.url)
    // 注意：stop() 会把 onEndCb 清空，必须先存下回调再 stop，否则全文朗读的 onDone
    // （串下一段）永远不会触发——表现为"第一段读完就停"，错误回调也丢失。
    audio.onended = () => {
      const cb = onEndCb
      stop()
      cb?.()
    }
    audio.onerror = () => {
      const err = new Error('音频播放失败')
      const cb = onEndCb
      stop()
      cb?.(err)
    }
    // 跳转播放：metadata 就绪后跳到选中词的时间戳（过早设 currentTime 无效）。
    // 加极小的预回退（60ms）让选中词的 onWord 必定被触发一次，否则 currentTime 正好落在
    // 词边界时 tick 的 <= 判定可能跳过该词的高亮。
    if (startMs > 0) {
      audio.onloadedmetadata = () => {
        try { audio.currentTime = Math.max(0, startMs - 60) / 1000 } catch {}
      }
    }
    audio.play().then(() => {
      const cb = onStartCb
      cb?.() // 真正开播后才清选区：合成等待期间保留选中背景
      rafId = requestAnimationFrame(tick)
    }).catch((err) => {
      const cb = onEndCb
      stop()
      cb?.(err)
    })
  }

  onUnmounted(stop)

  return { prepare, prefetch, play, stop }
}
