<template>
  <div class="note-root">
    <!-- 顶部常驻操作栏：位于滚动区域之外，固定不随滚动 -->
    <div class="top-actions">
      <el-button size="small" type="primary" @click="onTopAction">解析并渲染</el-button>
      <el-button size="small" type="warning" @click="showEdit">修改</el-button>
      <el-button size="small" type="danger" :plain="!markedPanelVisible" @click="toggleMarkedPanel"
        >重点 {{ markedItems.length }}</el-button
      >
      <el-button size="small" @click="hideInput">关闭</el-button>
      <span
        v-if="sectionLabel"
        class="section-tag"
        :title="'当前为「' + sectionLabel + '」的笔记，切换题型即自动切换'"
        >{{ sectionLabel }} 笔记</span
      >
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
            :placeholder="
              mode === 'edit'
                ? '修改后按 Enter 保存修改，Shift+Enter 换行（或点「保存修改」）'
                : '输入后按 Enter 解析渲染，Shift+Enter 换行（或点「解析并渲染」）'
            "
            @keydown.enter="onEnterKey"
          ></textarea>
          <div class="btn-row">
            <button class="btn btn-primary" v-if="mode === 'edit'" @click="onParseClick">
              保存修改
            </button>
            <button class="btn btn-secondary" @click="hideInput">关闭</button>
          </div>
          <p v-if="saveError" class="save-error">保存失败：{{ saveError }}</p>
        </div>

        <!-- 笔记列表 -->
        <div v-if="notes.length" class="notes-container">
          <!-- 卡片内右键 = 进入「重新录入」；词汇项上的右键（复制）用 .stop 阻止冒泡，二者互不干扰 -->
          <div
            v-for="(n, i) in notes"
            :key="i"
            class="note-card"
            :class="{
              'note-match': isMatch(i),
              'note-current': i === currentCardIndex,
              'note-editing': editingIndex === i,
            }"
            :id="'note-' + i"
            @contextmenu.prevent="onCardRightClick(i, $event)"
          >
            <!-- 操作条只在编辑态出现：平时卡片保持干净，进入编辑靠右键 -->
            <div v-if="editingIndex === i" class="card-actions">
              <button class="card-btn card-btn-primary" :disabled="saving" @click="saveCardEdit">
                {{ saving ? '保存中…' : '保存' }}
              </button>
              <button class="card-btn" @click="cancelEdit">取消</button>
            </div>

            <!-- 编辑态：整块录入，交给 parseRaw 重新解析成卡片 -->
            <div v-if="editingIndex === i" class="card-edit">
              <textarea
                ref="editArea"
                v-model="editText"
                class="raw-input"
                rows="9"
                placeholder="整块录入本卡片内容，格式：&#10;1. 英文&#10;中文&#10;（词汇1\词汇2\…）"
                @keydown.enter="onEditEnterKey"
              ></textarea>
              <p class="edit-tip">
                一次录入一张：第 1 行英文、第 2 行中文、第 3
                行（词汇1\词汇2）。保存前自动做格式检测，异常不会写入。Enter 保存，Shift+Enter
                换行，Esc 取消。
              </p>
              <p v-if="saveError" class="save-error">{{ saveError }}</p>
            </div>

            <!-- 只读态：与原有展示一致 -->
            <template v-else>
              <!-- 英文行：按正文批注切分渲染（高亮 / 下划线），并与正文共用卡片交互 -->
              <div
                class="english-text"
                @mouseup="onEnglishMouseUp($event)"
                @contextmenu="onEnglishContextMenu($event)"
              >
                <template v-for="seg in englishSegments(n)" :key="seg.key"
                  ><span v-if="!seg.anns.length" v-html="highlight(seg.text)"></span
                  ><span
                    v-else
                    class="annotated"
                    :class="annotClasses(seg.anns)"
                    :style="annotStyle(seg.anns)"
                    :data-annot-id="annotIds(seg.anns)"
                    @mouseenter="onAnnotEnter($event, annotPrimary(seg.anns))"
                    @mouseleave="onAnnotLeave()"
                    @click.stop="onAnnotClick($event, annotPrimary(seg.anns))"
                    ><span v-html="highlight(seg.text)"></span></span
                ></template>
              </div>
              <div
                class="chinese-text"
                v-html="highlight(n.chinese)"
                @mouseup="onReverseSelect"
              ></div>
              <div v-if="n.vocabItems.length" class="vocab-section">
                <ul class="vocab-list">
                  <li
                    v-for="(v, vi) in n.vocabItems"
                    :key="vi"
                    :class="{ 'vocab-marked': isMarked(i, v) }"
                    @click="toggleMark(i, v)"
                    @contextmenu.prevent.stop="copyVocab(v, $event)"
                  >
                    <span v-html="highlight(v)"></span>
                  </li>
                </ul>
              </div>
            </template>
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
        <p v-else class="marked-empty">暂无重点，单击笔记卡片中的词汇项即可标记为重点</p>

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
                >
                  <span v-html="highlight(v)"></span>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </div>
    <!-- 笔记英文行右键 → 批注工具栏（与正文同款：黄色高亮 / 红色下划线） -->
    <AnnotToolbar
      :visible="noteAnnotToolbarVisible"
      :position="noteAnnotToolbarPos"
      @highlight="doAnnotate('highlight', '#FFEB3B')"
      @underline="doAnnotate('underline', '#e74c3c')"
    />
  </div>
</template>

<script>
import { getExpandedSelectionText, scrollToReaderHit } from '@/utils/selectionText'
import { normalizeQuotes } from '@/utils/normalizeQuotes'
import AnnotToolbar from '@/components/AnnotToolbar.vue'

// 英文行 → 正文落点的缓存。以 paragraphs 数组本身为键：
// 正文不变时 computed 引用稳定 → 命中缓存（避免每行每次渲染都去正文里搜一遍）；
// 正文一改 computed 重算、引用变化 → 自动失效。WeakMap 随正文数组一并回收。
const anchorCacheByParagraphs = new WeakMap()

