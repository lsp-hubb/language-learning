<template>
  <div class="note-root">
    <!-- 顶部常驻操作栏：位于滚动区域之外，固定不随滚动 -->
    <div class="top-actions">
      <el-button size="small" type="primary" @click="onTopAction">解析并渲染</el-button>
      <el-button size="small" type="warning" @click="showEdit">修改</el-button>
      <el-button size="small" @click="hideInput">关闭</el-button>
    </div>

    <!-- 导航：同样固定在滚动区域之外，紧贴操作栏下方 -->
    <nav v-if="notes.length" class="nav-bar" ref="navBar">
      <a v-for="(n, i) in notes" :key="i" :href="'#note-' + i" :data-text="'#' + (i + 1) + ' ' + n.subtitle"></a>
    </nav>

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
            <div class="card-header">
              <div class="badge">{{ i + 1 }}</div>
              <div class="card-subtitle" :data-text="n.subtitle"></div>
            </div>
            <div class="english-text" v-html="highlight(n.english)"></div>
            <div class="chinese-text" v-html="highlight(n.chinese)"></div>
            <div v-if="n.vocabItems.length" class="vocab-section">
              <div class="vocab-title">Vocabulary &amp; Expressions</div>
              <ul class="vocab-list">
                <li
                  v-for="(v, vi) in n.vocabItems"
                  :key="vi"
                  :class="{ 'vocab-marked': isMarked(i, v) }"
                  :title="isMarked(i, v) ? '双击取消重点' : '双击标记为重点'"
                  @dblclick="toggleMark(i, v)"
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
  </div>
</template>

<script>
export default {
  name: 'NotePanel',
  props: {
    articleId: { type: String, default: '' },
    noteSearch: { type: String, default: '' },
    noteSearchNonce: { type: Number, default: 0 }
  },
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
      currentMatch: -1      // 当前滚动定位到的匹配项位置（在 matchIndices 中的下标）
    }
  },
  computed: {
    // 当前定位到的匹配卡片实际索引（-1 表示无）
    currentCardIndex() {
      if (this.currentMatch < 0 || this.currentMatch >= this.matchIndices.length) return -1
      return this.matchIndices[this.currentMatch]
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
    this.bindNavWheel()
    this.bindEnterNav()
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this._enterNavHandler)
  },
  updated() {
    // notes 异步加载后 nav 才渲染，需在更新后补绑监听
    this.bindNavWheel()
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
    // 判断某个词汇项是否被标记为重点
    isMarked(noteIndex, v) {
      return !!this.marked[noteIndex + '__' + v]
    },
    // 双击切换词汇项重点标记（变红加粗），并持久化
    toggleMark(noteIndex, v) {
      const key = noteIndex + '__' + v
      this.marked[key] = !this.marked[key]
      this.saveMarked()
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
        // notes 更新后 nav 才渲染，下一帧补绑滚轮监听
        this.$nextTick(() => this.bindNavWheel())
      } catch (e) {
        console.warn('[NotePanel] 加载笔记失败', e)
      }
    },
    // 绑定导航栏横向快速滚动（幂等，避免重复绑定）
    bindNavWheel() {
      const nav = this.$refs.navBar
      if (!nav || nav.__navWheelBound) return
      nav.__navWheelBound = true
      nav.addEventListener('wheel', (e) => {
        const dx = e.deltaX
        const dy = e.deltaY
        if (dx === 0 && dy === 0) return
        e.preventDefault()
        // 放大系数让竖轮也能快速横向滚动
        nav.scrollLeft += (dx !== 0 ? dx : dy) * 6
      }, { passive: false })
    },
    // 绑定全局回车：有匹配项时回车滚动到下一个匹配卡片至中央
    bindEnterNav() {
      if (this._enterNavHandler) return
      this._enterNavHandler = (e) => {
        // 避免与输入区/文本编辑冲突（在输入框、textarea 内不拦截回车）
        const tag = (e.target && e.target.tagName || '').toLowerCase()
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return
        if (e.key === 'Enter' && this.matchIndices.length) {
          e.preventDefault()
          this.nextMatch()
        }
      }
      window.addEventListener('keydown', this._enterNavHandler)
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

/* Nav */
.nav-bar {
  flex: 0 0 auto;
  z-index: 100;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  padding: 8px 16px;
  overflow-x: auto;
  white-space: nowrap;
  scroll-behavior: smooth;
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.nav-bar::-webkit-scrollbar { display: none; }
.nav-bar a {
  display: inline-block;
  margin: 0 6px 0 0;
  padding: 5px 14px;
  border-radius: 4px;
  font-size: 0.82rem;
  color: #606266;
  text-decoration: none;
  border: 1px solid #dcdfe6;
  background: #fff;
  transition: all 0.2s;
  /* 防选中 + 防 Ctrl+F：文本改由 ::before 伪元素渲染，DOM 无文本节点 */
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
}
.nav-bar a::before {
  content: attr(data-text);
}
.nav-bar a:hover {
  color: #409eff;
  border-color: #409eff;
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
  border-color: #e6a23c;
  box-shadow: 0 0 0 1px rgba(230, 162, 60, 0.4);
}
/* 精确高亮命中文字段（类似浏览器 Ctrl+F 的黄底高亮） */
.note-hit {
  background: #ffe066;
  color: #333;
  border-radius: 2px;
  padding: 0 1px;
}
/* 当前定位到的匹配卡片：描边加深 */
.note-card.note-match.note-current {
  border-color: #f0a500;
  box-shadow: 0 0 0 2px rgba(240, 165, 0, 0.5);
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
  /* 防选中 + 防 Ctrl+F 查找：文本改由 ::before 伪元素渲染，
     DOM 中无文本节点，浏览器查找不搜索伪元素内容 */
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
}
.card-subtitle::before {
  content: attr(data-text);
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
  color: #303133;
  padding: 3px 0 3px 14px;
  position: relative;
  line-height: 1.7;
  font-family: "Microsoft YaHei", "微软雅黑", sans-serif;
}
.vocab-list li::before {
  content: "·";
  position: absolute;
  left: 0;
  color: #409eff;
  font-size: 0.9rem;
  top: 1px;
}
/* 双击标记为重点：变红加粗 */
.vocab-list li.vocab-marked {
  color: #f56c6c;
  font-weight: 700;
}
.vocab-list li.vocab-marked::before {
  color: #f56c6c;
}
.vocab-list li {
  cursor: pointer;
  user-select: none;
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
/* 修改模式：同样的顶部弹出卡片，宽度一致 */
.input-section.fullscreen {
  position: fixed;
  right: 16px;
  top: 56px;
  bottom: auto;
  width: calc(46vw - 32px);
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  z-index: 210;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
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
/* 修改模式下编辑区高度固定（卡片内不自适应撑满） */
.raw-input.raw-input-full {
  min-height: 240px;
  resize: vertical;
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
