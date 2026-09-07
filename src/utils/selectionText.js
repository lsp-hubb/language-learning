// 选中文本与正文匹配高亮的公共工具（供 NotePanel / ArticleReader 共用）

// 读取"单词边界自动扩展"后的完整选中文本（选区补全）
// 说明：鼠标划选可能只选中单词的一部分，这里按空白边界前后扩展，
//       返回补全后的完整词/短语作为查找关键词；仅读取，不改动真实选区。
// 注意：仅当选区边界位于"单词内部"（左右侧都是非空白字符）时才扩展，
//       若边界已在词首/词尾（紧邻空白），说明单词已完整，不再多扩展
//       （避免双击完整单词时误把后一个词也带进来）。
export function getExpandedSelectionText() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || sel.isCollapsed) return ''
  const range = sel.getRangeAt(0)
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
  // 去掉首尾符号后再作为查找关键词（如 conclusion. → conclusion）
  // 保留单词内的撇号/连字符（don't、well-known），只清理两端成对的括号/引号和末尾标点
  let text = expanded.toString().trim()
  text = text.replace(/^[「『【〔［（(【\s"'([{]+/, '')            // 开头符号
  text = text.replace(/[」』】〕］）)】\s"'.,;:!?，。；：！？、)]+$/, '') // 末尾符号/标点
  return text.trim()
}

// 在正文容器（.reader-body）中高亮所有命中的关键词，并返回命中的 <mark> 元素列表
// 供外部滚动到第一个命中处。每次调用会先清除上一次遗留的高亮，保证可重复触发。
// containerEl：正文 DOM 容器（含 .para-block / .article-para 的结构）
// keyword：待匹配的关键词（不做补全，由调用方保证已补全）；传空字符串可仅清除旧高亮
// 返回：命中的 <mark> 元素数组（无命中返回空数组）
export function highlightMatchesInReader(containerEl, keyword) {
  const hits = []
  if (!containerEl) return hits

  // 先清除上一次遗留的高亮（把 <mark> 还原为普通文本），避免累积。
  // 关键词为空时也执行清除，供"选区消失 → 清高亮"使用。
  containerEl.querySelectorAll('mark.reader-hit').forEach((m) => {
    const parent = m.parentNode
    if (parent) parent.replaceChild(document.createTextNode(m.textContent), m)
  })
  if (!keyword) return hits

  // 快照所有文本节点，并按文档顺序记录每个节点在"逻辑全文"中的起始偏移。
  // 注意：正文段落可能被批注拆分成多个 <span>，短语可能横跨多个文本节点，
  // 故不能逐节点单独匹配，需把连续文本节点拼接后统一查找，再映射回各节点。
  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      // 跳过已处于 <mark> 内的文本（防御，通常不会出现）
      if (n.parentNode && n.parentNode.classList && n.parentNode.classList.contains('reader-hit')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes = [] // { node, start, len } —— node 的全局偏移
  const fullParts = []
  let offset = 0
  let cur = walker.nextNode()
  while (cur) {
    const len = (cur.nodeValue || '').length
    nodes.push({ node: cur, start: offset, len })
    fullParts.push(cur.nodeValue || '')
    offset += len
    cur = walker.nextNode()
  }
  const fullText = fullParts.join('')
  if (!fullText) return hits

  // 在逻辑全文中查找所有不重叠命中
  const kLower = keyword.toLowerCase()
  const kLen = keyword.length
  const ranges = []
  let idx = 0
  while (true) {
    idx = fullText.toLowerCase().indexOf(kLower, idx)
    if (idx === -1) break
    ranges.push([idx, idx + kLen])
    idx += kLen
  }
  if (!ranges.length) return hits

  // 把每个命中 [gStart, gEnd) 映射到各文本节点内的片段 (node, nodeStartOffset, len)
  // 命中可能横跨多个节点，需在每个涉及的节点上各生成一段待包裹的片段。
  // 用 Map 按节点聚合，便于统一应用（splitText 会改 DOM，须集中处理）。
  // 每个片段记录所属的命中下标 hitIdx（同一次命中跨节点的多个片段共享同一 hitIdx）。
  const byNode = new Map() // node -> [{offset, len, hitIdx}]
  for (let ri = 0; ri < ranges.length; ri++) {
    const [gStart, gEnd] = ranges[ri]
    for (const n of nodes) {
      const nStart = n.start
      const nEnd = n.start + n.len
      const clipStart = Math.max(gStart, nStart)
      const clipEnd = Math.min(gEnd, nEnd)
      if (clipStart >= clipEnd) continue
      const item = { offset: clipStart - nStart, len: clipEnd - clipStart, hitIdx: ri }
      if (!byNode.has(n.node)) byNode.set(n.node, [])
      byNode.get(n.node).push(item)
    }
  }

  // 对每个节点，按其片段 offset 从大到小应用 splitText + <mark> 包裹
  // （从后往前拆分，前面的拆分不会影响后面已记录的偏移）
  for (const [node, items] of byNode) {
    items.sort((a, b) => b.offset - a.offset)
    for (const it of items) {
      // 拆出前缀 [0, offset)：剩下的 node 起点即命中开始
      let hitNode = node
      if (it.offset > 0) hitNode = hitNode.splitText(it.offset)
      // 拆出命中片段 [0, len)：tail 是其后剩余
      const tail = hitNode.splitText(it.len)
      // 包裹 <mark>，并用 data-hit-index 标记所属的完整命中
      const mark = document.createElement('mark')
      mark.className = 'reader-hit'
      mark.setAttribute('data-hit-index', it.hitIdx)
      hitNode.parentNode.replaceChild(mark, hitNode)
      mark.appendChild(hitNode)
      hits.push(mark)
    }
  }

  // 把同一次命中对应的多个相邻 <mark> 合并为一个，并把中间空白文本也拉入 mark。
  // 这样多词短语被 span/批注拆成多个文本节点时，视觉上仍是连续一整块高亮，
  // 而不是单词间被空隙/背景割裂。
  mergeAdjacentHitMarks(containerEl)

  return Array.from(containerEl.querySelectorAll('mark.reader-hit'))
}

// 合并同一次命中的多个相邻 <mark>，并把它们之间的空白文本节点也纳入 mark。
function mergeAdjacentHitMarks(containerEl) {
  const groups = new Map()
  containerEl.querySelectorAll('mark.reader-hit').forEach((m) => {
    const idx = m.getAttribute('data-hit-index')
    if (!groups.has(idx)) groups.set(idx, [])
    groups.get(idx).push(m)
  })

  for (const [, marks] of groups) {
    if (marks.length <= 1) continue
    let i = 0
    while (i < marks.length) {
      const cur = marks[i]
      if (!cur.parentNode) {
        i++
        continue
      }
      let j = i + 1
      while (j < marks.length) {
        const next = marks[j]
        j++
        if (!next || !next.parentNode) continue
        const range = document.createRange()
        range.setStartAfter(cur)
        range.setEndBefore(next)
        if (!range.collapsed) {
          cur.appendChild(range.extractContents())
        }
        while (next.firstChild) cur.appendChild(next.firstChild)
        next.remove()
      }
      i++
    }
  }
}

// 在正文容器中滚动到第 k 个"完整命中"处（命中高亮后调用），使该命中居中显示。
// containerEl：正文 DOM 容器（.reader-body）；k：命中下标（0 为第一个完整命中）。
// 一个完整命中可能因跨文本节点被拆成多个 <mark>，它们共享 data-hit-index。
// 定位到第 k 个完整命中时，会把它包含的所有 <mark> 都加上 .reader-hit-current
// （深蓝高亮），区别于其他浅蓝命中。
// 返回是否滚动成功。若 k 越界按命中总数取模循环。
export function scrollToReaderHit(containerEl, k, scrollableSelector) {
  const marks = containerEl ? containerEl.querySelectorAll('mark.reader-hit') : null
  if (!marks || !marks.length) return false
  // 收集唯一命中下标并排序，得到"完整命中"列表
  const hitIndexes = [...new Set(Array.from(marks).map((m) => Number(m.getAttribute('data-hit-index'))))].sort((a, b) => a - b)
  if (!hitIndexes.length) return false
  const targetHit = hitIndexes[k % hitIndexes.length]
  // 移除所有 mark 的 current 类
  marks.forEach((m) => m.classList.remove('reader-hit-current'))
  // 给属于目标命中的所有 mark 加 current 类
  const targetMarks = Array.from(marks).filter((m) => Number(m.getAttribute('data-hit-index')) === targetHit)
  targetMarks.forEach((m) => m.classList.add('reader-hit-current'))
  if (!targetMarks.length) return false
  // 用命中的第一个片段作为滚动锚点，使其居中显示
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

// 在正文容器中滚动到第一个命中处（命中高亮后调用）
// 若容器本身可滚动，将其滚到命中区域居中；否则用 scrollIntoView。
export function scrollToFirstHit(containerEl, scrollableSelector) {
  return scrollToReaderHit(containerEl, 0, scrollableSelector)
}
