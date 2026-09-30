// 考研试题页的正文标记（高亮 / 下划线）——只做标记，不写注释、不弹批注卡片、不弹提示。
// 与普通文章共用同一张 annotations 表与同一套 API，快捷键一致：
//   E / W        标记开关（已有同类型标记覆盖选区则取消）
//   Delete / Backspace  删除：优先删鼠标悬停的那条标记，否则删与选区重叠的标记
//
// 坐标约定（考研页没有「段落」概念，只有 passageParts 切出的文本片段）：
//   paragraphIndex = 题型序号 * 1000 + 文本片段序号（passageParts 中 type === 'text' 的第几个）
//   startOffset / endOffset = 该片段纯文本内的字符偏移
// 把题型编进 paragraphIndex 的原因：一篇真题可含多个题型，各题型正文不同，
// 而 annotations 表没有题型列，用这种方式隔离可免改后端。
import { ref, computed } from 'vue'
import {
  fetchAnnotations,
  createAnnotation as apiCreate,
  deleteAnnotation as apiDelete,
} from '@/api'
import { EXAM_TYPES } from './parseCloze'

const TYPE_SPAN = 1000

// 与普通文章保持一致的取色
const ANNOT_DEF = {
  highlight: { color: '#FFEB3B', label: '高亮' },
  underline: { color: '#e74c3c', label: '下划线' },
}
// 删除优先级与普通文章一致：先删高亮，再删下划线
const P_MAP = { highlight: 3, underline: 2 }

