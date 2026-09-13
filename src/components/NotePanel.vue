<template>
  <div class="note-root">
    <!-- 顶部常驻操作栏：位于滚动区域之外，固定不随滚动 -->
    <div class="top-actions">
      <el-button size="small" type="primary" @click="onTopAction">解析并渲染</el-button>
      <el-button size="small" type="warning" @click="showEdit">修改</el-button>
      <el-button size="small" type="danger" :plain="!markedPanelVisible" @click="toggleMarkedPanel">重点</el-button>
      <el-button size="small" @click="hideInput">关闭</el-button>
    </div>

    <!-- 可滚动内容区 -->
    <div class="scroll-area" ref="scrollArea">
      <div class="container">
        <!-- 输入区：默认隐藏，点击顶部按钮才显示 -->
        <div class="input-section" :class="{ fullscreen: mode === 'edit' }" v-show="inputVisible">
          <div class="input-header">
            <h3 class="section-title">
              {{ mode === 'edit' ? '修改全部笔记（可编辑整篇）' : '粘贴结构化笔记' }}
            </h3>
            <span v-if="mode === 'edit'" class="mode-tag">修改模式</span>
            <span v-if="saving" class="save-hint">保存中…</span>
          </div>
          <textarea
            v-model="rawText"
            class="raw-input"
            :class="{ 'raw-input-full': mode === 'edit' }"
            :placeholder="mode === 'edit' ? '修改后按 Enter 保存修改，Shift+Enter 换行（或点「保存修改」）' : '输入后按 Enter 解析渲染，Shift+Enter 换行（或点「解析并渲染」）'"
            @keydown.enter="onEnterKey"
          ></textarea>
          <div class="btn-row">
            <button class="btn btn-primary" v-if="mode === 'edit'" @click="onParseClick">保存修改</button>
            <button class="btn btn-secondary" @click="hideInput">关闭</button>
          </div>
          <p v-if="saveError" class="save-error">保存失败：{{ saveError }}</p>
        </div>

        <!-- 笔记列表 -->
        <div v-if="notes.length" class="notes-container">
          <div v-for="(n, i) in notes" :key="i" class="note-card" :class="{ 'note-match': isMatch(i), 'note-current': i === currentCardIndex }" :id="'note-' + i">
            <div class="english-text" v-html="highlight(n.english)" @mouseup="onReverseSelect"></div>
            <div class="chinese-text" v-html="highlight(n.chinese)" @mouseup="onReverseSelect"></div>
            <div v-if="n.vocabItems.length" class="vocab-section">
              <div class="vocab-title">Vocabulary &amp; Expressions</div>
              <ul class="vocab-list">
                <li
                  v-for="(v, vi) in n.vocabItems"
                  :key="vi"
                  :class="{ 'vocab-marked': isMarked(i, v) }"
                  :title="isMarked(i, v) ? '双击取消重点 · 右键复制' : '双击标记为重点 · 右键复制'"
                  @dblclick="toggleMark(i, v)"
                  @contextmenu.prevent="copyVocab(v, $event)"
                ><span v-html="highlight(v)"></span></li>
              </ul>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="empty-state">
          <p>点击上方「解析并渲染」粘贴并保存你的结构化笔记</p>
        </div>
      </div>
    </div>

    <!-- 重点集中卡片：顶部「重点」按钮弹出的只读卡片，汇总所有标记为「重点」的词汇项。
         与输入区同为弹出式（fixed，不随滚动），内容只读：仅可单击定位到原卡片，不可在此修改标记。 -->
    <div v-if="markedPanelVisible" class="marked-panel">
      <div class="marked-header">
        <h3 class="section-title">
          重点集中（{{ markedItems.length }}）<span class="readonly-tag">只读</span>
        </h3>
        <el-button size="small" @click="markedPanelVisible = false">关闭</el-button>
      </div>
      <div class="marked-body">
        <!-- 左侧：重点词汇列表，点击某项即在右侧显示它所属的笔记卡片 -->
        <ul v-if="markedItems.length" class="marked-list">
          <li
            v-for="m in markedItems"
            :key="m.key"
            class="marked-item"
            :class="{ 'is-active': m.noteIndex === activeNoteIndex }"
            title="单击在右侧显示所属笔记卡片"
            @click="selectNote(m.noteIndex)"
          >
            <span class="marked-badge">{{ m.noteIndex + 1 }}</span>
            <span class="marked-text" v-html="highlight(m.vocab)"></span>
          </li>
        </ul>
        <p v-else class="marked-empty">暂无重点，双击笔记卡片中的词汇项即可标记为重点</p>

        <!-- 右侧边栏：直接显示对应的原笔记卡片（与笔记列表中的 .note-card 结构一致），只读 -->
        <aside v-if="activeNote" class="marked-sidebar">
          <div class="sidebar-title">对应笔记</div>
          <div class="note-card sidebar-card">
            <div class="card-header">
              <div class="badge">{{ activeNoteIndex + 1 }}</div>
              <div class="card-subtitle sidebar-subtitle">{{ activeNote.subtitle }}</div>
            </div>
            <div class="english-text">{{ activeNote.english }}</div>
            <div class="chinese-text">{{ activeNote.chinese }}</div>
            <div v-if="activeNote.vocabItems.length" class="vocab-section">
              <div class="vocab-title">Vocabulary &amp; Expressions</div>
              <ul class="vocab-list">
                <li
                  v-for="(v, vi) in activeNote.vocabItems"
                  :key="vi"
                  :class="{ 'vocab-marked': isMarked(activeNoteIndex, v) }"
                ><span v-html="highlight(v)"></span></li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script>
