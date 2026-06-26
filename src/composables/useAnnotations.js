import { ref, computed, nextTick } from 'vue'
import { fetchAnnotations, createAnnotation as apiCreateAnnotation, updateAnnotation, deleteAnnotation as apiDeleteAnnotation } from '@/api'

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

  let annotHoverTimer = null
  let annotLeaveTimer = null
  let annotToolbarTimer = null

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
    await Promise.all(['uk', 'us'].map(async (accent) => {
      try {
        const resp = await fetch(ttsUrl(word, accent))
        if (!resp.ok) return
        const blob = await resp.blob()
        annotAudioCache[accent] = URL.createObjectURL(blob)
      } catch {}
    }))
  }

  function playAnnotAudio(accent) {
    const url = annotAudioCache[accent]
    if (url) new Audio(url).play().catch(() => {})
  }

  // ===== 数据加载 =====
  async function loadAnnotations() {
    try {
      const res = await fetchAnnotations(route.params.id)
      annotations.value = res.data || []
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

    let absoluteStart = 0
    const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT, null, false)
    let textNode = walker.nextNode()
    while (textNode) {
      if (textNode === range.startContainer) { absoluteStart += range.startOffset; break }
      absoluteStart += textNode.textContent.length
      textNode = walker.nextNode()
    }

    const matchStart = paraText.indexOf(text, absoluteStart)
    if (matchStart < 0) {
      const fallback = paraText.indexOf(text)
      if (fallback < 0) return null
      return { paragraphIndex: paraIndex, startOffset: fallback, endOffset: fallback + text.length, text }
    }
    return { paragraphIndex: paraIndex, startOffset: matchStart, endOffset: matchStart + text.length, text }
  }

  function expandRangeToWords() {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const text = sel.toString()
    if (text.length < 2 || !/\S\s+\S/.test(text)) return
    const range = sel.getRangeAt(0)
    let node = range.startContainer
    let offset = range.startOffset
    if (node.nodeType === Node.TEXT_NODE) {
      while (offset > 0 && !/\s/.test(node.textContent[offset - 1])) offset--
      range.setStart(node, offset)
    }
    node = range.endContainer
    offset = range.endOffset
    if (node.nodeType === Node.TEXT_NODE) {
      while (offset < node.textContent.length && !/\s/.test(node.textContent[offset])) offset++
      range.setEnd(node, offset)
    }
    sel.removeAllRanges()
    sel.addRange(range)
  }

  // ===== 段落 + 批注渲染片段 =====
  function buildParagraphSegments(paragraphs) {
    return paragraphs.value.map((text, paraIdx) => {
      const anns = annotations.value
        .filter((a) => a.paragraphIndex === paraIdx)
        .sort((a, b) => a.startOffset - b.startOffset)
      if (!anns.length) return [{ type: 'text', text }]
      const segments = []
      let cursor = 0
      for (const ann of anns) {
        if (ann.startOffset > cursor) segments.push({ type: 'text', text: text.slice(cursor, ann.startOffset) })
        segments.push({ type: 'annotation', text: text.slice(ann.startOffset, ann.endOffset), annotation: ann })
        cursor = Math.max(cursor, ann.endOffset)
      }
      if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) })
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
  async function createAnnotation(type, color = '#FFEB3B', autoFill = false, note = null, showCard = true) {
    if (!pendingSelection.value) return
    const sel = pendingSelection.value
    const articleId = route.params.id
    const overlaps = annotations.value.some((a) => a.paragraphIndex === sel.paragraphIndex && a.startOffset < sel.endOffset && a.endOffset > sel.startOffset)
    if (overlaps) { annotToolbarVisible.value = false; pendingSelection.value = null; return }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const newAnn = {
      id, articleId, paragraphIndex: sel.paragraphIndex, startOffset: sel.startOffset,
      endOffset: sel.endOffset, text: sel.text, type, color,
      note: note !== null ? note : (() => { if (!autoFill) return ''; const n = buildNoteFromLookup(); if (!n) pendingNoteFill.value = id; return n })(),
      createdAt: new Date().toISOString(),
    }
    annotations.value.push(newAnn)
    annotToolbarVisible.value = false
    if (!autoFill) closeWordCard()
    pendingSelection.value = null
    window.getSelection().removeAllRanges()
    await apiCreateAnnotation(newAnn)
    if (showCard) {
      immediateEdit.value = !autoFill
      setTimeout(() => { showAnnotCardForAnnotation(newAnn) }, 100)
    }
  }

  // ===== 工具栏 =====
  function onMouseUp(e, paragraphs) {
    expandRangeToWords()
    if (!e.target.closest('.annotated')) onTextSelection(e.clientX, e.clientY)
    clearTimeout(annotToolbarTimer)
    annotToolbarTimer = setTimeout(() => {
      const offsets = getSelectionOffsets(paragraphs)
      if (!offsets || offsets.text.length < 1) { annotToolbarVisible.value = false; return }
      if (annotations.value.some((a) => a.paragraphIndex === offsets.paragraphIndex && a.startOffset < offsets.endOffset && a.endOffset > offsets.startOffset)) {
        annotToolbarVisible.value = false; return
      }
      pendingSelection.value = offsets
      lastSelection.value = offsets
      annotToolbarPos.value = { x: e.clientX, y: e.clientY - 24 }
      annotToolbarVisible.value = true
    }, 0)
  }

  function hideAnnotToolbar() { annotToolbarVisible.value = false; pendingSelection.value = null }

  // ===== 批注卡片 =====
  function onAnnotMouseEnter(event, annotation) {
    clearTimeout(annotLeaveTimer); clearTimeout(annotHoverTimer)
    // 提取干净的单词用于发音
    let word = annotation.text?.trim().toLowerCase() || ''
    const punc = '.,;:!?"\'，。！？；：、·…`'
    while (punc.includes(word[0])) word = word.slice(1).trim()
    while (punc.includes(word[word.length - 1])) word = word.slice(0, -1).trim()
    const isSingleWord = /^[a-zA-Z]+(?:-[a-zA-Z]+)?$/.test(word) && word.length <= 30
    annotHoverTimer = setTimeout(() => {
      if (activeAnnotation.value === annotation && annotCardVisible.value) return
      annotCardVisible.value = false
      nextTick(() => { activeAnnotation.value = annotation; const r = event.target.getBoundingClientRect(); annotCardPos.value = { x: r.left, y: r.bottom }; annotCardVisible.value = true })
      // 悬停批注文本时自动发音（仅单个单词）
      if (isSingleWord) {
        preloadAnnotAudio(word).then(() => playAnnotAudio('uk'))
      }
    }, 200)
  }

  function onAnnotMouseLeave() {
    clearTimeout(annotHoverTimer)
    annotLeaveTimer = setTimeout(() => { if (!isMouseOnCard.value && !isAnnotEditing.value) { annotCardVisible.value = false; activeAnnotation.value = null } }, 150)
  }

  function onAnnotCardMouseEnter() { isMouseOnCard.value = true; clearTimeout(annotLeaveTimer) }

  function onAnnotCardMouseLeave() {
    isMouseOnCard.value = false; if (isAnnotEditing.value) return
    clearTimeout(annotLeaveTimer)
    annotLeaveTimer = setTimeout(() => { annotCardVisible.value = false; activeAnnotation.value = null }, 150)
  }

  function onAnnotClick(event, annotation) {
    clearTimeout(annotHoverTimer); clearTimeout(annotLeaveTimer)
    activeAnnotation.value = annotation; const r = event.target.getBoundingClientRect()
    annotCardPos.value = { x: r.left, y: r.bottom }; annotCardVisible.value = true
  }

  function showAnnotCardForAnnotation(annotation) {
    const spans = document.querySelectorAll('.annotated')
    for (const span of spans) {
      if (span.dataset.annotId === annotation.id) {
        activeAnnotation.value = annotation; const r = span.getBoundingClientRect()
        annotCardPos.value = { x: r.left, y: r.bottom }; annotCardVisible.value = true; break
      }
    }
  }

  function closeAnnotationCard() { annotCardVisible.value = false; activeAnnotation.value = null; isMouseOnCard.value = false; isAnnotEditing.value = false }

  async function saveAnnotationNote(annotationId, note) {
    const ann = annotations.value.find((a) => a.id === annotationId)
    if (ann) { ann.note = note; await updateAnnotation(annotationId, note) }
  }

  async function deleteAnnotation(annotationId) {
    annotations.value = annotations.value.filter((a) => a.id !== annotationId)
    annotCardVisible.value = false; activeAnnotation.value = null
    await apiDeleteAnnotation(annotationId)
  }

  // ===== 全局关闭 =====
  function onGlobalClick(e) {
    if (annotToolbarVisible.value) {
      if (!e.target.closest('.annot-toolbar') && !e.target.closest('.annot-card')) hideAnnotToolbar()
    }
    if (annotCardVisible.value) {
      if (!e.target.closest('.annotated') && !e.target.closest('.annot-card')) closeAnnotationCard()
    }
  }

  function cleanupAnnotTimers() {
    clearTimeout(annotHoverTimer); clearTimeout(annotLeaveTimer); clearTimeout(annotToolbarTimer)
    for (const key of Object.keys(annotAudioCache)) {
      URL.revokeObjectURL(annotAudioCache[key])
      delete annotAudioCache[key]
    }
  }

  return {
    annotations, annotToolbarVisible, annotToolbarPos, annotCardVisible, annotCardPos,
    activeAnnotation, immediateEdit, isMouseOnCard, isAnnotEditing,
    pendingSelection, lastSelection, pendingNoteFill,
    loadAnnotations, getSelectionOffsets, expandRangeToWords,
    buildParagraphSegments,
    buildNoteFromLookup, createAnnotation, onMouseUp, hideAnnotToolbar,
    onAnnotMouseEnter, onAnnotMouseLeave, onAnnotCardMouseEnter, onAnnotCardMouseLeave,
    onAnnotClick, showAnnotCardForAnnotation, closeAnnotationCard,
    saveAnnotationNote, deleteAnnotation, onGlobalClick,
    cleanupAnnotTimers,
  }
}