function newId() {
  // 与 useAnnotations 同款：不依赖 crypto.randomUUID（局域网 http 下不可用）
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function typeIndexOf(typeValue) {
  const i = EXAM_TYPES.findIndex((t) => t.value === typeValue)
  return i < 0 ? 0 : i
}
function encodePara(typeValue, fragIdx) {
  return typeIndexOf(typeValue) * TYPE_SPAN + fragIdx
}
function decodePara(pi) {
  return { typeIdx: Math.floor(pi / TYPE_SPAN), fragIdx: pi % TYPE_SPAN }
}

export function useKaoyanAnnotations(articleId, currentType) {
  const annotations = ref([])

  // 只取当前题型的批注，按文本片段序号归组：{ [fragIdx]: [ann, ...] }
  const byFragment = computed(() => {
    const ti = typeIndexOf(currentType.value)
    const map = {}
    for (const a of annotations.value) {
      const d = decodePara(a.paragraphIndex)
      if (d.typeIdx !== ti) continue
      ;(map[d.fragIdx] || (map[d.fragIdx] = [])).push(a)
    }
    return map
  })

  async function load() {
    try {
      const res = await fetchAnnotations(articleId.value)
      annotations.value = res?.data || []
    } catch (e) {
      annotations.value = []
    }
  }

  // 把一个文本片段按覆盖它的批注切成若干渲染段，两种标记可叠加。
  // 每段带 start / end / key，供悬停定位（Delete 删除哪一条）用。
  function segmentsFor(fragIdx, text) {
    const anns = byFragment.value[fragIdx] || []
    if (!anns.length)
      return [{ text, highlight: false, underline: false, start: 0, end: text.length }]
    const pts = new Set([0, text.length])
    for (const a of anns) {
      if (a.startOffset > 0 && a.startOffset < text.length) pts.add(a.startOffset)
      if (a.endOffset > 0 && a.endOffset < text.length) pts.add(a.endOffset)
    }
    const sorted = [...pts].sort((x, y) => x - y)
    const out = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const s = sorted[i]
      const e = sorted[i + 1]
      if (e <= s) continue
      out.push({
        text: text.slice(s, e),
        highlight: anns.some(
          (a) => a.type === 'highlight' && a.startOffset <= s && a.endOffset >= e,
        ),
        underline: anns.some(
          (a) => a.type === 'underline' && a.startOffset <= s && a.endOffset >= e,
        ),
        start: s,
        end: e,
      })
    }
    return out.length
      ? out
      : [{ text, highlight: false, underline: false, start: 0, end: text.length }]
  }

  // 选区归属的文本片段（.ky-seg）；落在空格槽里或跨片段时返回 null
  function ownerSeg(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement
    return el?.closest?.('.ky-seg') || null
  }

  // 量出选区在当前片段内的偏移；跨片段（中间隔着空格槽）不支持
  function readSelection() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    const segEl = ownerSeg(range.startContainer)
    if (!segEl) return null
    if (ownerSeg(range.endContainer) !== segEl) return null // 跨片段
    const fragIdx = Number(segEl.dataset.fi)
    if (!Number.isFinite(fragIdx)) return null

    const measure = (node, offset) => {
      const r = document.createRange()
      r.setStart(segEl, 0)
      r.setEnd(node, offset)
      return r.toString().length
    }
    let s = Math.min(
      measure(range.startContainer, range.startOffset),
      measure(range.endContainer, range.endOffset),
    )
    let e = Math.max(
      measure(range.startContainer, range.startOffset),
      measure(range.endContainer, range.endOffset),
    )

    // 去掉首尾空白/换行（拖动选择常带进来），否则标记范围会多出看不见的字符
    const full = segEl.textContent || ''
    while (s < e && /\s/.test(full[s])) s++
    while (e > s && /\s/.test(full[e - 1])) e--
    if (e <= s) return null
    return { fragIdx, start: s, end: e, text: full.slice(s, e) }
  }

  async function drop(targets) {
    const ids = new Set(targets.map((a) => a.id))
    annotations.value = annotations.value.filter((a) => !ids.has(a.id))
    try {
      await Promise.all([...ids].map((id) => apiDelete(id)))
    } catch (e) {
      await load() // 回滚到服务端真实状态
    }
  }

  // E / W：标记开关。已有同类型标记覆盖选区则取消，否则新建（不写 note、不弹提示）
  async function toggle(type) {
    if (!ANNOT_DEF[type]) return
    const sel = readSelection()
    if (!sel) return // 跨空格 / 无选区：静默忽略
    const existing = (byFragment.value[sel.fragIdx] || []).find(
      (a) => a.type === type && a.startOffset < sel.end && a.endOffset > sel.start,
    )
    if (existing) {
      await drop([existing])
      return
    }
    const ann = {
      id: newId(),
      articleId: articleId.value,
      paragraphIndex: encodePara(currentType.value, sel.fragIdx),
      startOffset: sel.start,
      endOffset: sel.end,
      text: sel.text,
      type,
      color: ANNOT_DEF[type].color,
      note: '', // 只做标记，不写注释
      createdAt: new Date().toISOString(),
    }
    annotations.value = [...annotations.value, ann]
    window.getSelection()?.removeAllRanges()
    try {
      await apiCreate(ann)
    } catch (e) {
      await load()
    }
  }

  // Delete / Backspace：删除鼠标悬停的那条标记（覆盖该段且优先级最高的那条）。
  // 段上叠了两种标记时，连按两次即可依次删掉 —— 与普通文章「删高亮后再删下划线」一致。
  function removeAt(fragIdx, start, end) {
    const covering = (byFragment.value[fragIdx] || []).filter(
      (a) => a.startOffset <= start && a.endOffset >= end,
    )
    if (!covering.length) return false
    covering.sort((a, b) => (P_MAP[b.type] || 0) - (P_MAP[a.type] || 0))
    drop([covering[0]])
    return true
  }

  // 没有悬停时退一步：删除与当前选区重叠的标记
  function removeSelection() {
    const sel = readSelection()
    if (!sel) return false
    const overlapping = (byFragment.value[sel.fragIdx] || []).filter(
      (a) => a.startOffset < sel.end && a.endOffset > sel.start,
    )
    if (!overlapping.length) return false
    drop(overlapping)
    window.getSelection()?.removeAllRanges()
    return true
  }

  return { annotations, byFragment, segmentsFor, load, toggle, removeAt, removeSelection }
}
