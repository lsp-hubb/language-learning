// 选中文本与正文匹配高亮的公共工具（供 NotePanel / ArticleReader 共用）
//
// 正文的查找高亮完全由 Vue 数据驱动：buildDisplayParagraphs 计算命中片段，
// ArticleReader 模板渲染 <mark class="reader-hit">。本文件不再改动正文 DOM，
// 避免原生 splitText / replaceChild / extractContents 污染 .annotated 批注结构，
// 以及由此产生的 Vue vnode 与真实 DOM 失配（表现为「匹配结束后批注消失、刷新才恢复」）。

// 计算"单词边界自动扩展"后的选区 Range（选区补全的公共实现）
// 说明：鼠标划选可能只选中单词的一部分，这里按空白边界前后扩展，返回补全后的 Range；
//       无有效选区（折叠 / 仅空白）时返回 null。仅计算，不改动真实选区。
// 注意：仅当选区边界位于"单词内部"（左右侧都是非空白字符）时才扩展，
//       若边界已在词首/词尾（紧邻空白），说明单词已完整，不再多扩展
//       （避免双击完整单词时误把后一个词也带进来）。
function expandedSelectionRange() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  // 选区本身没有可见内容时直接返回空，不再走下面的"按词边界补全"。
  // 典型场景：双击文本末尾的空白处，浏览器只选中了空白字符（视觉上像什么都没选中），
  // 此时若继续补全，起点会因左侧是非空白字符而判定为"位于单词内部"并向前补到词首，
  // 最终返回「最后一个单词 + 空格」→ 表现为"双击却没选中内容，正文却匹配了最后一个单词"。
  if (!range.toString().trim()) return null
  const expanded = range.cloneRange()
  // 词边界：空白，或连字符/破折号（- – —）。这些符号处断开，
  // 避免把 power-hungry、him—and、beings—powerless 误判为一个单词。
  const WORD_BREAK_RE = /[\s\-–—]/

  // 起点：仅当左侧是非词边界字符（起点位于单词内部）才向前补全到词首
  let node = range.startContainer
  let offset = range.startOffset
  if (node.nodeType === Node.TEXT_NODE) {
    if (offset > 0 && !WORD_BREAK_RE.test(node.textContent[offset - 1])) {
      while (offset > 0 && !WORD_BREAK_RE.test(node.textContent[offset - 1])) offset--
      expanded.setStart(node, offset)
    }
  }
  // 终点：仅当左右两侧都是非词边界字符（终点位于单词内部）才向后补全到词尾
  node = range.endContainer
  offset = range.endOffset
  if (node.nodeType === Node.TEXT_NODE) {
    const leftIsWord = offset > 0 && !WORD_BREAK_RE.test(node.textContent[offset - 1])
    const rightIsWord = offset < node.textContent.length && !WORD_BREAK_RE.test(node.textContent[offset])
    if (leftIsWord && rightIsWord) {
      while (offset < node.textContent.length && !WORD_BREAK_RE.test(node.textContent[offset])) offset++
      expanded.setEnd(node, offset)
    }
  }
  return expanded
}

