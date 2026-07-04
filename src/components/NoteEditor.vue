<script setup>
import { ref, inject, watch, computed, nextTick } from 'vue'

const props = defineProps({
  paraIndex: { type: Number, default: -1 },
  notes: { type: Object, default: () => ({}) },
})

const saveParagraphNote = inject('saveParagraphNote')

const isEditing = ref(false)
const saving = ref(false)
const editorEl = ref(null)

// 当前段落的笔记内容（纯文本）
const currentNote = computed(() => {
  const idx = props.paraIndex
  if (idx < 0) return ''
  return props.notes[idx] || ''
})

// 切换段落时决定模式
watch(() => props.paraIndex, () => {
  nextTick(() => {
    if (currentNote.value) {
      isEditing.value = false
    } else {
      isEditing.value = true
      if (editorEl.value) {
        editorEl.value.innerHTML = ''
      }
    }
  })
})

function startEdit() {
  isEditing.value = true
  nextTick(() => {
    if (editorEl.value) {
      editorEl.value.innerHTML = formatContent(currentNote.value)
    }
  })
}

function formatContent(text) {
  if (!text) return ''
  // 条目间用 \n\n 分隔，条目内 \n 转 <br>（保留空行）
  return text.split('\n\n').filter(l => l.trim()).map(entry =>
    `<p>${entry.replace(/\n/g, '<br>')}</p>`
  ).join('\n')
}

function getContent() {
  if (!editorEl.value) return ''
  const raw = editorEl.value.innerHTML
  // 直接解析 innerHTML：<p> 为条目分隔，<br> 转为 \n
  const text = raw
    .replace(/<\/p>\s*<p>/gi, '\n\n')  // <p> 间为条目分隔
    .replace(/<br\s*\/?>/gi, '\n')      // <br> 转为换行
    .replace(/<\/?p>/gi, '')            // 移除 p 标签
    .replace(/<\/?div>/gi, '')          // 移除可能出现的 div 标签
    .replace(/&nbsp;/g, ' ')            // 空格实体
    .replace(/[\u2018\u2019]|&lsquo;|&rsquo;|&#8216;|&#8217;/g, "'")
    .replace(/[\u201C\u201D]|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
  const lines = text.split('\n\n').filter(l => l.trim())
  return lines.join('\n\n')
}

async function onSave() {
  const idx = props.paraIndex
  if (idx < 0) return
  saving.value = true
  const text = getContent()
  const fn = saveParagraphNote?.current
  if (fn) {
    try {
      await fn(idx, text)
    } catch (err) {
      console.error('保存笔记失败:', err)
    }
  }
  saving.value = false
  isEditing.value = false
}
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
        <div v-if="!currentNote" class="note-empty-inline">暂无内容，点击编辑开始记笔记</div>
        <div v-else class="note-viewer">
          <p v-for="(entry, i) in currentNote.split('\n\n').filter(l => l.trim())" :key="i" class="note-para">{{ entry }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.note-panel { height: 100%; display: flex; flex-direction: column; }
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
.note-editor { outline: none; min-height: 100px; font-family: 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif; font-size: 14px; line-height: 1.8; color: #333; text-align: justify; }
.note-editor:empty::before { content: '输入段落笔记...'; color: #bbb; }
.note-editor :deep(p) { margin: 0 0 12px; white-space: pre-wrap; }
.note-viewer { font-family: 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif; font-size: 14px; line-height: 1.8; color: #333; min-height: 100px; text-align: justify; }
.note-para { margin: 0 0 12px; text-align: justify; white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; }
</style>