import { getExpandedSelectionText, scrollToReaderHit } from '@/utils/selectionText'

export default {
  name: 'NotePanel',
  props: {
    articleId: { type: String, default: '' },
    noteSearch: { type: String, default: '' },
    noteSearchNonce: { type: Number, default: 0 }
  },
  // 反向联动：笔记中选中文字 → emit('reverse-select', 完整词) 让 App 更新正文高亮
  emits: ['reverse-select'],
  data() {
    return {
      rawText: '',
      notes: [],            // 解析后用于展示的笔记数组（不入库）
      savedRaw: '',         // 数据库中保存的生文本（修改时原样载入）
      inputVisible: false,  // 文本输入区默认隐藏
      mode: 'add',          // 'add' = 只追加；'edit' = 修改全部
      saving: false,
      saveError: '',
      marked: {},           // 重点标记状态（持久化在 localStorage），键为 `noteIndex__词汇文本`，值为 true
      matchIndices: [],     // 匹配选中文本的卡片索引（用于高亮）
      currentMatch: -1,     // 当前滚动定位到的匹配项位置（在 matchIndices 中的下标）
      readerHitIndex: -1,   // 反向联动：当前定位到的正文命中下标（-1 表示尚未定位）
      markedPanelVisible: false, // 重点集中卡片是否展开
      activeNoteIndex: -1   // 重点卡片右侧边栏当前跳转到的笔记索引（-1 表示无）
    }
  },
  computed: {
    // 当前定位到的匹配卡片实际索引（-1 表示无）
    currentCardIndex() {
      if (this.currentMatch < 0 || this.currentMatch >= this.matchIndices.length) return -1
      return this.matchIndices[this.currentMatch]
    },
    // 所有被标记为重点的词汇项（按笔记顺序、词汇顺序汇总），供重点集中卡片展示
    markedItems() {
      const items = []
      this.notes.forEach((n, i) => {
        const list = n.vocabItems || []
        list.forEach((v) => {
          if (this.marked[i + '__' + v]) {
            items.push({ key: i + '__' + v, noteIndex: i, vocab: v, subtitle: n.subtitle })
          }
        })
      })
      return items
    },
    // 右侧边栏当前显示的笔记对象（无选中时为 null）
    activeNote() {
      if (this.activeNoteIndex < 0) return null
      return this.notes[this.activeNoteIndex] || null
    }
  },
  watch: {
    articleId(val) {
      if (val) {
        this.loadMarked()
        this.loadNotes()
      }
    },
    // 正文选中文本变化时：查找匹配项 → 高亮 → 滚动到第一个
    noteSearchNonce() {
      this.findMatches()
    }
  },
  mounted() {
    if (this.articleId) this.loadMarked()
    if (this.articleId) this.loadNotes()
    this.bindEnterNav()
    this.bindEscClose()
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this._enterNavHandler)
    window.removeEventListener('keydown', this._escCloseHandler)
  },
  methods: {
    // 顶部「解析并渲染」单一入口：输入区未打开则打开，已打开则解析并渲染
    onTopAction() {
      if (!this.inputVisible) {
        this.showAdd()
      } else {
        this.onParseClick()
      }
    },
    // textarea 内快捷键：普通 Enter = 点击「解析并渲染 / 保存修改」按钮；Shift+Enter 仅换行
    onEnterKey(e) {
      if (e.shiftKey) return // 允许 Shift+Enter 换行
      e.preventDefault()     // 普通 Enter 不插入换行
      this.onParseClick()    // 等价于点击对应按钮
    },
    // 显示输入区（添加模式）
    showAdd() {
      this.mode = 'add'
      this.inputVisible = true
      this.rawText = ''
      this.saveError = ''
    },
    // 显示输入区（修改模式），载入数据库中的原始生文本（含 \ 分隔符）
    showEdit() {
      this.mode = 'edit'
      this.inputVisible = true
      this.rawText = this.savedRaw
      this.saveError = ''
    },
    // 隐藏输入区
    hideInput() {
      this.inputVisible = false
      this.rawText = ''
      this.saveError = ''
    },
    // 右键单击复制词汇内容到剪贴板（兼容无 Clipboard API 的降级方案）
    async copyVocab(v, e) {
      const text = String(v || '').trim()
      if (!text) return
      let ok = false
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text)
          ok = true
        }
      } catch (err) {
        ok = false
      }
      if (!ok) {
        try {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
          ok = true
        } catch (err) {
          ok = false
        }
      }
      // 在右键位置附近轻提示结果
      if (ok) {
        const tip = document.createElement('div')
        tip.textContent = '已复制：' + text
        tip.style.cssText =
          'position:fixed;z-index:9999;left:' + (e.clientX + 8) + 'px;top:' +
          (e.clientY + 8) + 'px;background:rgba(0,0,0,.75);color:#fff;' +
          'padding:4px 10px;border-radius:4px;font-size:12px;pointer-events:none;'
        document.body.appendChild(tip)
        setTimeout(() => document.body.removeChild(tip), 1200)
      }
    },
    // 判断某个词汇项是否被标记为重点
    isMarked(noteIndex, v) {
      return !!this.marked[noteIndex + '__' + v]
    },
    // 双击切换词汇项重点标记（变红加粗），并持久化
    toggleMark(noteIndex, v) {
      const key = noteIndex + '__' + v
      // 整体替换 marked 对象，确保 Vue2 响应式更新（直接加 key 或 $set 在个别打包下不触发）
      const next = Object.assign({}, this.marked)
      next[key] = !this.marked[key]
      this.marked = next
      this.saveMarked()
    },
    // 展开/收起顶部「重点」按钮对应的重点集中卡片（弹出式只读卡片，不随滚动）
    toggleMarkedPanel() {
      this.markedPanelVisible = !this.markedPanelVisible
      // 打开时若尚未选择任何笔记，默认在右侧边栏显示第一张含重点的笔记卡片
      if (this.markedPanelVisible && this.activeNoteIndex < 0 && this.markedItems.length) {
        this.activeNoteIndex = this.markedItems[0].noteIndex
      }
    },
    // 单击左侧重点项：在右侧边栏直接显示它所属的笔记卡片（与笔记列表结构一致，只读）
    selectNote(noteIndex) {
      this.activeNoteIndex = noteIndex
    },
    // 从 localStorage 读取当前文章已保存的重点标记
    loadMarked() {
      if (!this.articleId) return
      try {
        const raw = localStorage.getItem('note_marks_' + this.articleId)
        this.marked = raw ? JSON.parse(raw) : {}
      } catch (e) {
        this.marked = {}
      }
    },
    // 将当前重点标记持久化到 localStorage（按 articleId 区分）
    saveMarked() {
      if (!this.articleId) return
      try {
        localStorage.setItem('note_marks_' + this.articleId, JSON.stringify(this.marked))
      } catch (e) {
        console.warn('[NotePanel] 保存重点标记失败', e)
      }
    },
    // 从数据库加载已保存的生文本，并解析为展示用笔记数组
    async loadNotes() {
      if (!this.articleId) return
      try {
        // 本项目后端获取单篇用 /api/article/:id（单数），经 Vite 代理同源转发
        const res = await fetch(`/api/article/${this.articleId}`)
        if (!res.ok) return
        const data = await res.json()
        // 兼容本项目后端返回 { status, data } 包裹格式
        const row = data && data.data ? data.data : data
        this.savedRaw = typeof row.notes === 'string' ? row.notes : ''
        this.notes = this.parseRaw(this.savedRaw)
      } catch (e) {
        console.warn('[NotePanel] 加载笔记失败', e)
      }
    },
    // 绑定全局回车：有匹配项时回车滚动到下一个匹配卡片至中央；
    // 若正文有反向高亮命中（笔记选中 → 正文），回车改在正文命中间循环跳转
    bindEnterNav() {
      if (this._enterNavHandler) return
      this._enterNavHandler = (e) => {
        // 避免与输入区/文本编辑冲突（在输入框、textarea 内不拦截回车）
        const tag = (e.target && e.target.tagName || '').toLowerCase()
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return
        if (e.key !== 'Enter') return
        // 优先处理反向联动：正文存在高亮命中 → 回车在正文命中间循环跳转
        if (this.nextReaderHit()) {
          e.preventDefault()
          return
        }
        // 否则走正向：笔记面板有匹配卡片 → 回车滚动到下一个匹配卡片
        if (this.matchIndices.length) {
          e.preventDefault()
          this.nextMatch()
        }
      }
      window.addEventListener('keydown', this._enterNavHandler)
    },
    // ESC 键退出重点集中卡片（仅当卡片展开时生效）
    bindEscClose() {
      if (this._escCloseHandler) return
      this._escCloseHandler = (e) => {
        if (e.key !== 'Escape') return
        if (this.markedPanelVisible) {
          this.markedPanelVisible = false
        }
      }
      window.addEventListener('keydown', this._escCloseHandler)
    },
    // 当前卡片是否命中正文选中文本（用于高亮）
    isMatch(i) {
      return this.matchIndices.includes(i)
    },
    // 转义 HTML，防止原始文本被当作标签
    escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    },
    // 在文本中高亮命中的搜索片段（返回 v-html 用的 HTML），仅高亮匹配文字段
    highlight(text) {
      const q = (this.noteSearch || '').trim().toLowerCase()
      if (!text) return ''
      if (!q) return this.escapeHtml(text)
      const lower = String(text).toLowerCase()
      const out = []
      let i = 0
      while (i < lower.length) {
        const idx = lower.indexOf(q, i)
        if (idx === -1) {
          out.push(this.escapeHtml(text.slice(i)))
          break
        }
        if (idx > i) out.push(this.escapeHtml(text.slice(i, idx)))
        out.push('<mark class="note-hit">' + this.escapeHtml(text.slice(idx, idx + q.length)) + '</mark>')
        i = idx + q.length
      }
      return out.join('')
    },
    // 反向联动：在笔记英文/中文区域用鼠标选中文字时，通知 App 在正文高亮命中词并跳转
    // （复用单词边界自动补全逻辑；由 App 更新 readerSearch* 供 ArticleReader 消费）
    onReverseSelect() {
      const text = getExpandedSelectionText()
      if (!text) return
      // 新一次反向选中：ArticleReader 会高亮正文并定位到第一个命中，
      // 故把当前定位置为 0（第一个），回车即从第二个开始向后翻
      this.readerHitIndex = 0
      this.$emit('reverse-select', text)
    },
    // 回车：在正文高亮命中间循环向后跳转（反向联动）
    nextReaderHit() {
      const body = document.querySelector('.reader .reader-body')
      if (!body) return false
      // 命中总数按"完整命中"计：跨节点的短语会被拆成多个 mark，但它们共享 data-hit-index
      const marks = body.querySelectorAll('mark.reader-hit')
      if (!marks.length) return false
      const count = new Set(Array.from(marks).map((m) => Number(m.getAttribute('data-hit-index')))).size
      if (!count) return false
      // 从 -1 起首次回车跳到第一个，之后循环向后
      this.readerHitIndex = (this.readerHitIndex + 1) % count
      scrollToReaderHit(body, this.readerHitIndex, '.reader .reader-content')
      return true
    },
    // 查找所有匹配选中文本的卡片
    findMatches() {
      const text = (this.noteSearch || '').trim().toLowerCase()
      this.matchIndices = []
      this.currentMatch = -1
      if (!text || !this.notes.length) return
      const indices = []
      this.notes.forEach((n, i) => {
        const english = (n.english || '').toLowerCase()
        const chinese = (n.chinese || '').toLowerCase()
        const vocab = (n.vocabItems || []).map((v) => v.toLowerCase()).join(' ')
        if (english.includes(text) || chinese.includes(text) || vocab.includes(text)) {
          indices.push(i)
        }
      })
      this.matchIndices = indices
      if (indices.length) {
        this.scrollToMatch(0)
      }
    },
    // 滚动到第 k 个匹配卡片至视图（k 为 matchIndices 下标）
    scrollToMatch(k) {
      if (k < 0 || k >= this.matchIndices.length) return
      this.currentMatch = k
      const idx = this.matchIndices[k]
      this.$nextTick(() => {
        const el = document.getElementById('note-' + idx)
        const area = this.$refs.scrollArea
        if (el && area) {
          const areaRect = area.getBoundingClientRect()
          const elRect = el.getBoundingClientRect()
          // 直接跳转定位到卡片位于滚动区域中央（不用平滑动画，更快）
          const target = area.scrollTop + (elRect.top - areaRect.top) - (area.clientHeight - elRect.height) / 2
          area.scrollTo({ top: target, behavior: 'auto' })
        } else if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' })
        }
      })
    },
    // 回车：滚动到下一个匹配卡片至中央
    nextMatch() {
      if (!this.matchIndices.length) return
      const next = (this.currentMatch + 1) % this.matchIndices.length
      this.scrollToMatch(next)
    },
    // 解析结构化文本：编号段落 → 英文 / 中文 / 词汇
    parseRaw(text) {
      const notes = []
      const blocks = text.split(/\n(?=\d+\.\s?)/).filter((b) => b.trim())
      blocks.forEach((block) => {
        const lines = block.trim().split('\n').map((l) => l.trim()).filter((l) => l)
        if (lines.length === 0) return
        const english = lines[0].replace(/^\d+\.\s*/, '')
        const chinese = lines[1] || ''
        const vocabLines = lines.slice(2).filter((l) => l.startsWith('（') || l.startsWith('('))
        let vocabRaw = ''
        if (vocabLines.length) {
          vocabRaw = vocabLines.join(' ').replace(/^[（(]|[）)]$/g, '').trim()
        }
        const words = english.split(' ').slice(0, 6).join(' ')
        const subtitle = words.replace(/[,;:]$/, '') + (english.split(' ').length > 6 ? '…' : '')
        const vocabItems = vocabRaw
          ? vocabRaw.split('\\').map((s) => s.trim()).filter((s) => s)
          : []
        notes.push({ english, chinese, vocabItems, subtitle })
      })
      return notes
    },
    // 解析 rawText 并合入 notes（根据 mode 决定追加 / 覆盖），仅用于即时预览
    parseAndRender() {
      const parsed = this.parseRaw((this.rawText || '').trim())
      if (this.mode === 'edit') {
        this.notes = parsed            // 修改模式：整体覆盖
      } else {
        this.notes = this.notes.concat(parsed)  // 添加模式：只追加，不覆盖已有
      }
    },
    // 点击输入区「解析并渲染」/「保存修改」：解析预览 → 保存生文本到数据库
    async onParseClick() {
      this.parseAndRender()
      // 编辑模式整体覆盖；添加模式在已保存生文本基础上追加
      let toSave
      if (this.mode === 'edit') {
        toSave = (this.rawText || '').trim()
      } else {
        const newRaw = (this.rawText || '').trim()
        toSave = this.savedRaw ? (this.savedRaw + '\n\n' + newRaw) : newRaw
      }
      await this.saveNotes(toSave)
      // 以保存后的完整生文本重新解析，保证展示与存储一致
      this.notes = this.parseRaw(toSave)
      // 解析渲染后清空文本框
      this.rawText = ''
      // 修改模式保存后切回添加模式，但保持输入区打开方便继续追加
      if (this.mode === 'edit') {
        this.mode = 'add'
      }
    },
    // 保存生文本到数据库（不做任何文本处理，原样存储）
    async saveNotes(text) {
      if (!this.articleId) return
      this.saving = true
      this.saveError = ''
      try {
        const res = await fetch(`/api/articles/${this.articleId}/notes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: text })
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        this.savedRaw = text
      } catch (e) {
        this.saveError = e.message || '未知错误'
        console.error('[NotePanel] 保存笔记失败', e)
      } finally {
        this.saving = false
      }
    }
  }
}
</script>

<style scoped>
.note-root {
  height: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  color: #303133;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.8;
}

/* 可滚动内容区 */
.scroll-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* Container */
.container {
  width: 100%;
  margin: 0 auto;
  padding: 16px;
  box-sizing: border-box;
}

/* 顶部常驻操作栏：固定在滚动区域之外，不随滚动；高度与左侧文章页顶部栏对齐 */
.top-actions {
  flex: 0 0 auto;
  z-index: 110;
  background: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 6px 16px;
  box-sizing: border-box;
  border-bottom: 1px solid #ebeef5;
}

/* Section title */
.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
}

/* Input header */
.input-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.input-header .section-title { margin-bottom: 0; }
.mode-tag {
  font-size: 0.74rem;
  color: #e6a23c;
  border: 1px solid #e6a23c;
  border-radius: 3px;
  padding: 1px 6px;
}
.save-hint {
  font-size: 0.78rem;
  color: #409eff;
}
.save-error {
  font-size: 0.78rem;
  color: #f56c6c;
  margin: 8px 0 0;
}

/* Card */
.note-card {
  background: #fff;
  border-radius: 6px;
  padding: 18px;
  margin-bottom: 14px;
  border: 1px solid #e4e7ed;
}
.note-card:hover {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}
/* 命中正文选中文本的卡片：仅轻微描边提示，不强高亮 */
.note-card.note-match {
  border-color: #409eff;
  box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.4);
}
/* 精确高亮命中文字段（类似浏览器 Ctrl+F 的命中高亮，蓝色系与主色统一）
   必须用 :deep()：<mark> 由 highlight() 经 v-html 动态插入，编译期拿不到
   scoped 的 data-v-xxx 属性，写 .note-hit 会匹配不到，从而露出浏览器
   给 <mark> 的 UA 默认黄色。 */
:deep(.note-hit) {
  background: #409eff;
  color: #fff;
  border-radius: 2px;
  /* 同 .reader-hit：用 box-shadow 描边代替横向 padding，避免内联盒变宽导致重排/移位 */
  box-shadow: 0 0 0 1px #409eff;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
/* 当前定位到的匹配卡片：描边加深 */
.note-card.note-match.note-current {
  border-color: #1f6ea8;
  box-shadow: 0 0 0 2px rgba(31, 110, 168, 0.5);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.badge {
  background: #f5f7fa;
  color: #606266;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  font-weight: 600;
  flex-shrink: 0;
  border: 1px solid #e4e7ed;
}
.card-subtitle {
  font-size: 0.82rem;
  color: #606266;
  font-weight: 500;
}

.english-text {
  font-size: 0.95rem;
  color: #1f2329;
  margin-bottom: 10px;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  border-left: 3px solid #409eff;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}
.chinese-text {
  font-size: 0.88rem;
  color: #303133;
  margin-bottom: 10px;
  padding: 10px 12px;
  background: #fafbfc;
  border-radius: 4px;
  border-left: 3px solid #dcdfe6;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}
/* 英文/中文区域内鼠标选中文本时，选中态颜色用匹配高亮同款蓝色（#409eff） */
.english-text::selection,
.chinese-text::selection {
  background: #409eff;
  color: #fff;
}

.vocab-section { margin-top: 6px; }
.vocab-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: #909399;
  margin-bottom: 8px;
}
.vocab-list { list-style: none; padding: 0; }
.vocab-list li {
  font-size: 0.84rem;
  padding: 3px 0 3px 14px;
  position: relative;
  line-height: 1.7;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
  /* 需双击标记重点，保持不可选中，避免误选中文本干扰双击 */
  cursor: pointer;
  -webkit-user-select: none;
  -moz-user-select: none;
  user-select: none;
}
.vocab-list li::before {
  content: "·";
  position: absolute;
  left: 0;
  color: #409eff;
  font-size: 0.9rem;
  top: 1px;
}
/* 双击标记为重点：标红内容加粗，红色更艳（#ff1f1f 比默认 #f56c6c 更艳） */
.vocab-list li.vocab-marked {
  color: #ff1f1f;
  font-weight: 700;
}
.vocab-list li.vocab-marked::before {
  color: #ff1f1f;
}

/* 重点集中卡片：顶部「重点」按钮弹出的只读卡片（与输入区同为 fixed 弹出、不随滚动），
   汇总所有被标记为重点的词汇项；红色系与重点标记一致；内容只读，不可在此修改标记。 */
.marked-panel {
  position: fixed;
  z-index: 210;
  /* 顶满整个网页（宽 100vw、高 100vh），不居中留边 */
  left: 0;
  top: 0;
  transform: none;
  width: 100vw;
  height: 100vh;
  max-height: none;
  background: #fff;
  border-radius: 10px;
  padding: 14px 16px;
  box-sizing: border-box;
  border: 1px solid #fde2e2;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.marked-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
}
.marked-header .section-title {
  margin-bottom: 0;
  color: #ff1f1f;
}
/* 只读标记：提示本卡片仅用于集中查看，重点的增删仍在原笔记卡片中双击进行 */
.readonly-tag {
  margin-left: 8px;
  font-size: 0.72rem;
  font-weight: 500;
  color: #909399;
  border: 1px solid #dcdfe6;
  border-radius: 3px;
  padding: 1px 6px;
  vertical-align: middle;
}
/* 卡片主体：左侧重点列表 + 右侧跳转边栏 */
.marked-body {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.marked-list {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
/* 右侧边栏：直接显示对应的原笔记卡片，只读，独立滚动 */
.marked-sidebar {
  /* 与左侧重点列表平分宽度 */
  flex: 1 1 0;
  width: auto;
  padding-left: 12px;
  border-left: 1px solid #fde2e2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  min-height: 0;
}
.sidebar-title {
  flex: 0 0 auto;
  font-size: 0.72rem;
  font-weight: 600;
  color: #909399;
}
/* 边栏内直接复用的笔记卡片结构：覆盖 .note-card 的双层内边距，给内容舒展空间 */
.sidebar-card.note-card {
  flex: 0 0 auto;
  padding: 16px 18px;
  margin-bottom: 0;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  overflow: visible;
}
/* 卡片内部各区块间距，避免挤成一团 */
.sidebar-card .card-header {
  margin-bottom: 14px;
}
.sidebar-card .english-text {
  margin-bottom: 12px;
  padding: 12px 14px;
}
.sidebar-card .chinese-text {
  margin-bottom: 12px;
  padding: 12px 14px;
}
.sidebar-card .vocab-section {
  margin-top: 10px;
}
.sidebar-card .vocab-list li {
  padding: 5px 0 5px 16px;
  line-height: 1.8;
}
.sidebar-subtitle {
  font-size: 0.86rem;
}
/* 左侧重点列表：不使用红色，采用中性灰色调，与右侧对应卡片区分 */
.marked-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.84rem;
  color: #303133;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 4px;
  line-height: 1.7;
  cursor: pointer;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
  /* 只读展示：允许选中复制文本（无双击交互，不必禁用选中） */
}
.marked-item:hover {
  background: #f5f7fa;
}
/* 左侧列表中当前在右侧边栏显示的笔记项：蓝色高亮（非红色） */
.marked-item.is-active {
  background: #ecf5ff;
  color: #409eff;
}
.marked-item.is-active .marked-badge {
  background: #409eff;
  color: #fff;
}
.marked-badge {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 600;
  color: #fff;
  background: #c0c4cc;
  border-radius: 3px;
  padding: 0 5px;
}
.marked-text {
  flex: 1;
  min-width: 0; /* 允许 flex 子项收缩，配合省略号生效 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.marked-empty {
  flex: 1;
  font-size: 0.82rem;
  color: #909399;
  margin: 4px 0 0;
}

/* Input area：作为独立悬浮卡片在顶部弹出，宽度仅撑满右侧笔记面板（46vw）、不随滚动 */
.input-section {
  position: fixed;
  z-index: 210;
  right: 16px;
  top: 56px;
  width: calc(46vw - 32px);
  background: #fff;
  border-radius: 10px;
  padding: 16px;
  box-sizing: border-box;
  border: 1px solid #e4e7ed;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 修改模式：保持宽度不变（右上贴边 46vw 卡片），仅高度顶满网页 */
.input-section.fullscreen {
  position: fixed;
  right: 16px;
  top: 56px;
  bottom: 16px;          /* 上下贴边，使卡片高度顶满网页（留出 16px 边距） */
  width: calc(46vw - 32px);
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  z-index: 210;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: 16px;
}
.raw-input {
  width: 100%;
  min-height: 160px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 10px 12px;
  font-size: 0.85rem;
  font-family: inherit;
  line-height: 1.7;
  color: #303133;
  background: #fff;
  resize: vertical;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
/* 修改模式下编辑区撑满整张卡片的剩余高度（输入框顶满网页） */
.raw-input.raw-input-full {
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
}
.raw-input:focus {
  outline: none;
  border-color: #409eff;
}
.btn-row { display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.btn {
  padding: 7px 18px;
  border-radius: 4px;
  border: none;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary { background: #409eff; color: #fff; }
.btn-primary:hover { background: #66b1ff; }
.btn-secondary { background: #f5f7fa; color: #606266; border: 1px solid #dcdfe6; }
.btn-secondary:hover { background: #e4e7ed; }
.btn-edit { background: #e6a23c; color: #fff; }
.btn-edit:hover { background: #ebb563; }

/* Empty state */
.empty-state {
  text-align: center;
  padding: 50px 20px;
  color: #909399;
}
.empty-state p { font-size: 0.86rem; }
</style>