// 两端要裁掉的标点 / 引号 / 括号 / 空白（词内的符号如 don't、well-known 不受影响）。
// 只用于「首尾」匹配，故连字符、破折号放进来也不会切断词内连字符。
const LEADING_EDGE_RE = /^[\s"'`‘’“”「」『』【】〔〕［］（）()\[\]{}<>《》,，.。;；:：!！?？、·…—–\-]+/
const TRAILING_EDGE_RE = /[\s"'`‘’“”「」『』【】〔〕［］（）()\[\]{}<>《》,，.。;；:：!！?？、·…—–\-]+$/

// 去掉文本两端的标点 / 引号 / 括号 / 空白，并返回被裁掉的前导、尾部字符数。
// 标注创建时用这两个数同步收缩坐标，保证 text 与 (startOffset, endOffset) 仍严格对应。
export function trimEdgePunctuation(text) {
  const raw = String(text ?? '')
  const lead = raw.match(LEADING_EDGE_RE)?.[0].length || 0
  const rest = raw.slice(lead)
  const trail = rest.match(TRAILING_EDGE_RE)?.[0].length || 0
  return { text: rest.slice(0, rest.length - trail), lead, trail }
}

// 批注选区裁掉两端标点：text 与偏移量必须同步收缩，否则渲染范围、同类型判重、
// PDF 导出的偏移定位都会与 text 对不上。整段都是标点时原样返回，避免标了却无反应。
export function trimAnnotationEdges(sel) {
  if (!sel || typeof sel.text !== 'string') return sel
  const { text, lead, trail } = trimEdgePunctuation(sel.text)
  if (!text) return sel
  return {
    ...sel,
    text,
    startOffset: sel.startOffset + lead,
    endOffset: sel.endOffset - trail,
  }
}

// 读取"单词边界自动扩展"后的完整选中文本（选区补全）
// 说明：鼠标划选可能只选中单词的一部分，按空白边界前后扩展，
//       返回补全后的完整词/短语作为查找关键词；仅读取，不改动真实选区。
export function getExpandedSelectionText() {
  const expanded = expandedSelectionRange()
  if (!expanded) return ''
  // 去掉首尾符号后再作为查找关键词（如 conclusion. → conclusion）
  // 保留单词内的撇号/连字符（don't、well-known），只清理两端标点/括号/引号
  return trimEdgePunctuation(expanded.toString()).text
}

// 把真实选区扩展到单词边界（视觉上的蓝色选区随扩展变化）。
// 供笔记英文行等以「文本」为准的场景：只划到半个词时，选区高亮补全为完整单词。
// 无有效选区（折叠 / 仅空白）时不动真实选区。
export function applyExpandedSelection() {
  const sel = window.getSelection()
  const expanded = expandedSelectionRange()
  if (!sel || !expanded) return false
  sel.removeAllRanges()
  sel.addRange(expanded)
  return true
}

// ===== 完整词边界匹配 =====
// 词内字符：Unicode 字母 / 数字 / 下划线 / 撇号（含弯撇号）。与 expandedSelectionRange 的
// WORD_BREAK_RE（空白 / 连字符 / 破折号为边界）保持一致的「词」语义：don't、heir's 是一个词，
// 而空白、标点、引号、连字符视为词边界（批注 text 与查找关键词创建时已裁掉首尾标点）。
const WORD_CHAR_RE = /[\p{L}\p{N}_'’]/u

// 在 haystack 中查找 needle 的所有「完整词」命中区间 [start, end)，大小写不敏感。
// 左右紧邻字符只要有一侧是词内字符就判为子串命中并丢弃：heir 不应命中 their。
// 与项目 normKey 一样要求大小写转换等长，故返回下标可直接用于原串切片。
// 只用于「按文本定位」的回退路径；正文坐标投影不经过这里。
export function findWholeWordMatches(haystack, needle) {
  const hay = String(haystack ?? '')
  const n = String(needle ?? '')
  if (!hay || !n) return []
  const hLower = hay.toLowerCase()
  const nLower = n.toLowerCase()
  const out = []
  let from = 0
  while (from <= hLower.length - nLower.length) {
    const idx = hLower.indexOf(nLower, from)
    if (idx === -1) break
    const end = idx + nLower.length
    const left = idx > 0 ? hay[idx - 1] : ''
    const right = end < hay.length ? hay[end] : ''
    if (!(left && WORD_CHAR_RE.test(left)) && !(right && WORD_CHAR_RE.test(right))) {
      out.push([idx, end])
    }
    from = end
  }
  return out
}

// ===== 数据驱动：把段落片段按关键词切成带命中标记的 parts =====
// paragraphSegments：Array<Array<seg>>，seg = { type, text, key, annotation?, annotations? ... }
// 返回同结构，每个 seg 增加 parts: [{ text, hitIdx }]，hitIdx >= 0 为命中（全局编号），-1 为普通文本。
// 命中在「段落逻辑全文」上查找（可跨 seg / 跨批注边界），再投影回各 seg；
// 同一次命中跨 seg 的多个 part 共享 hitIdx，供 scrollToReaderHit 与 .reader-hit-current 定位。
// 纯函数：不碰 DOM、不改变 seg 原始字段（批注元数据原样保留，Vue 照常渲染 .annotated）。
export function buildDisplayParagraphs(paragraphSegments, keyword) {
  const kw = (keyword || '').trim()
  const kLower = kw.toLowerCase()
  const kLen = kw.length
  let nextHitIdx = 0
  return (paragraphSegments || []).map((segments) => {
    const paraText = segments.map((s) => s.text || '').join('')
    const ranges = [] // [start, end, hitIdx]，段落内偏移
    if (kLen && paraText) {
      let idx = 0
      while (true) {
        idx = paraText.toLowerCase().indexOf(kLower, idx)
        if (idx === -1) break
        // 命中区间不允许包含换行符与首尾空白：跨行选中的关键词自带 \n（正文 white-space: pre-wrap），
        // 若 <mark> 包住 \n / 行尾空格，其 box-shadow 描边会在行边界画出一条游离横线。
        // 故按 \n 拆成多段并裁掉每段首尾空白（换行与空白留在 mark 外作普通文本）。
        const s = idx
        const e = idx + kLen
        let segStart = s
        for (let i = s; i <= e; i++) {
          if (i === e || paraText[i] === '\n') {
            let a = segStart
            let b = i
            while (a < b && /\s/.test(paraText[a])) a++
            while (b > a && /\s/.test(paraText[b - 1])) b--
            if (a < b) ranges.push([a, b, nextHitIdx++])
            segStart = i + 1
          }
        }
        idx += kLen
      }
    }

    let cursor = 0
    return segments.map((seg) => {
      const text = seg.text || ''
      const start = cursor
      const end = start + text.length
      cursor = end
      const parts = []
      let p = 0
      for (const [rs, re, hi] of ranges) {
        const cs = Math.max(rs, start)
        const ce = Math.min(re, end)
        if (cs >= ce) continue
        const ls = cs - start
        const le = ce - start
        if (ls > p) parts.push({ text: text.slice(p, ls), hitIdx: -1 })
        parts.push({ text: text.slice(ls, le), hitIdx: hi })
        p = le
      }
      if (p < text.length) parts.push({ text: text.slice(p), hitIdx: -1 })
      if (!parts.length) parts.push({ text: '', hitIdx: -1 })
      // hasHit：该 seg 是否含命中 part。命中期间 ArticleReader 据此临时隐藏批注视觉
      // （黄底 / 下划线），避免与命中蓝底叠加造成割裂；选区消失后重算自然恢复。
      return { ...seg, parts, hasHit: parts.some((p) => p.hitIdx >= 0) }
    })
  })
}

// ===== 逐段朗读：词区间与朗读高亮投影 =====
// 把段落纯文本切成词区间 [[start, end), ...]（与 SpeechSynthesisUtterance.boundary 给出的
// charIndex 同一坐标系：均为段落全文的字符偏移）。
// 朗读的词边界按 TTS 发音习惯，与 findWholeWordMatches 的查找语义不同：
//   - ASCII 连字符 `-` 算【词内】——physical-format / state-of-the-art 被 TTS 连读成一个词，整体高亮；
//   - 破折号 `—` / `–`（em / en dash）算【边界】——idea—a 读作两个词，各自高亮；
//   - 字母 / 数字 / 下划线 / 撇号算词内，数字 2015、(1957) 的 1957 都能成词；标点 / 引号 / 空白算边界。
// 故这里用朗读专用正则（不复用 WORD_CHAR_RE，它把连字符算边界）。换行 / 多空格天然跳过。
// 注意 `-` 放在字符类末尾表示字面量，避免被当成范围连接符。
const READ_WORD_RE = /[\p{L}\p{N}_'’\-]+/gu
export function buildWordRanges(text) {
  const ranges = []
  const re = new RegExp(READ_WORD_RE.source, 'gu')
  let m
  while ((m = re.exec(text || '')) !== null) {
    ranges.push([m.index, m.index + m[0].length])
  }
  return ranges
}

// 把「当前朗读词区间」投影到 buildDisplayParagraphs 的输出上：为每个 seg 生成 renderParts，
// 每项 = { text, hitIdx, reading }。reading=true 的片段即当前朗读词覆盖到的部分。
// readingPara：当前朗读段下标（-1 表示无）；readingRange：[start, end) 词在段落全文的区间。
// 命中与朗读高亮落在同一个 renderPart 上（保留 hitIdx），模板据此加类、CSS 让朗读色覆盖命中蓝底。
// 纯函数：不碰 DOM、不改入参。
export function applyReadingHighlight(displayParagraphs, readingPara, readingRange) {
  return (displayParagraphs || []).map((segments, paraIdx) => {
    let segCursor = 0
    return segments.map((seg) => {
      const segStart = segCursor
      segCursor += (seg.text || '').length
      if (paraIdx !== readingPara || !readingRange) {
        return { ...seg, renderParts: (seg.parts || []).map((p) => ({ ...p, reading: false })) }
      }
      const [rs, re] = readingRange
      const renderParts = []
      let partOffset = segStart
      for (const p of seg.parts || []) {
        const text = p.text || ''
        const ps = partOffset
        const pe = ps + text.length
        partOffset = pe
        const cs = Math.max(ps, rs)
        const ce = Math.min(pe, re)
        if (cs >= ce) {
          renderParts.push({ ...p, reading: false })
          continue
        }
        const ls = cs - ps
        const le = ce - ps
        if (ls > 0) renderParts.push({ ...p, text: text.slice(0, ls), reading: false })
        renderParts.push({ ...p, text: text.slice(ls, le), reading: true })
        if (le < text.length) renderParts.push({ ...p, text: text.slice(le), reading: false })
      }
      return { ...seg, renderParts }
    })
  })
}

// 朗读 boundary 事件 → 本次应高亮的词区间下标与段全文区间 [start, end)。
// ranges=[[start,end),...]（段全文坐标）；c=charIndex+start；lastIdx=上次已高亮的下标。
// 返回 { idx, start, end }，或 null（无新词 / 重复 / 回退事件，调用方跳过）。
//
// 一个词一个高亮，不合并：数字（2017 / 100）在自己的 boundary 事件里单独高亮，
// 不并到前一个词（否则 in 亮一次、in 2017 又亮一次，前一个词重复点亮 —— 用户反馈）。
// 之前为了「TTS 不为数字发事件而越过数字」加的并词逻辑（并到前/后一词）会引入重复或
// 高亮滞后，均被否决；这里回到逐词直译，TTS 发了事件就高亮该词，没发则跳过（不伪造）。
// idx 取 boundary 命中词，落在区间外时找起点离 c 最近的未读词（兼容 charIndex 偏差）。
export function resolveReadingWord(ranges, c, lastIdx) {
  if (!ranges || !ranges.length) return null
  // ① charIndex 落在词区间内
  let idx = ranges.findIndex(([s, en]) => s <= c && c < en)
  // ② 落在区间外（TTS 常把 charIndex 给到词首前 / 词尾后）：找起点离 c 最近的未读词
  if (idx < 0) {
    let best = -1
    let bestDist = Infinity
    for (let k = lastIdx + 1; k < ranges.length; k++) {
      const [s, en] = ranges[k]
      const d = c < s ? s - c : c > en ? c - en : 0
      if (d < bestDist) {
        bestDist = d
        best = k
      }
    }
    idx = best
  }
  if (idx < 0 || idx <= lastIdx) return null
  return { idx, start: ranges[idx][0], end: ranges[idx][1] }
}

// ===== Edge TTS 词级时间戳 → 段全文字符区间 =====
// words: edge-tts WordBoundary [{ text, offset, duration }]，offset/duration 单位 100ns tick。
// Edge TTS 会把 "since 2015" 这类数字单元作为一个词返回，text 即原文片段；按【顺序游标】
// 在 fullText 中定位每个 word.text（大小写 / 引号不敏感），得到高亮区间与毫秒时间。
// startOffset：从段内某处开始朗读时，只在其后定位（前面词已被截掉）。
// 返回 [{ start, end, timeMs, durMs, text }]，找不到的词丢弃（音频仍播，只是不高亮）。
export function locateTtsWords(words, fullText, startOffset = 0) {
  const norm = (s) => (s || '').toLowerCase().replace(/[’]/g, "'")
  let cursor = Math.max(0, startOffset)
  const result = []
  for (const w of words || []) {
    const raw = (w.text || '').trim()
    if (!raw) continue
    // 顺序游标：从上次匹配结束处往后找，避免重复词（如 the ... the）定位到前面
    const pos = norm(fullText.slice(cursor)).indexOf(norm(raw))
    if (pos < 0) continue // 找不到就跳过该词（音频照播，仅不高亮），避免错位
    const start = cursor + pos
    const end = start + raw.length
    cursor = end
    result.push({
      start,
      end,
      timeMs: (w.offset || 0) / 10000,
      durMs: (w.duration || 0) / 10000,
      text: w.text,
    })
  }
  return result
}

// 在正文容器中滚动到第 k 个"完整命中"处，使该命中居中显示。
// containerEl：正文 DOM 容器（.reader-body）；k：命中下标（0 为第一个完整命中）。
// 一个完整命中可能因跨 seg 被拆成多个 <mark>，它们共享 data-hit-index。
// 注意：当前命中的深蓝 .reader-hit-current 由 Vue 依据 readerHit.index 渲染（:class），
//       此函数只负责滚动，不再增删 class，避免与 Vue 托管的 DOM 冲突。
// 返回是否滚动成功。若 k 越界按命中总数取模循环。
export function scrollToReaderHit(containerEl, k, scrollableSelector) {
  const marks = containerEl ? containerEl.querySelectorAll('mark.reader-hit') : null
  if (!marks || !marks.length) return false
  // 收集唯一命中下标并排序，得到"完整命中"列表
  const hitIndexes = [...new Set(Array.from(marks).map((m) => Number(m.getAttribute('data-hit-index'))))].sort((a, b) => a - b)
  if (!hitIndexes.length) return false
  const len = hitIndexes.length
  const kk = (((Number(k) || 0) % len) + len) % len
  const targetHit = hitIndexes[kk]
  // 同一次命中可能对应多个 mark（跨 seg），用第一个片段作为滚动锚点
  const targetMarks = Array.from(marks).filter((m) => Number(m.getAttribute('data-hit-index')) === targetHit)
  if (!targetMarks.length) return false
  const anchor = targetMarks[0]
  if (scrollableSelector) {
    const scroller = document.querySelector(scrollableSelector)
    if (scroller) {
      const areaRect = scroller.getBoundingClientRect()
      const elRect = anchor.getBoundingClientRect()
      const newTop = scroller.scrollTop + (elRect.top - areaRect.top) - (areaRect.height - elRect.height) / 2
      scroller.scrollTo({ top: newTop, behavior: 'auto' })
      return true
    }
  }
  if (typeof anchor.scrollIntoView === 'function') {
    anchor.scrollIntoView({ behavior: 'auto', block: 'center' })
  }
  return true
}
