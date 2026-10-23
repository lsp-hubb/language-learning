import { ref, computed, nextTick } from 'vue'
import {
  fetchAnnotations,
  createAnnotation as apiCreateAnnotation,
  updateAnnotation,
  deleteAnnotation as apiDeleteAnnotation,
} from '@/api'
import { normalizeQuotes } from '@/utils/normalizeQuotes'

export function useAnnotations(route, wordResult, closeWordCard, onTextSelection) {
  const annotations = ref([])
  const annotToolbarVisible = ref(false)
  const annotToolbarPos = ref({ x: 0, y: 0 })
  const annotCardVisible = ref(false)
  const annotCardPos = ref({ x: 0, y: 0 })
  const activeAnnotation = ref(null)
  const immediateEdit = ref(false)
  const isMouseOnCard = ref(false)
  const isAnnotEditing = ref(false)
  const pendingSelection = ref(null)
  const lastSelection = ref(null)
  const pendingNoteFill = ref(null)
  // 卡片定位范围：新建批注后弹出卡片时，限定在哪个容器内按 data-annot-id 查找
  // （笔记侧新建时设为 '.note-root'，让卡片出现在笔记里刚标注的词旁；一次性，用完即清）
  const annotCardScope = ref(null)

  let annotHoverTimer = null
  let annotLeaveTimer = null
  let annotToolbarTimer = null

  // 最近新建的批注 id：叠加处的「主批注」让位给它（正文与笔记侧共用）。
  // 否则「在高亮中标下划线」新建的是下划线，而主批注按 highlight > underline 仍是高亮，
  // 卡片交互就永远轮不到刚建的那条。
  const recentAnnotId = ref('')
  let recentTimer = null
  function markRecent(id, ms = 8000) {
    recentAnnotId.value = id || ''
    clearTimeout(recentTimer)
    if (!id) return
    recentTimer = setTimeout(() => {
      recentAnnotId.value = ''
    }, ms)
  }

  // 卡片锁：新建标注弹出卡片后的短时间内，不允许被「悬停 200ms 切换」抢走。
  // 原因：一处叠了两种标注时主批注按 highlight > underline 取，
  // 「在高亮中标下划线」新建的是下划线，但鼠标停在英文行上会在 200ms 后
  // 把卡片切回主批注（高亮），表现为刚标注的下划线看不到自己的注释框。
  let cardLockUntil = 0
  function lockCard(ms = 1200) {
    cardLockUntil = Date.now() + ms
  }

  // ===== 批注悬停发音 =====
  const annotAudioCache = {}
  let annotLastWord = ''

  function ttsUrl(word, accent) {
    return `/api/tts?word=${encodeURIComponent(word)}&accent=${accent}`
  }

  async function preloadAnnotAudio(word) {
    if (!word || word === annotLastWord) return
    for (const key of Object.keys(annotAudioCache)) {
      URL.revokeObjectURL(annotAudioCache[key])
      delete annotAudioCache[key]
    }
    annotLastWord = word
    await Promise.all(
      ['uk', 'us'].map(async (accent) => {
        try {
          const resp = await fetch(ttsUrl(word, accent))
          if (!resp.ok) return
          const blob = await resp.blob()
          annotAudioCache[accent] = URL.createObjectURL(blob)
        } catch {}
      }),
    )
  }

  function playAnnotAudio(accent) {
    const url = annotAudioCache[accent]
    if (url) new Audio(url).play().catch(() => {})
  }

  // ===== 数据加载 =====
  async function loadAnnotations() {
    try {
      const res = await fetchAnnotations(route.params.id)
      const list = res.data || []
      // 已入库迁移：旧批注的 note 若含弯引号，归一后静默回写（不弹提示、不影响交互）
      const cleanedList = list.map((a) => {
        if (typeof a.note !== 'string' || !a.note) return a
        const cleaned = normalizeQuotes(a.note)
        if (cleaned === a.note) return a
        updateAnnotation(a.id, cleaned).catch(() => {})
        return { ...a, note: cleaned }
      })
      annotations.value = cleanedList
    } catch {
      annotations.value = []
    }
  }

  // ===== 偏移量计算 =====
  function getSelectionOffsets(paragraphs) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    const text = selection.toString().trim()
    if (!text) return null

    let node = selection.anchorNode
    while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode
    const paraEl = node?.closest('.article-para')
    if (!paraEl) return null

    const paraEls = document.querySelectorAll('.reader-body .article-para')
    const paraIndex = Array.from(paraEls).indexOf(paraEl)
    const paraText = paragraphs.value[paraIndex]
    if (!paraText) return null

    // 用 Range 直接量出「段落开头 → 选区起点」的文本长度，得到起点在段落纯文本中的偏移。
    // 原实现手写 walker 累加：一旦 startContainer 不在遍历序列中（起点是元素节点、
    // 或选区落在批注 span 的边界），循环不会 break，偏移会静默累加到段落末尾，
    // 导致 indexOf(text, absoluteStart) 失败并回退到「该段首次出现处」，
    // 表现为高亮落在别处 / 选中的词看起来没生效。
    let absoluteStart = 0
    try {
      const pre = document.createRange()
      pre.selectNodeContents(paraEl)
      pre.setEnd(range.startContainer, range.startOffset)
      absoluteStart = pre.toString().length
    } catch {
      // 兜底：保留原 walker 累加逻辑
      const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT, null, false)
      let textNode = walker.nextNode()
      while (textNode) {
        if (textNode === range.startContainer) {
          absoluteStart += range.startOffset
          break
        }
        absoluteStart += textNode.textContent.length
        textNode = walker.nextNode()
      }
    }

    const matchStart = paraText.indexOf(text, absoluteStart)
    if (matchStart < 0) {
      const fallback = paraText.indexOf(text)
      if (fallback < 0) return null
      return {
        paragraphIndex: paraIndex,
        startOffset: fallback,
        endOffset: fallback + text.length,
        text,
      }
    }
    return {
      paragraphIndex: paraIndex,
      startOffset: matchStart,
      endOffset: matchStart + text.length,
      text,
    }
  }

  // 词边界：空白，或连字符/破折号（- – —）。这些符号处应断开，
  // 避免把 power-hungry、him—and、beings—powerless 误判为一个单词。
  const WORD_BREAK_RE = /[\s\-–—]/

  function expandRangeToWords() {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const text = sel.toString()
    if (text.length < 2 || !/\S\s+\S/.test(text)) return
    const range = sel.getRangeAt(0)
    let node = range.startContainer
    let offset = range.startOffset
    if (node.nodeType === Node.TEXT_NODE) {
      while (offset > 0 && !WORD_BREAK_RE.test(node.textContent[offset - 1])) offset--
      range.setStart(node, offset)
    }
    node = range.endContainer
    offset = range.endOffset
    if (node.nodeType === Node.TEXT_NODE) {
      while (offset < node.textContent.length && !WORD_BREAK_RE.test(node.textContent[offset]))
        offset++
      range.setEnd(node, offset)
    }
    sel.removeAllRanges()
    sel.addRange(range)
  }

  // ===== 段落 + 批注渲染片段 =====
  function buildParagraphSegments(paragraphs) {
    const pMap = { highlight: 3, underline: 2 }
    return paragraphs.value.map((text, paraIdx) => {
      const anns = annotations.value.filter((a) => a.paragraphIndex === paraIdx)
      if (!anns.length) return [{ type: 'text', text, start: 0, key: 't0' }]
      // 收集所有边界点，按位置切分，支持嵌套
      const pts = new Set([0, text.length])
      for (const a of anns) {
        pts.add(a.startOffset)
        pts.add(a.endOffset)
      }
      const sorted = [...pts].sort((a, b) => a - b)
      const segments = []
      for (let i = 0; i < sorted.length - 1; i++) {
        const start = sorted[i],
          end = sorted[i + 1]
        if (start === end) continue
        const covering = anns.filter((a) => a.startOffset <= start && a.endOffset >= end)
        if (!covering.length) {
          segments.push({ type: 'text', text: text.slice(start, end), start, key: 't' + start })
        } else {
          // 主批注：最近新建的那条优先，否则按 highlight > underline
          covering.sort((a, b) => pMap[b.type] - pMap[a.type])
          const recent = recentAnnotId.value && covering.find((a) => a.id === recentAnnotId.value)
          // key 编码覆盖本段的全部批注 id：叠加 / 删除批注会改变覆盖集合，
          // 从而生成新 key 强制重建 DOM，避免沿用旧节点导致样式不刷新（要刷新页面才显示）
          const key = 'a' + start + '_' + covering.map((a) => a.id).join(',')
          segments.push({
            type: 'annotation',
            text: text.slice(start, end),
            annotation: recent || covering[0],
            annotations: covering,
            start,
            key,
          })
        }
      }
      return segments
    })
  }

  // ===== 注释文本构建 =====
  function buildNoteFromLookup() {
    if (!wordResult.value.word) return ''
    const r = wordResult.value
    const isLong = r.word.split(/\s+/).length > 5
    const lines = isLong ? [] : [r.word]
    if (r.phonetic_uk) lines.push(`英 ${r.phonetic_uk}`)
    if (r.phonetic_us) lines.push(`美 ${r.phonetic_us}`)
    if (r.definitions?.length) {
      for (const d of r.definitions) {
        lines.push(d.part_of_speech ? `${d.part_of_speech} ${d.translation}` : d.translation)
      }
    } else if (r.translation) {
      lines.push(r.translation)
    }
    return lines.join('\n')
  }

  // ===== 创建批注 =====
  async function createAnnotation(
    type,
    color = '#FFEB3B',
    autoFill = false,
    note = null,
    showCard = true,
  ) {
    if (!pendingSelection.value) return
    const sel = pendingSelection.value
    const articleId = route.params.id
    // 同种类型不可重叠，不同类型可自由叠加
    if (
      annotations.value.some(
        (a) =>
          a.type === type &&
          a.paragraphIndex === sel.paragraphIndex &&
          a.startOffset < sel.endOffset &&
          a.endOffset > sel.startOffset,
      )
    ) {
      annotToolbarVisible.value = false
      pendingSelection.value = null
      return
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const newAnn = {
      id,
      articleId,
      paragraphIndex: sel.paragraphIndex,
      startOffset: sel.startOffset,
      endOffset: sel.endOffset,
      text: sel.text,
      type,
      color,
      // 输入侧清洗：批注内容落库前归一弯引号（弯单引号 → '，弯双引号 → "）
      note: normalizeQuotes(
        note !== null
          ? note
          : (() => {
              if (!autoFill) return ''
              const n = buildNoteFromLookup()
              if (!n) pendingNoteFill.value = id
              return n
            })(),
      ),
      createdAt: new Date().toISOString(),
    }
    annotations.value.push(newAnn)
    markRecent(newAnn.id)
    annotToolbarVisible.value = false
    if (!autoFill) closeWordCard()
    pendingSelection.value = null
    window.getSelection().removeAllRanges()
    await apiCreateAnnotation(newAnn)
    if (showCard) {
      immediateEdit.value = !autoFill
      setTimeout(() => {
        showAnnotCardForAnnotation(newAnn)
      }, 100)
    }
  }

  // ===== 工具栏 =====
  function onMouseUp(e, paragraphs) {
    // 笔记中的选中不要扩展到单词边界（笔记面板根为 .note-root，不含 .side-panel，需一并排除）
    if (!e.target.closest('.side-panel') && !e.target.closest('.note-root')) expandRangeToWords()
    if (!e.target.closest('.annotated')) onTextSelection(e.clientX, e.clientY)
    clearTimeout(annotToolbarTimer)
    annotToolbarTimer = setTimeout(() => {
      const offsets = getSelectionOffsets(paragraphs)
      if (!offsets || offsets.text.length < 1) {
        annotToolbarVisible.value = false
        return
      }
      // 注意：此处不再因"选区与已有批注重叠"而隐藏工具栏。
      // 规则是"同种类型不可重叠、不同类型可叠加"（在 createAnnotation 中判断），
      // 故必须允许在已有下划线/高亮之上选中单词再叠加另一种批注，
      // 否则在下划线短语内右键无法弹出浮动批注栏来标注单词。
      pendingSelection.value = offsets
      lastSelection.value = offsets
      annotToolbarPos.value = { x: e.clientX, y: e.clientY - 24 }
      // 仅右键（e.button === 2）弹出浮动批注栏；左键选中只记录选区、不自动弹出（若已开则收起）
      if (e.button === 2) {
        annotToolbarVisible.value = true
      } else {
        annotToolbarVisible.value = false
      }
    }, 0)
  }

  function hideAnnotToolbar() {
    annotToolbarVisible.value = false
    pendingSelection.value = null
  }

  // ===== 批注卡片 =====
  function onAnnotMouseEnter(event, annotation) {
    clearTimeout(annotLeaveTimer)
    clearTimeout(annotHoverTimer)
    // 提取干净的单词用于发音
    let word = annotation.text?.trim().toLowerCase() || ''
    const punc = '.,;:!?"\'，。！？；：、·…`'
    while (punc.includes(word[0])) word = word.slice(1).trim()
    while (punc.includes(word[word.length - 1])) word = word.slice(0, -1).trim()
    const isSingleWord = /^[a-zA-Z]+(?:-[a-zA-Z]+)?$/.test(word) && word.length <= 30
    annotHoverTimer = setTimeout(() => {
      if (Date.now() < cardLockUntil) return // 新建标注刚弹出的卡片，不抢
      if (isAnnotEditing.value) return // 正在编辑注释，不抢
      if (activeAnnotation.value === annotation && annotCardVisible.value) return
      annotCardVisible.value = false
      nextTick(() => {
        activeAnnotation.value = annotation
        const r = event.target.getBoundingClientRect()
        annotCardPos.value = { x: r.left, y: r.bottom }
        annotCardVisible.value = true
      })
      // 悬停批注文本时自动发音（仅单个单词）
      if (isSingleWord) {
        preloadAnnotAudio(word).then(() => playAnnotAudio('uk'))
      }
    }, 200)
  }

  function closeCardIfIdle() {
    if (!isMouseOnCard.value && !isAnnotEditing.value) {
      annotCardVisible.value = false
      activeAnnotation.value = null
    }
  }

  function onAnnotMouseLeave() {
    clearTimeout(annotHoverTimer)
    annotLeaveTimer = setTimeout(() => {
      if (Date.now() < cardLockUntil) {
        // 锁未到期：等它到期再补判一次。否则鼠标已移开、不会再有第二次 leave，
        // 卡片就永久停在屏幕上不消失。
        annotLeaveTimer = setTimeout(closeCardIfIdle, Math.max(30, cardLockUntil - Date.now() + 30))
        return
      }
      closeCardIfIdle()
    }, 150)
  }

  function onAnnotCardMouseEnter() {
    isMouseOnCard.value = true
    clearTimeout(annotLeaveTimer)
  }

  function onAnnotCardMouseLeave() {
    isMouseOnCard.value = false
    if (isAnnotEditing.value) return
    clearTimeout(annotLeaveTimer)
    annotLeaveTimer = setTimeout(() => {
      annotCardVisible.value = false
      activeAnnotation.value = null
    }, 150)
  }

  function onAnnotClick(event, annotation) {
    clearTimeout(annotHoverTimer)
    clearTimeout(annotLeaveTimer)
    // 再点当前已打开的那条标注 → 收起卡片（否则点单词只会「重新显示」，
    // 表现为笔记里想关卡片却关不掉 / 卡住；点别的标注仍正常切换）
    if (
      annotCardVisible.value &&
      activeAnnotation.value &&
      activeAnnotation.value.id === annotation.id
    ) {
      closeAnnotationCard()
      return
    }
    activeAnnotation.value = annotation
    const r = event.target.getBoundingClientRect()
    annotCardPos.value = { x: r.left, y: r.bottom }
    annotCardVisible.value = true
  }

  function showAnnotCardForAnnotation(annotation) {
    lockCard()
    const scope = annotCardScope.value
    annotCardScope.value = null // 一次性，用完即清
    // data-annot-id 在叠加处是「空格分隔的多个 id」，不能用全等比较
    const match = (list) =>
      Array.from(list).find((s) => (s.dataset.annotId || '').split(/\s+/).includes(annotation.id))
    // 优先在指定范围内定位（如笔记面板），范围内没有（笔记未显示该批注）再回退到全局（正文）
    let target = match(document.querySelectorAll(scope ? `${scope} .annotated` : '.annotated'))
    if (!target && scope) target = match(document.querySelectorAll('.annotated'))
    if (!target) return
    activeAnnotation.value = annotation
    const r = target.getBoundingClientRect()
    annotCardPos.value = { x: r.left, y: r.bottom }
    annotCardVisible.value = true
  }

  function closeAnnotationCard() {
    annotCardVisible.value = false
    activeAnnotation.value = null
    isMouseOnCard.value = false
    isAnnotEditing.value = false
  }

  async function saveAnnotationNote(annotationId, note) {
    const ann = annotations.value.find((a) => a.id === annotationId)
    // 输入侧清洗：编辑批注内容同样归一弯引号后再落库
    const cleaned = normalizeQuotes(note)
    if (ann) {
      ann.note = cleaned
      await updateAnnotation(annotationId, cleaned)
    }
  }

  async function deleteAnnotation(annotationId) {
    const deleted = annotations.value.find((a) => a.id === annotationId)
    annotations.value = annotations.value.filter((a) => a.id !== annotationId)
    annotCardVisible.value = false
    activeAnnotation.value = null
    await apiDeleteAnnotation(annotationId)
    // 嵌套连续删除：自动弹出同位置的下一个标注
    if (deleted) {
      nextTick(() => {
        const remaining = annotations.value.filter(
          (a) =>
            a.paragraphIndex === deleted.paragraphIndex &&
            a.startOffset <= deleted.startOffset &&
            a.endOffset >= deleted.endOffset,
        )
        const p = { highlight: 3, underline: 2 }
        remaining.sort((a, b) => p[b.type] - p[a.type])
        const top = remaining[0]
        if (top) {
          // ~= 匹配空格分隔的某一个 id：叠加处该属性含多条批注的 id。
          // 先限定正文：笔记英文行里也有同名镜像标注，全局查找可能把卡片定位到笔记侧
          const el =
            document.querySelector(`.reader-body [data-annot-id~="${top.id}"]`) ||
            document.querySelector(`[data-annot-id~="${top.id}"]`)
          if (el) {
            const r = el.getBoundingClientRect()
            annotCardPos.value = { x: r.left, y: r.bottom }
            activeAnnotation.value = top
            annotCardVisible.value = true
          }
        }
      })
    }
  }

  // ===== 全局关闭 =====
  function onGlobalClick(e) {
    if (annotToolbarVisible.value) {
      if (!e.target.closest('.annot-toolbar') && !e.target.closest('.annot-card'))
        hideAnnotToolbar()
    }
    if (annotCardVisible.value) {
      if (!e.target.closest('.annotated') && !e.target.closest('.annot-card')) closeAnnotationCard()
    }
  }

  function cleanupAnnotTimers() {
    clearTimeout(annotHoverTimer)
    clearTimeout(annotLeaveTimer)
    clearTimeout(annotToolbarTimer)
    clearTimeout(recentTimer)
    for (const key of Object.keys(annotAudioCache)) {
      URL.revokeObjectURL(annotAudioCache[key])
      delete annotAudioCache[key]
    }
  }

  return {
    annotations,
    annotToolbarVisible,
    annotToolbarPos,
    annotCardVisible,
    annotCardPos,
    activeAnnotation,
    immediateEdit,
    isMouseOnCard,
    isAnnotEditing,
    pendingSelection,
    lastSelection,
    pendingNoteFill,
    annotCardScope,
    recentAnnotId,
    loadAnnotations,
    getSelectionOffsets,
    expandRangeToWords,
    buildParagraphSegments,
    buildNoteFromLookup,
    createAnnotation,
    onMouseUp,
    hideAnnotToolbar,
    onAnnotMouseEnter,
    onAnnotMouseLeave,
    onAnnotCardMouseEnter,
    onAnnotCardMouseLeave,
    onAnnotClick,
    showAnnotCardForAnnotation,
    closeAnnotationCard,
    saveAnnotationNote,
    deleteAnnotation,
    onGlobalClick,
    lockCard,
    cleanupAnnotTimers,
  }
}
