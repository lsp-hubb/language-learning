<script setup>
import { ref, inject, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  paraIndex: { type: Number, default: -1 },
  notes: { type: Object, default: () => ({}) },
})

const saveParagraphNote = inject('saveParagraphNote')

const isEditing = ref(false)
const saving = ref(false)
const editorEl = ref(null)

// 纯文本 + 偏移标记（不污染文本）
const localText = ref('')
const localMarks = ref([])

watch(() => props.paraIndex, (idx) => {
  if (idx >= 0) {
    localText.value = props.notes[idx] || ''
    localMarks.value = props.notes._marks?.[idx] || []
  } else {
    localText.value = ''
    localMarks.value = []
  }
  nextTick(() => {
    if (localText.value) {
      isEditing.value = false
    } else {
      isEditing.value = true
      nextTick(() => { focusEditor() })
    }
  })
}, { immediate: true })

function focusEditor() {
  if (!editorEl.value) return
  editorEl.value.innerHTML = ''
  editorEl.value.focus()
  const sel = window.getSelection()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(editorEl.value)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

// ===== 阅读模式：按标记切分文本片段 =====
const textEntries = computed(() => localText.value.split('\n\n').filter(l => l.trim()))

const entrySegments = computed(() => {
  return textEntries.value.map((text, ei) => {
    const entryMarks = localMarks.value.filter(m => m.entryIndex === ei)
    if (!entryMarks.length) return [{ type: 'text', text }]
    const pts = new Set([0, text.length])
    for (const m of entryMarks) { pts.add(m.start); pts.add(m.end) }
    const sorted = [...pts].sort((a, b) => a - b)
    const segs = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const s = sorted[i], e = sorted[i + 1]
      const txt = text.slice(s, e)
      const matched = entryMarks.find(m => m.start <= s && m.end >= e)
      segs.push(matched ? { type: 'mark', text: txt, color: matched.color } : { type: 'text', text: txt })
    }
    return segs
  })
})

// ===== 编辑模式 =====
function startEdit() {
  isEditing.value = true
  nextTick(() => {
    if (editorEl.value) {
      editorEl.value.innerHTML = formatContent(localText.value)
      editorEl.value.focus()
    }
  })
}

function formatContent(text) {
  if (!text) return ''
  return text.split('\n\n').filter(l => l.trim()).map(entry =>
    `<p>${entry.replace(/\n/g, '<br>')}</p>`
  ).join('\n')
}

function getContent() {
  if (!editorEl.value) return ''
  const raw = editorEl.value.innerHTML
  const text = raw
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p>/gi, '')
    .replace(/<\/?div>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\u2018\u2019]|&lsquo;|&rsquo;|&#8216;|&#8217;/g, "'")
    .replace(/[\u201C\u201D]|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
  return text.split('\n\n').filter(l => l.trim()).join('\n\n')
}

async function onSave() {
  const idx = props.paraIndex
  if (idx < 0) return
  saving.value = true
  localText.value = getContent()
  const fn = saveParagraphNote?.current
  if (fn) {
    try { await fn(idx, localText.value, localMarks.value) }
    catch (err) { console.error('保存笔记失败:', err) }
  }
  saving.value = false
  isEditing.value = false
}