export default {
  name: 'NotePanel',
  components: { AnnotToolbar },
  // 批注桥：由文章页（ArticlePage）注册，笔记英文行据此渲染正文已有的高亮 / 下划线，
  // 并复用同一套批注卡片交互；在笔记里做的批注也会落到正文对应位置
  inject: {
    annotationBridge: { default: null },
  },
  props: {
    articleId: { type: String, default: '' },
    // 当前考研题型（节）：仅考研文章非空，笔记/重点按节拆分；普通文章为空 → 不分节
    section: { type: String, default: '' },
    // 当前节的显示短名（如「完形填空」），仅考研非空，用于顶栏提示
    sectionLabel: { type: String, default: '' },
    noteSearch: { type: String, default: '' },
    noteSearchNonce: { type: Number, default: 0 },
    // 面板是否可见（由 App 的 v-show 同步传入）：隐藏态下 scrollTop 无法写入，
    // 需在变为可见时再恢复一次滚动位置
    visible: { type: Boolean, default: false },
  },
  // 反向联动：笔记中选中文字 → emit('reverse-select', 完整词) 让 App 更新正文高亮
  emits: ['reverse-select'],
  data() {
    return {
      rawText: '',
      notes: [], // 解析后用于展示的笔记数组（不入库）
      savedRaw: '', // 数据库中保存的生文本（修改时原样载入）
      inputVisible: false, // 文本输入区默认隐藏
      mode: 'add', // 'add' = 只追加；'edit' = 修改全部
      saving: false,
      saveError: '',
      marked: {}, // 重点标记状态（持久化在数据库 articles.marks），键为 `noteIndex__词汇文本`，值为 true
      matchIndices: [], // 匹配选中文本的卡片索引（用于高亮）
      currentMatch: -1, // 当前滚动定位到的匹配项位置（在 matchIndices 中的下标）
      readerHitIndex: -1, // 反向联动：当前定位到的正文命中下标（-1 表示尚未定位）
      markedPanelVisible: false, // 重点集中卡片是否展开
      activeNoteIndex: -1, // 重点卡片右侧边栏当前跳转到的笔记索引（-1 表示无）
      editingIndex: -1, // 当前正在重新录入的卡片索引（-1 表示无）
      editText: '', // 单卡片重新录入时的整块原文草稿（英文 / 中文 / 词汇）
      // ===== 笔记英文行批注（与正文互为镜像）=====
      noteAnnotToolbarVisible: false,
      noteAnnotToolbarPos: { x: 0, y: 0 },
      pendingAnnotateText: '', // 右击弹出工具栏时记录的待标注文本
    }
  },
  computed: {
    // 笔记面板滚动位置的存储键（按文章 + 考研题型节区分）
    noteScrollKey() {
      return `noteScroll:${this.articleId || ''}${this.section ? ':' + this.section : ''}`
    },
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
    },
  },
  watch: {
    articleId() {
      this.reloadAll()
    },
    // 切换考研题型（节）：重载该节的笔记与重点，并复位编辑态
    section() {
      this.reloadAll()
    },
    // 正文选中文本变化时：查找匹配项 → 高亮 → 滚动到第一个
    noteSearchNonce() {
      this.findMatches()
    },
    // 刷新后首次点「笔记」打开面板时补一次恢复：隐藏态下 scrollTop 写不进去，
    // loadNotes 里的那次恢复在面板仍隐藏时会失效
    visible(v) {
      if (v) this.restoreNoteScroll()
    },
  },
  mounted() {
    this.reloadAll()
    this.bindEnterNav()
    this.bindEscClose()
    // 点击别处收起笔记侧批注工具栏（与正文 onGlobalClick 同效）
    this._noteAnnotOutsideHandler = (e) => {
      if (!this.noteAnnotToolbarVisible) return
      const t = e.target
      if (t && t.closest && t.closest('.annot-toolbar')) return
      this.noteAnnotToolbarVisible = false
    }
    document.addEventListener('mousedown', this._noteAnnotOutsideHandler)
    // 笔记面板滚动位置记忆：滚动停止 200ms 后写入（节流，避免频繁写 localStorage）
    this._noteScrollHandler = () => {
      clearTimeout(this._noteScrollTimer)
      this._noteScrollTimer = setTimeout(() => this.persistNoteScroll(), 200)
    }
    if (this.$refs.scrollArea) {
      this.$refs.scrollArea.addEventListener('scroll', this._noteScrollHandler)
    }
    // 笔记英文行内的 e / w 快捷键：与正文同款（e = 黄色高亮、w = 红色下划线）。
    // 每次都以当前选区为准，故可连续对多处标注，不会重复标到同一处
    this._noteAnnotKeyHandler = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      const tag = ((t && t.tagName) || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return
      const k = (e.key || '').toLowerCase()
      if (k !== 'e' && k !== 'w') return
      if (!this.selectionInEnglishRow()) return
      e.preventDefault()
      e.stopPropagation()
      // 快捷键走自动填充：标注前查词，用释义自动填批注内容（与正文 e / w 一致）
      this.doAnnotate(
        k === 'e' ? 'highlight' : 'underline',
        k === 'e' ? '#FFEB3B' : '#e74c3c',
        true,
      )
    }
    document.addEventListener('keydown', this._noteAnnotKeyHandler)
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this._enterNavHandler)
    window.removeEventListener('keydown', this._escCloseHandler)
    if (this._noteAnnotOutsideHandler) {
      document.removeEventListener('mousedown', this._noteAnnotOutsideHandler)
    }
    if (this._noteAnnotKeyHandler) {
      document.removeEventListener('keydown', this._noteAnnotKeyHandler)
    }
    if (this._noteScrollHandler && this.$refs.scrollArea) {
      this.$refs.scrollArea.removeEventListener('scroll', this._noteScrollHandler)
    }
    if (this._noteScrollTimer) clearTimeout(this._noteScrollTimer)
  },
  methods: {
    // ===== 笔记面板滚动位置记忆 =====
    // 恢复：笔记渲染完成后回到上次位置（刷新 / 重进）
    restoreNoteScroll() {
      this.$nextTick(() => {
        const area = this.$refs.scrollArea
        if (!area) return
        let v = 0
        try {
          v = Number(localStorage.getItem(this.noteScrollKey) || 0) || 0
        } catch (e) {
          v = 0
        }
        if (!v) return
        area.scrollTop = v
        // 卡片尚未渲染完（内容高度不足）时写不进去，稍后补一次
        if (area.scrollTop === 0 && area.scrollHeight <= area.clientHeight) {
          setTimeout(() => {
            const a = this.$refs.scrollArea
            if (a) a.scrollTop = v
          }, 150)
        }
      })
    },
    // 保存：由滚动监听节流后调用
    persistNoteScroll() {
      const area = this.$refs.scrollArea
      if (!area) return
      try {
        localStorage.setItem(this.noteScrollKey, String(Math.round(area.scrollTop || 0)))
      } catch (e) {
        /* 忽略 */
      }
    },
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
      e.preventDefault() // 普通 Enter 不插入换行
      this.onParseClick() // 等价于点击对应按钮
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
      const text = this.normalizeQuotes(String(v || '').trim())
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
          'position:fixed;z-index:9999;left:' +
          (e.clientX + 8) +
          'px;top:' +
          (e.clientY + 8) +
          'px;background:rgba(0,0,0,.75);color:#fff;' +
          'padding:4px 10px;border-radius:4px;font-size:12px;pointer-events:none;'
        document.body.appendChild(tip)
        setTimeout(() => document.body.removeChild(tip), 1200)
      }
    },
    // 判断某个词汇项是否被标记为重点
    isMarked(noteIndex, v) {
      return !!this.marked[noteIndex + '__' + v]
    },
    // 单击切换词汇项重点标记（变红加粗），并持久化到数据库
    toggleMark(noteIndex, v) {
      const key = noteIndex + '__' + v
      // 整体替换 marked 对象，确保 Vue2 响应式更新（直接加 key 或 $set 在个别打包下不触发）
      const next = Object.assign({}, this.marked)
      next[key] = !this.marked[key]
      this.marked = next
      this.saveMarked(next)
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
    // 切换文章 / 题型（节）时统一重载：复位编辑态，按当前节重载笔记与重点标记
    reloadAll() {
      if (!this.articleId) return
      // 复位残留的编辑 / 选中态，避免串到另一个节
      this.inputVisible = false
      this.mode = 'add'
      this.rawText = ''
      this.editingIndex = -1
      this.editText = ''
      this.activeNoteIndex = -1
      this.markedPanelVisible = false
      this.matchIndices = []
      this.currentMatch = -1
      this.loadMarked()
      this.loadNotes()
    },
    // 从数据库加载当前文章已保存的重点标记（考研按节拆分）
    async loadMarked() {
      if (!this.articleId) return
      const q = this.section ? '?section=' + encodeURIComponent(this.section) : ''
      try {
        const res = await fetch(`/api/articles/${this.articleId}/marks${q}`)
        if (!res.ok) return
        const data = await res.json()
        const marks = data && data.data ? data.data : {}
        const rawMarks = marks && typeof marks === 'object' ? marks : {}
        // 重点标记的键含词汇文本：旧数据里的 ’ 也要清洗，否则词汇归一后标记会失配丢失
        const cleanedMarks = {}
        let changed = false
        Object.keys(rawMarks).forEach((k) => {
          const ck = this.normalizeQuotes(k)
          if (ck !== k) changed = true
          cleanedMarks[ck] = rawMarks[k]
        })
        this.marked = cleanedMarks
        if (changed) this.saveMarked(cleanedMarks)
      } catch (e) {
        this.marked = {}
        console.warn('[NotePanel] 加载重点标记失败', e)
      }
    },
    // 将当前重点标记持久化到数据库（按 articleId 区分），marks 为要保存的对象
    async saveMarked(marks) {
      if (!this.articleId) return
      const payload = marks || this.marked
      const q = this.section ? '?section=' + encodeURIComponent(this.section) : ''
      try {
        await fetch(`/api/articles/${this.articleId}/marks${q}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marks: payload }),
        })
      } catch (e) {
        console.warn('[NotePanel] 保存重点标记失败', e)
      }
    },
    // 从数据库加载已保存的生文本，并解析为展示用笔记数组（考研按节拆分）
    async loadNotes() {
      if (!this.articleId) return
      const q = this.section ? '?section=' + encodeURIComponent(this.section) : ''
      try {
        const res = await fetch(`/api/articles/${this.articleId}/notes${q}`)
        if (!res.ok) return
        const data = await res.json()
        const raw = data && data.data
        this.savedRaw = typeof raw === 'string' ? raw : ''
        // 已入库数据清洗：旧数据若含 ’，清洗后静默回写（不进入 saving 态、不弹保存错误）
        const cleaned = this.normalizeQuotes(this.savedRaw)
        if (cleaned !== this.savedRaw) {
          this.savedRaw = cleaned
          try {
            await fetch(`/api/articles/${this.articleId}/notes${q}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ notes: cleaned }),
            })
          } catch (err) {
            console.warn('[NotePanel] 回写清洗后的笔记失败', err)
          }
        }
        this.notes = this.parseRaw(this.savedRaw)
        // 笔记渲染完成后回到上次滚动位置（刷新 / 重进）
        this.restoreNoteScroll()
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
        const tag = ((e.target && e.target.tagName) || '').toLowerCase()
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
    // ESC 键：正在重新录入时先取消编辑，否则退出重点集中卡片
    bindEscClose() {
      if (this._escCloseHandler) return
      this._escCloseHandler = (e) => {
        if (e.key !== 'Escape') return
        // 编辑态优先：Esc 取消本次重新录入
        if (this.editingIndex >= 0) {
          this.cancelEdit()
          return
        }
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
    // 统一清洗：委托 src/utils/normalizeQuotes —— 弯单引号 ‘ ’ → '、弯双引号 “ ” → "（含 HTML 实体）。
    // 输入（落库前）、输出（展示 / 复制）、已入库数据三处都调用，保证库里库外一致。
    // 必须委托统一实现：本地若只处理 ’ 会漏掉 “ ”，导致笔记里的中文双引号不被归一。
    normalizeQuotes(s) {
      return normalizeQuotes(s)
    },
    // 转义 HTML，防止原始文本被当作标签
    escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    },
    // 在文本中高亮命中的搜索片段（返回 v-html 用的 HTML），仅高亮匹配文字段
    highlight(text) {
      // 搜索词同样清洗：正文选中可能带 ’，与已归一为 ' 的笔记才能匹配上
      const q = this.normalizeQuotes((this.noteSearch || '').trim().toLowerCase())
      // 输出侧清洗：展示前把 ’ 归一为 '（库里已清洗，此处兜底）
      text = this.normalizeQuotes(text)
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
        out.push(
          '<mark class="note-hit">' + this.escapeHtml(text.slice(idx, idx + q.length)) + '</mark>',
        )
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
      const count = new Set(Array.from(marks).map((m) => Number(m.getAttribute('data-hit-index'))))
        .size
      if (!count) return false
      // 从 -1 起首次回车跳到第一个，之后循环向后
      this.readerHitIndex = (this.readerHitIndex + 1) % count
      scrollToReaderHit(body, this.readerHitIndex, '.reader .reader-content')
      return true
    },
    // 查找所有匹配选中文本的卡片
    findMatches() {
      const text = this.normalizeQuotes((this.noteSearch || '').trim().toLowerCase())
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
          const target =
            area.scrollTop + (elRect.top - areaRect.top) - (area.clientHeight - elRect.height) / 2
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
        const lines = block
          .trim()
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l)
        if (lines.length === 0) return
        const english = this.normalizeQuotes(lines[0].replace(/^\d+\.\s*/, ''))
        const chinese = this.normalizeQuotes(lines[1] || '')
        const vocabLines = lines.slice(2).filter((l) => l.startsWith('（') || l.startsWith('('))
        let vocabRaw = ''
        if (vocabLines.length) {
          vocabRaw = this.normalizeQuotes(
            vocabLines
              .join(' ')
              .replace(/^[（(]|[）)]$/g, '')
              .trim(),
          )
        }
        const subtitle = this.buildSubtitle(english)
        const vocabItems = vocabRaw
          ? vocabRaw
              .split('\\')
              .map((s) => this.normalizeQuotes(s.trim()))
              .filter((s) => s)
          : []
        notes.push({ english, chinese, vocabItems, subtitle })
      })
      return notes
    },
    // 解析 rawText 并合入 notes（根据 mode 决定追加 / 覆盖），仅用于即时预览
    parseAndRender() {
      const parsed = this.parseRaw((this.rawText || '').trim())
      if (this.mode === 'edit') {
        this.notes = parsed // 修改模式：整体覆盖
      } else {
        this.notes = this.notes.concat(parsed) // 添加模式：只追加，不覆盖已有
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
        toSave = this.savedRaw ? this.savedRaw + '\n\n' + newRaw : newRaw
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
    // 保存生文本到数据库（不做任何文本处理，原样存储）；返回是否保存成功
    async saveNotes(text) {
      if (!this.articleId) return false
      this.saving = true
      this.saveError = ''
      const q = this.section ? '?section=' + encodeURIComponent(this.section) : ''
      // 输入侧清洗：落库前把 ’ 归一为 '，保证入库即干净
      const cleaned = this.normalizeQuotes(text)
      try {
        const res = await fetch(`/api/articles/${this.articleId}/notes${q}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: cleaned }),
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        this.savedRaw = cleaned
        return true
      } catch (e) {
        this.saveError = e.message || '未知错误'
        console.error('[NotePanel] 保存笔记失败', e)
        return false
      } finally {
        this.saving = false
      }
    },
    // ===== 单卡片「重新录入」：整块录入原文，由程序解析 =====
    // 卡片内右键进入编辑。词汇项 <li> 的右键（复制）已用 .stop 阻止冒泡，不会走到这里
    onCardRightClick(i, e) {
      const target = e && e.target
      const tag = ((target && target.tagName) || '').toLowerCase()
      // 编辑态下：输入框内的右键交还浏览器（方便粘贴），也不重置正在编辑的内容
      if (tag === 'textarea' || tag === 'input' || (target && target.isContentEditable)) return
      if (this.editingIndex === i) return
      // 卡片内已选中文字时，右键交还浏览器（便于复制），不进入编辑
      const sel = window.getSelection && window.getSelection()
      if (sel && String(sel.toString() || '').trim()) return
      this.startEdit(i)
    },
    // 进入编辑：把该卡片还原成整块原文（编号. 英文 / 中文 /（词汇））填入编辑区
    startEdit(i) {
      const n = this.notes[i]
      if (!n) return
      this.saveError = ''
      this.editingIndex = i
      this.editText = this.serializeNote(n, i)
      // 编辑区渲染后自动聚焦，点开即可直接录入
      this.$nextTick(() => {
        const ref = this.$refs.editArea
        const el = Array.isArray(ref) ? ref[0] : ref
        if (el && el.focus) el.focus()
      })
    },
    // 放弃本次重新录入
    cancelEdit() {
      this.editingIndex = -1
      this.editText = ''
      this.saveError = ''
    },
    // 单卡片录入区按键：Enter 直接保存，Shift+Enter 仅换行（与顶部输入区 onEnterKey 一致）
    onEditEnterKey(e) {
      if (e.shiftKey) return // Shift+Enter 换行，不拦截
      e.preventDefault() // 普通 Enter 不插入换行
      this.saveCardEdit()
    },
    // 录入内容的格式检测：返回错误说明（空字符串表示通过）。
    // 单卡片录入的格式错误会随整篇序列化扩散到后续所有卡片，故保存前必须先拦住。
    validateCardInput(text) {
      const blocks = text.split(/\n(?=\d+\.\s?)/).filter((b) => b.trim())
      if (!blocks.length) return '未能识别卡片内容：第 1 行应为「编号. 英文」'
      if (blocks.length > 1) {
        return `检测到 ${blocks.length} 个编号块，一次只能录入一张卡片（英文中若含「数字. 」请改写）`
      }
      const lines = blocks[0]
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l)
      if (lines.length < 2) return '至少两行：第 1 行英文、第 2 行中文'
      if (!lines[0].replace(/^\d+\.\s*/, '')) return '第 1 行英文为空'
      if (!lines[1]) return '第 2 行中文不能为空（缺失会让词汇行被当成中文，导致后续解析错位）'
      // 词汇行必须以（开头、以）结尾，否则会被静默丢弃或与中文错位
      const vocabLines = lines.slice(2)
      for (let k = 0; k < vocabLines.length; k++) {
        const l = vocabLines[k]
        if (!/^[（(]/.test(l)) return `词汇行必须以（开头：${l.slice(0, 16)}…`
        if (!/[）)]$/.test(l)) return `词汇行必须以）结尾：…${l.slice(-16)}`
      }
      return ''
    },
    // 保存重新录入：解析编辑区整块原文 → 替换原卡片 → 清空本卡片重点标记 → 整体落库
    async saveCardEdit() {
      const i = this.editingIndex
      if (i < 0) return
      const text = (this.editText || '').trim()
      // ① 录入内容自身的格式检测：先给出具体、可对照修改的提示
      const err = this.validateCardInput(text)
      if (err) {
        this.saveError = err
        return
      }
      const parsed = this.parseRaw(text)
      if (!parsed.length) {
        this.saveError = '未能解析出卡片内容，请检查格式：首行应为「编号. 英文」'
        return
      }
      const backup = this.notes.slice()
      const next = this.notes.slice()
      next.splice(i, 1, ...parsed)
      // ② 整篇回环检测：单卡片出错会随整篇序列化污染后续卡片，
      //    故替换后重新序列化 → 再解析一遍，确认整篇结构没有被这次录入带偏。
      //    （用编辑前后的卡片数对比，可避免历史数据本身不自洽造成误判）
      const beforeCount = this.parseRaw(this.serializeNotes(backup)).length
      const afterText = this.serializeNotes(next)
      const afterCount = this.parseRaw(afterText).length
      if (afterCount !== beforeCount) {
        this.saveError = `格式检测未通过：本次录入会让整篇解析出的卡片数由 ${beforeCount} 变为 ${afterCount}，已撤销。请检查是否误含「数字. 」开头的行`
        return
      }
      const reparsed = this.parseRaw(afterText)
      const r = reparsed[i]
      const sameVocab =
        !!r && (r.vocabItems || []).join('|') === (parsed[0].vocabItems || []).join('|')
      if (!r || r.english !== parsed[0].english || r.chinese !== parsed[0].chinese || !sameVocab) {
        this.saveError =
          '格式检测未通过：重新解析后本卡片内容不一致，已撤销。请检查中文是否为空、词汇行是否用（…）包裹'
        return
      }
      this.notes = next
      // 重建重点标记：
      // - 当前重新录入的这张卡片：其原有重点标记全部清空（内容已换，旧标记不再有意义）
      // - 其余卡片：标记原样保留，仅按卡片增减数量整体位移索引
      // - 重建后的结果会随 saveMarked 落库，清空与保留都会持久化
      const added = parsed.length - 1
      const marks = {}
      Object.keys(this.marked).forEach((key) => {
        const sep = key.indexOf('__')
        if (sep < 0) return
        const idx = Number(key.slice(0, sep))
        const vocab = key.slice(sep + 2)
        if (Number.isNaN(idx)) return
        if (idx === i) return // 本卡片：清空，不再保留
        if (idx < i) {
          marks[key] = true // 前面的卡片索引不变
        } else {
          marks[idx + added + '__' + vocab] = true // 后面的卡片整体后移
        }
      })
      this.marked = marks
      const ok = await this.saveNotes(this.serializeNotes(this.notes))
      if (!ok) return // 保存失败时保持编辑态，便于修正后重试
      await this.saveMarked(marks)
      // 以库里生文本重新解析，保证展示与存储完全一致
      this.notes = this.parseRaw(this.savedRaw)
      this.editingIndex = -1
      this.editText = ''
    },
    // 单个笔记对象 → 生文本块（编号取 index+1），与 parseRaw 互逆
    serializeNote(n, index) {
      const lines = [index + 1 + '. ' + (n.english || ''), n.chinese || '']
      const vocab = (n.vocabItems || []).filter((s) => s)
      if (vocab.length) lines.push('（' + vocab.join('\\') + '）')
      return lines.join('\n')
    },
    // 全部笔记 → 生文本（块之间空行分隔），与 parseRaw 互逆
    serializeNotes(notes) {
      return (notes || []).map((n, i) => this.serializeNote(n, i)).join('\n\n')
    },
    // 由英文生成卡片副标题（取前 6 个词），parseRaw 与编辑保存共用
    buildSubtitle(english) {
      const words = String(english || '').split(' ')
      const head = words.slice(0, 6).join(' ')
      return head.replace(/[,;:]$/, '') + (words.length > 6 ? '…' : '')
    },

    // ===== 笔记英文行 ↔ 正文批注 互为镜像 =====
    // 归一化仅用于匹配：忽略大小写与弯 / 直角引号差异（等长替换，保证偏移可直接使用）
    normKey(s) {
      // 双引号同样归一：正文选中可能带 “ ”，而笔记里已归一为 "，不归一就匹配不上
      return String(s == null ? '' : s)
        .toLowerCase()
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
    },
    // 当前生效的批注桥（文章页注册后才有）
    // 注意：Options API 的 inject 会自动解包 ref，this.annotationBridge 已是桥梁对象本身，
    // 不能再取 .value（桥内部的 annotations 仍是 ref，故需 .value）
    bridge() {
      return this.annotationBridge || null
    },
    // 批注列表：兼容 ref 与已解包两种形态（不同环境下 inject 的解包深度不同）
    bridgeAnns() {
      const b = this.bridge()
      if (!b || !b.annotations) return []
      const a = b.annotations
      return Array.isArray(a) ? a : a.value || []
    },
    // 当前选区是否落在笔记英文行内（e / w 快捷键与右键工具栏据此生效）
    selectionInEnglishRow() {
      const sel = window.getSelection && window.getSelection()
      if (!sel || sel.isCollapsed || !sel.anchorNode) return false
      const n = sel.anchorNode
      const el = n.nodeType === 1 ? n : n.parentElement
      return !!(el && el.closest && el.closest('.note-root .english-text'))
    },
    // 英文行在正文中的落点（带缓存）：{ paragraphIndex, startOffset, ... }
    lineAnchor(text) {
      if (!text) return null
      const b = this.bridge()
      if (!b || !b.findTextInParagraphs) return null
      const paras = b.paragraphs ? b.paragraphs.value : null
      if (!paras) return b.findTextInParagraphs(text)
      let m = anchorCacheByParagraphs.get(paras)
      if (!m) {
        m = new Map()
        anchorCacheByParagraphs.set(paras, m)
      }
      if (m.has(text)) return m.get(text)
      const anchor = b.findTextInParagraphs(text)
      m.set(text, anchor)
      return anchor
    },
    // 选区在英文行内 → 正文坐标：本行在正文中的落点 + 选区在行内的偏移。
    // 与 englishSegments 的「显示」同源（同一套 lineAnchor + 行内偏移），
    // 标注与显示用的是同一个坐标，笔记不再各算一套、也不靠文本匹配。
    // 返回 null 表示当前无选区 / 选区不在英文行内 / 本行在正文定位不到。
    selectionRangeInEnglishRow() {
      const sel = window.getSelection && window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null
      const node = sel.anchorNode
      const el = node && node.nodeType === 1 ? node : node && node.parentElement
      const rowEl = el && el.closest ? el.closest('.english-text') : null
      if (!rowEl) return null
      const full = rowEl.textContent || ''
      const range = sel.getRangeAt(0)
      // 用整行内容量取选区两端偏移（多个 span 切分不影响总文本长度）
      const measure = (n, o) => {
        const r = document.createRange()
        r.selectNodeContents(rowEl)
        r.setEnd(n, o)
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
      // 去掉首尾空白（选区可能多选了空格 / 换行）
      while (s < e && /\s/.test(full[s])) s++
      while (e > s && /\s/.test(full[e - 1])) e--
      if (e <= s) return null
      const anchor = this.lineAnchor(full)
      if (!anchor) return null
      return {
        paragraphIndex: anchor.paragraphIndex,
        startOffset: anchor.startOffset + s,
        endOffset: anchor.startOffset + e,
        text: full.slice(s, e),
      }
    },
    // 英文行按批注切分：与正文 ArticleReader 一样用「坐标」，而不是靠文本匹配猜位置。
    // 先定位本行在正文中的落点，再把批注区间投影到本行 —— 叠加 / 包含 /
    // 同一文本多处出现都能精确表达，不再有 indexOf 的歧义（这是此前孪生错位的根因）。
    englishSegments(n) {
      const text = n && n.english ? n.english : ''
      if (!text) return []
      const anns = this.bridgeAnns()
      if (!anns.length) return [{ text, anns: [], start: 0, key: 't0' }]
      const hits = []
      // 本行在正文中的落点（normKey 只做等长替换，偏移可直接用）
      const anchor = this.lineAnchor(text)
      if (anchor) {
        const base = anchor.startOffset
        for (const a of anns) {
          if (a.paragraphIndex !== anchor.paragraphIndex) continue
          // 与本行取交集：批注跨出行边界时只保留落在行内的那一段
          const s = Math.max(0, a.startOffset - base)
          const e = Math.min(text.length, a.endOffset - base)
          if (e <= s) continue
          hits.push({ ann: a, start: s, end: e })
        }
      }
      if (!hits.length) {
        // 回退：本行在正文中定位不到（笔记自行改写 / 跨段 / 正文已改动），仍按文本匹配
        const key = this.normKey(text)
        for (const a of anns) {
          const k = this.normKey(a.text)
          if (!k) continue
          const idx = key.indexOf(k)
          if (idx === -1) continue
          hits.push({ ann: a, start: idx, end: idx + k.length })
        }
      }
      if (!hits.length) return [{ text, anns: [], start: 0, key: 't0' }]
      // 按所有边界点切分，支持高亮与下划线在同一处叠加
      const pts = new Set([0, text.length])
      for (const h of hits) {
        pts.add(h.start)
        pts.add(h.end)
      }
      const sorted = [...pts].sort((x, y) => x - y)
      const segs = []
      for (let i = 0; i < sorted.length - 1; i++) {
        const start = sorted[i]
        const end = sorted[i + 1]
        if (start >= end) continue
        const covering = hits.filter((h) => h.start <= start && h.end >= end)
        // key 编码覆盖本段的全部批注 id：叠加 / 删除批注会改变覆盖集合，
        // 从而生成新 key 强制重建 DOM，避免沿用旧节点导致样式不刷新（要刷新页面才显示）
        const key = covering.length
          ? 'a' + start + '_' + covering.map((h) => h.ann.id).join(',')
          : 't' + start
        segs.push({ text: text.slice(start, end), anns: covering.map((h) => h.ann), start, key })
      }
      return segs
    },
    // 片段样式类：与正文一致（highlight / underline 可同时存在）
    annotClasses(anns) {
      return [...new Set((anns || []).map((a) => a.type))]
    },
    // 高亮取批注自身颜色（与正文一致）
    annotStyle(anns) {
      const h = (anns || []).find((a) => a.type === 'highlight')
      return h && h.color ? { backgroundColor: h.color } : {}
    },
    // 一处叠了多个批注时高亮优先（与正文 pMap 一致），用于卡片弹出
    annotPrimary(anns) {
      const list = (anns || []).slice()
      if (!list.length) return null
      // 最近新建的那条优先（与正文 buildParagraphSegments 一致）：
      // 否则「在高亮中标下划线」时新建的是下划线，而按 highlight > underline 取到的
      // 仍是已存在的高亮，刚建的那条就永远轮不到卡片交互
      const b = this.bridge()
      const rid = b && b.recentAnnotId ? b.recentAnnotId.value : ''
      const recent = rid && list.find((a) => a.id === rid)
      if (recent) return recent
      const pMap = { highlight: 3, underline: 2 }
      return list.sort((a, b) => (pMap[b.type] || 0) - (pMap[a.type] || 0))[0] || null
    },
    // 片段对应的批注 id（空格分隔，含叠加的全部批注）：写入 data-annot-id。
    // 只写优先级最高的那条时，被压在下面的那条在 DOM 里没有落点，
    // 新建 / 切换 / 连续删除时按 id 找不到元素，卡片就不会弹出（或跑到兜底位置）。
    annotIds(anns) {
      return (anns || [])
        .map((a) => a.id)
        .filter(Boolean)
        .join(' ')
    },
    // 选区落在笔记英文行中的哪条已有批注内：取覆盖批注里「正文区间最长」的那条。
    // 交给 annotateText 在它的正文区间内定位 —— 与「正文 → 笔记」方向同一套包含关系，
    // 否则正文里多处出现同一文本时一律取第一处，笔记里标的位置会和正文对不上
    outerAnnotId() {
      const sel = window.getSelection && window.getSelection()
      if (!sel || !sel.anchorNode) return ''
      const node = sel.anchorNode
      const el = node.nodeType === 1 ? node : node.parentElement
      const span = el && el.closest ? el.closest('.annotated') : null
      if (!span) return ''
      const ids = (span.dataset.annotId || '').split(/\s+/).filter(Boolean)
      if (!ids.length) return ''
      const matched = this.bridgeAnns().filter((a) => ids.includes(a.id))
      if (!matched.length) return ''
      return matched
        .slice()
        .sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset))[0].id
    },
    onAnnotEnter(e, a) {
      const b = this.bridge()
      if (b && b.onAnnotMouseEnter && a) b.onAnnotMouseEnter(e, a)
    },
    onAnnotLeave() {
      const b = this.bridge()
      if (b && b.onAnnotMouseLeave) b.onAnnotMouseLeave()
    },
    onAnnotClick(e, a) {
      const b = this.bridge()
      if (b && b.onAnnotClick && a) b.onAnnotClick(e, a)
    },
    // 英文行左键松手：保留原有反向联动，并与正文一致地触发查词
    onEnglishMouseUp(e) {
      this.onReverseSelect()
      const b = this.bridge()
      if (!b || !b.onTextSelection) return
      const text = getExpandedSelectionText()
      if (text) b.onTextSelection(e.clientX, e.clientY)
    },
    // 英文行右键：与正文一致，弹出批注工具栏（黄色高亮 / 红色下划线）
    onEnglishContextMenu(e) {
      const b = this.bridge()
      const text = getExpandedSelectionText()
      if (!b || !text) return
      e.preventDefault()
      this.pendingAnnotateText = text
      let r = { left: e.clientX, top: e.clientY, width: 0 }
      const sel = window.getSelection && window.getSelection()
      if (sel && sel.rangeCount) r = sel.getRangeAt(0).getBoundingClientRect()
      this.noteAnnotToolbarPos = { x: r.left + r.width / 2, y: r.top }
      this.noteAnnotToolbarVisible = true
    },
    // 当前选区（英文行内）是否与已有高亮批注重叠：下划线禁止落在高亮区域上。
    // 优先用坐标路径（selectionRangeInEnglishRow 与显示同源）；本行未在正文定位到时
    // 回退文本匹配，判断选中文本是否落在某条高亮文本之内。
    hasHighlightOverlap() {
      const anns = this.bridgeAnns()
      if (!anns.length) return false
      const range = this.selectionRangeInEnglishRow()
      if (range) {
        return anns.some(
          (a) =>
            a.type === 'highlight' &&
            a.paragraphIndex === range.paragraphIndex &&
            a.startOffset < range.endOffset &&
            a.endOffset > range.startOffset,
        )
      }
      const sel = window.getSelection && window.getSelection()
      if (!sel || sel.isCollapsed) return false
      const text = getExpandedSelectionText()
      if (!text) return false
      const key = this.normKey(text)
      return anns.some((a) => a.type === 'highlight' && key && this.normKey(a.text).includes(key))
    },
    // autoFill：是否用查词结果自动填充批注内容（笔记侧 e / w 快捷键为 true，与正文快捷键一致；
    // 右键工具栏为 false，与正文工具栏一致）
    async doAnnotate(type, color, autoFill = false) {
      const b = this.bridge()
      const pos = { ...this.noteAnnotToolbarPos }
      this.noteAnnotToolbarVisible = false
      // 以「当前选区」为准：右键记录的文本可能已过时，每次都重新读取，
      // 否则第二次会沿用上一次的文本，导致反复标到同一处内容上
      const text = getExpandedSelectionText() || this.pendingAnnotateText
      this.pendingAnnotateText = ''
      // 失败一律给出可见提示，便于定位是「通道未就绪」「没选中」还是「正文搜不到」
      if (!b) {
        this.showTip('批注通道未就绪（文章页未就绪），请刷新页面重试', ...this.tipAt(pos))
        return
      }
      if (!text) {
        this.showTip('请先在英文行中选中要标注的文本', ...this.tipAt(pos))
        return
      }
      // 下划线禁止落在已有高亮区域上：标注区内若已有高亮则不允许叠加下划线
      if (type === 'underline' && this.hasHighlightOverlap()) {
        this.showTip('该区域已有高亮，不能叠加下划线', ...this.tipAt(pos))
        return
      }
      // 首选：把选区换算成正文坐标，直接在正文里标注（无文本匹配，与显示同源）。
      // 换算失败（如本行在正文定位不到）才回退文本匹配，保证仍能标注。
      let created = null
      const range = this.selectionRangeInEnglishRow()
      if (b.annotateRange && range) {
        created = await b.annotateRange(range, type, color, autoFill)
      } else if (b.annotateText) {
        created = await b.annotateText(text, type, color, autoFill, this.outerAnnotId())
      }
      if (!created) {
        const found = b.findTextInParagraphs ? b.findTextInParagraphs(text) : null
        const brief = text.length > 14 ? text.slice(0, 14) + '…' : text
        this.showTip(
          found ? '该处已有同种标注' : `正文中未找到「${brief}」，无法标注`,
          ...this.tipAt(pos),
        )
        return
      }
      // 卡片定位到笔记里刚标注的词旁：等笔记行重渲染出该批注的 span；
      // 渲染慢一拍时补定位一次，仍找不到就退到选区位置，避免卡片跑到正文处
      this.$nextTick(() => {
        if (this.locateCard(created, autoFill)) return
        setTimeout(() => {
          if (this.locateCard(created, autoFill)) return
          const b2 = this.bridge()
          if (b2 && b2.showCardAt) b2.showCardAt(created, ...this.tipAt(null), autoFill)
        }, 80)
      })
    },
    // 把卡片定位到笔记里该批注所在的词旁；返回是否定位成功。
    // autoFill 透传给 showCardAt：右键 / 工具栏标注（false）时卡片立即聚焦输入框，
    // 与正文工具栏标注行为一致；e / w 快捷键（true，已自动填充）则不强制聚焦
    locateCard(annotation, autoFill) {
      const b = this.bridge()
      if (!b || !b.showCardAt) return true
      // ~= 匹配空格分隔的某一个 id：叠加处该属性含多条批注的 id
      const el = this.$el.querySelector(`[data-annot-id~="${annotation.id}"]`)
      if (!el) return false
      const r = el.getBoundingClientRect()
      b.showCardAt(annotation, r.left, r.bottom, autoFill)
      return true
    },
    // 提示位置：优先工具栏位置 → 选区位置 → 屏幕上方居中（快捷键路径没有工具栏坐标）
    tipAt(pos) {
      if (pos && (pos.x || pos.y)) return [pos.x, pos.y]
      const sel = window.getSelection && window.getSelection()
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).getBoundingClientRect()
        if (r.left || r.top) return [r.left + r.width / 2, r.top]
      }
      return [Math.max(160, window.innerWidth / 2), 120]
    },
    // 轻提示：在指定位置短暂显示一段文字（与复制提示同款）
    showTip(msg, x, y) {
      const tip = document.createElement('div')
      tip.textContent = msg
      tip.style.cssText =
        'position:fixed;z-index:9999;left:' +
        (x + 8) +
        'px;top:' +
        (y + 8) +
        'px;background:rgba(0,0,0,.75);color:#fff;' +
        'padding:4px 10px;border-radius:4px;font-size:12px;pointer-events:none;'
      document.body.appendChild(tip)
      setTimeout(() => document.body.removeChild(tip), 1600)
    },
  },
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
  font-family:
    -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial,
    sans-serif;
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
/* 当前节标签：仅考研文章显示，提示笔记按题型拆分 */
.section-tag {
  margin-left: auto;
  font-size: 0.76rem;
  color: #1f6ea8;
  background: #ecf5ff;
  border: 1px solid #d9ecff;
  border-radius: 4px;
  padding: 2px 8px;
  white-space: nowrap;
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
.input-header .section-title {
  margin-bottom: 0;
}
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
  font-size: 1rem;
  color: #1f2329;
  margin-bottom: 10px;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  border-left: 3px solid #409eff;
  font-family: 'Microsoft YaHei', '微软雅黑', sans-serif;
  text-align: justify;
}
.chinese-text {
  font-size: 1rem;
  color: #303330;
  margin-bottom: 10px;
  padding: 10px 12px;
  background: #fafbfc;
  border-radius: 4px;
  border-left: 3px solid #3cbf1b;
  font-family: 'Microsoft YaHei', '微软雅黑', sans-serif;
  text-align: justify;
}
/* 英文/中文区域内鼠标选中文本时，选中态颜色用匹配高亮同款蓝色（#409eff） */
.english-text::selection,
.chinese-text::selection {
  background: #409eff;
  color: #fff;
}

.vocab-section {
  margin-top: 6px;
}
.vocab-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: #909399;
  margin-bottom: 8px;
}
.vocab-list {
  list-style: none;
  padding: 0;
}
.vocab-list li {
  font-size: 1rem;
  padding: 4px 0 4px 16px;
  position: relative;
  line-height: 1.75;
  font-family: 'Microsoft YaHei', '微软雅黑', sans-serif;
  /* 单击即可标记重点，保持不可选中，避免点击时误选中文本 */
  cursor: pointer;
  -webkit-user-select: none;
  -moz-user-select: none;
  user-select: none;
}
.vocab-list li::before {
  content: '·';
  position: absolute;
  left: 0;
  color: #409eff;
  font-size: 1rem;
  top: 1px;
}
/* 单击标记为重点：标红内容加粗，红色更艳（#ff1f1f 比默认 #f56c6c 更艳） */
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
/* 只读标记：提示本卡片仅用于集中查看，重点的增删仍在原笔记卡片中单击进行 */
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
  font-family: 'Microsoft YaHei', '微软雅黑', sans-serif;
  /* 只读展示：允许选中复制文本（无标记交互，不必禁用选中） */
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
  bottom: 16px; /* 上下贴边，使卡片高度顶满网页（留出 16px 边距） */
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
.btn-row {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.btn {
  padding: 7px 18px;
  border-radius: 4px;
  border: none;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary {
  background: #409eff;
  color: #fff;
}
.btn-primary:hover {
  background: #66b1ff;
}
.btn-secondary {
  background: #f5f7fa;
  color: #606266;
  border: 1px solid #dcdfe6;
}
.btn-secondary:hover {
  background: #e4e7ed;
}

/* 单卡片「重新录入」：卡片操作条与整块录入区 */
.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.card-btn {
  padding: 3px 12px;
  font-size: 0.76rem;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  background: #f5f7fa;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.card-btn:hover {
  background: #e4e7ed;
}
.card-btn-primary {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.card-btn-primary:hover {
  background: #66b1ff;
}
.card-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
/* 编辑中的卡片：橙色描边提示 */
.note-card.note-editing {
  border-color: #e6a23c;
  box-shadow: 0 0 0 1px rgba(230, 162, 60, 0.4);
}
.card-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card-edit .raw-input {
  min-height: 180px;
}
.edit-tip {
  font-size: 0.76rem;
  color: #909399;
  margin: 0;
  line-height: 1.6;
}
.btn-edit {
  background: #e6a23c;
  color: #fff;
}
.btn-edit:hover {
  background: #ebb563;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 50px 20px;
  color: #909399;
}
.empty-state p {
  font-size: 0.86rem;
}

/* 笔记英文行与正文互为镜像的批注样式（与 ArticleReader 中的 .annotated 保持一致） */
.annotated {
  cursor: pointer;
  transition: opacity 0.15s;
}
.annotated:hover {
  opacity: 0.75;
}
.annotated.highlight {
  padding: 1px 0;
  border-radius: 2px;
}
.annotated.underline {
  text-decoration: underline;
  text-decoration-color: #e74c3c;
  text-decoration-thickness: 2px;
  text-underline-offset: 5px;
  text-decoration-skip-ink: none;
}
.annotated.underline:hover {
  text-decoration-color: #c0392b;
}
</style>
