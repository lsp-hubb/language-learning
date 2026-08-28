<template>
  <div class="note-root">
    <!-- 顶部常驻操作栏：位于滚动区域之外，固定不随滚动 -->
    <div class="top-actions">
      <button class="btn btn-primary" @click="onTopAction">解析并渲染</button>
      <button class="btn btn-edit" @click="showEdit">修改</button>
      <button class="btn btn-secondary" @click="hideInput">关闭</button>
    </div>

    <!-- 导航：同样固定在滚动区域之外，紧贴操作栏下方 -->
    <nav v-if="notes.length" class="nav-bar" ref="navBar">
      <a v-for="(n, i) in notes" :key="i" :href="'#note-' + i" :data-text="'#' + (i + 1) + ' ' + n.subtitle"></a>
    </nav>

    <!-- 可滚动内容区 -->
    <div class="scroll-area">
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
          <div v-for="(n, i) in notes" :key="i" class="note-card" :id="'note-' + i">
            <div class="card-header">
              <div class="badge">{{ i + 1 }}</div>
              <div class="card-subtitle" :data-text="n.subtitle"></div>
            </div>
            <div class="english-text">{{ n.english }}</div>
            <div class="chinese-text">{{ n.chinese }}</div>
            <div v-if="n.vocabItems.length" class="vocab-section">
              <div class="vocab-title">Vocabulary &amp; Expressions</div>
              <ul class="vocab-list">
                <li
                  v-for="(v, vi) in n.vocabItems"
                  :key="vi"
                  :class="{ 'vocab-marked': isMarked(i, v) }"
                  :title="isMarked(i, v) ? '双击取消重点' : '双击标记为重点'"
                  @dblclick="toggleMark(i, v)"
                >{{ v }}</li>
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
    articleId: { type: String, default: '' }
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
      marked: {}            // 重点标记状态（持久化在 localStorage），键为 `noteIndex__词汇文本`，值为 true
    }
  },
  watch: {
    articleId(val) {
      if (val) {
        this.loadMarked()
        this.loadNotes()
      }
    }
  },
  mounted() {
    if (this.articleId) this.loadMarked()
    if (this.articleId) this.loadNotes()
    this.bindNavWheel()
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

/* 顶部常驻操作栏：固定在滚动区域之外，不随滚动 */
.top-actions {
  flex: 0 0 auto;
  z-index: 110;
  background: #fff;
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e7ed;
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

/* Input area */
.input-section {
  background: #fff;
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 14px;
  border: 1px solid #e4e7ed;
}
/* 修改模式：输入区占满整个右侧区域 */
.input-section.fullscreen {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 50vw;
  margin: 0;
  border: none;
  border-left: 1px solid #e4e7ed;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  z-index: 200;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
}
.input-section.fullscreen .input-header,
.input-section.fullscreen .btn-row {
  flex-shrink: 0;
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
/* 修改模式下编辑区占满剩余全部高度 */
.raw-input.raw-input-full {
  flex: 1;
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