// 鼠标松开时自动展开选中到 （...） 内的 ；分段
function onMouseUpInViewer() {
  if (isEditing.value || props.paraIndex < 0) return
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return
  const el = sel.anchorNode?.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode
  if (!el || !el.closest('.note-viewer-wrap')) return
  const paraEl = el.closest('.note-para')
  if (!paraEl) return
  const paraIdx = Array.from(paraEl.parentElement?.children || []).indexOf(paraEl)
  if (paraIdx < 0) return
  const entryText = textEntries.value[paraIdx]
  if (!entryText) return
  // 计算选中偏移
  let absStart = 0
  const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT, null, false)
  let tn, range = sel.getRangeAt(0)
  while ((tn = walker.nextNode())) {
    if (tn === range.startContainer) { absStart += range.startOffset; break }
    absStart += tn.textContent.length
  }
  if (!tn) return
  const s = absStart, e = Math.min(absStart + sel.toString().length, entryText.length)
  if (s >= e) return
  // 找到 （...） 内的 ；分段
  const po = entryText.lastIndexOf('（', s)
  const pc = entryText.indexOf('）', e)
  if (po < 0 || pc <= po) return
  const segs = entryText.slice(po + 1, pc).split('；')
  let acc = po + 1
  for (const seg of segs) {
    const segEnd = acc + seg.length
    if (s < segEnd) {
      if (s === acc && e === segEnd) return
      // 展开选中到该段（用新 range）
      const nr = document.createRange()
      const w2 = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT, null, false)
      let n2, o2 = 0
      while ((n2 = w2.nextNode())) {
        const l = n2.textContent.length
        if (o2 + l > acc) {
          const startOff = acc - o2
          const endOff = Math.min(startOff + (segEnd - acc), l)
          nr.setStart(n2, startOff)
          nr.setEnd(n2, endOff)
          if (endOff < l) break  // 在本节点内结束
          o2 += l
          while ((n2 = w2.nextNode())) {
            const l2 = n2.textContent.length
            if (o2 + l2 >= segEnd) { nr.setEnd(n2, segEnd - o2); break }
            o2 += l2
          }
          break
        }
        o2 += l
      }
      if (nr.startContainer && nr.endContainer) {
        sel.removeAllRanges()
        sel.addRange(nr)
      }
      break
    }
    acc = segEnd + 1
  }
}

// ===== r 键：切换选中文本标红（用偏移标记，不修改文本）=====
function onGlobalKeydown(e) {
  if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (isEditing.value || props.paraIndex < 0) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return
    const el = sel.anchorNode?.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode
    if (!el || !el.closest('.note-viewer-wrap')) return
    e.preventDefault()
    e.stopImmediatePropagation()
    // 从选区所在的条目文本中计算偏移
    const paraEl = el.closest('.note-para')
    if (!paraEl) return
    const paraIdx = Array.from(paraEl.parentElement?.children || []).indexOf(paraEl)
    if (paraIdx < 0) return
    const entryText = textEntries.value[paraIdx]
    if (!entryText) return
    // 用 TreeWalker 计算实际偏移
    let absoluteStart = 0
    const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT, null, false)
    let textNode, range = sel.getRangeAt(0)
    while ((textNode = walker.nextNode())) {
      if (textNode === range.startContainer) { absoluteStart += range.startOffset; break }
      absoluteStart += textNode.textContent.length
    }
    if (!textNode) return
    let start = absoluteStart
    let end = Math.min(start + sel.toString().length, entryText.length)
    if (start >= end) return
    // 自动定位到最近的 （...） 内，按 ；分段
    const parenOpen = entryText.lastIndexOf('（', start)
    const parenClose = entryText.indexOf('）', end)
    if (parenOpen >= 0 && parenClose > parenOpen) {
      const segs = entryText.slice(parenOpen + 1, parenClose).split('；')
      let accumulated = parenOpen + 1
      for (const seg of segs) {
        const segEnd = accumulated + seg.length
        if (start < segEnd) {
          start = accumulated
          end = segEnd
          break
        }
        accumulated = segEnd + 1
      }
      // 把浏览器的视觉选中也扩展到该段
      const newRange = document.createRange()
      const walker2 = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT, null, false)
      let n2, offset2 = 0
      while ((n2 = walker2.nextNode())) {
        const len = n2.textContent.length
        if (offset2 + len > start) {
          newRange.setStart(n2, start - offset2)
          // 找到 end 位置
          offset2 += len
          while ((n2 = walker2.nextNode())) {
            const l2 = n2.textContent.length
            if (offset2 + l2 >= end) {
              newRange.setEnd(n2, end - offset2)
              break
            }
            offset2 += l2
          }
          break
        }
        offset2 += len
      }
      if (newRange.startContainer && newRange.endContainer) {
        sel.removeAllRanges()
        sel.addRange(newRange)
      }
    }
    if (start >= end) return
    // 切换标记：选中如有重叠标记则全部清除，否则新增
    const marksInEntry = localMarks.value.filter(m => m.entryIndex === paraIdx)
    const hasOverlap = marksInEntry.some(m => start < m.end && end > m.start)
    if (hasOverlap) {
      localMarks.value = localMarks.value.filter(m => !(m.entryIndex === paraIdx && start < m.end && end > m.start))
    } else {
      localMarks.value = [...localMarks.value, { entryIndex: paraIdx, start, end, color: 'red' }]
    }
    // 保存
    const fn = saveParagraphNote?.current
    if (fn) fn(props.paraIndex, localText.value, localMarks.value)
  }
}

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('mouseup', onMouseUpInViewer)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('mouseup', onMouseUpInViewer)
})
</script>

<template>
  <div class="note-panel">
    <div v-if="paraIndex < 0" class="note-empty">点击段落右侧的 📝 按钮开始记笔记</div>
    <template v-else>
      <div class="note-header">
        <span class="note-para-label">第 {{ paraIndex + 1 }} 段</span>
        <button v-if="!isEditing" class="note-btn note-edit" @click="startEdit">✏️ 编辑</button>
        <button v-if="isEditing" class="note-btn note-save" :disabled="saving" @click="onSave">{{ saving ? '保存中…' : '✓ 保存' }}</button>
      </div>
      <div v-if="isEditing" class="note-editor-wrap">
        <div ref="editorEl" class="note-editor" contenteditable="true" spellcheck="false"></div>
      </div>
      <div v-else class="note-viewer-wrap">
        <div v-if="!localText" class="note-empty-inline">暂无内容，点击编辑开始记笔记</div>
        <div v-else class="note-viewer">
          <div class="note-viewer-body">
            <p v-for="(segs, i) in entrySegments" :key="i" class="note-para">
              <template v-for="(seg, j) in segs" :key="j">
                <span v-if="seg.type === 'mark'" style="color:red">{{ seg.text }}</span>
                <template v-else>{{ seg.text }}</template>
              </template>
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.note-panel { height: 100%; display: flex; flex-direction: column; background: #fcf9f4; }
.note-empty { margin: auto; padding: 40px; color: #aaa; font-size: 14px; text-align: center; }
.note-empty-inline { margin: 40px; color: #aaa; font-size: 14px; text-align: center; }
.note-header { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid #e0d8cc; flex-shrink: 0; }
.note-para-label { font-size: 13px; font-weight: 600; color: #6b5a3e; margin-right: auto; }
.note-btn { border-radius: 4px; padding: 5px 0; font-size: 12px; cursor: pointer; transition: all 0.15s; min-width: 56px; text-align: center; border: 1px solid transparent; box-sizing: border-box; }
.note-edit { background: transparent; color: #6b5a3e; border-color: #d4c5b0; }
.note-edit:hover { background: #f0e8d8; }
.note-save { background: #8b3a2a; color: #fff; }
.note-save:hover { background: #6b2a1a; }
.note-editor-wrap, .note-viewer-wrap {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
  scrollbar-gutter: stable;
  display: flex; flex-direction: column; align-items: center;
  padding: 24px 16px 40px;
}
.note-editor, .note-viewer { width: 100%; max-width: 800px; padding: 0 24px; box-sizing: border-box; min-width: 0; flex: 1; overflow-wrap: break-word; word-break: break-word; }
.note-editor { outline: none; min-height: 100px; font-family: 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif; font-size: 16px; line-height: 1.8; color: #333; text-align: justify; }
.note-editor ::selection { background: #f5c6d4; }
.note-editor:empty::before { content: '输入段落笔记...'; color: #bbb; }
.note-editor :deep(p) { margin: 0 0 12px; white-space: pre-wrap; padding-left: 1.5em; text-indent: -1.5em; }
.note-viewer { width: 100%; max-width: 800px; padding: 0 24px; box-sizing: border-box; min-width: 0; flex: none; overflow-wrap: break-word; word-break: break-word; font-family: 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif; font-size: 16px; line-height: 1.8; color: #333; }
.note-viewer ::selection { background: #f5c6d4; }
.note-viewer-wrap ::selection { background: #f5c6d4; }
.note-viewer-body { width: 100%; }
.note-para { margin: 0 0 12px; white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; padding-left: 1.5em; text-indent: -1.5em; text-align: justify; }
</style>
