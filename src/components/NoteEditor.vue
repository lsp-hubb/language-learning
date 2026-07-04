<script setup>
import { ref, inject, watch, computed, nextTick } from 'vue'

const props = defineProps({
  paraIndex: { type: Number, default: -1 },
})

const paragraphNotes = inject('paragraphNotes')
const saveParagraphNote = inject('saveParagraphNote')

const editorEl = ref(null)

// 当前编辑的笔记内容
const currentNote = computed(() => {
  const idx = props.paraIndex
  if (idx < 0) return ''
  return paragraphNotes.value?.[idx] || ''
})

// 切换段落时加载笔记内容
watch(() => props.paraIndex, () => {
  nextTick(() => {
    if (editorEl.value) {
      editorEl.value.innerHTML = formatContent(currentNote.value)
    }
  })
})

function formatContent(text) {
  if (!text) return ''
  return text.split('\n').filter(l => l.trim()).map(l => `<p>${l}</p>`).join('')
}

function getContent() {
  if (!editorEl.value) return ''
  const raw = editorEl.value.innerHTML
  const div = document.createElement('div')
  div.innerHTML = raw
  return Array.from(div.children)
    .map(el => el.textContent)
    .filter(Boolean)
    .join('\n\n')
    .replace(/[\u2018\u2019]|&lsquo;|&rsquo;|&#8216;|&#8217;/g, "'")
    .replace(/[\u201C\u201D]|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
}

async function onSave() {
  const idx = props.paraIndex
  if (idx < 0) return
  const text = getContent()
  if (saveParagraphNote.value) {
    await saveParagraphNote.value(idx, text)
  }
}
</script>

<template>
  <div class="note-panel">
    <div v-if="paraIndex < 0" class="note-empty">点击段落右侧的 📝 按钮开始记笔记</div>
    <template v-else>
      <div class="note-header">
        <span class="note-para-label">第 {{ paraIndex + 1 }} 段</span>
        <button class="note-btn note-save" @click="onSave">✓ 保存</button>
      </div>
      <div class="note-editor-wrap">
        <div
          ref="editorEl"
          class="note-editor"
          contenteditable="true"
          spellcheck="false"
        ></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.note-panel { height: 100%; display: flex; flex-direction: column; }
.note-empty { margin: auto; padding: 40px; color: #aaa; font-size: 14px; text-align: center; }
.note-header { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid #e0d8cc; flex-shrink: 0; }
.note-para-label { font-size: 13px; font-weight: 600; color: #6b5a3e; margin-right: auto; }
.note-btn { border: none; border-radius: 4px; padding: 5px 12px; font-size: 12px; cursor: pointer; transition: all 0.15s; }
.note-save { background: #8b3a2a; color: #fff; }
.note-save:hover { background: #6b2a1a; }
.note-editor-wrap { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; }
.note-editor { outline: none; min-height: 100px; font-family: 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif; font-size: 14px; line-height: 1.8; color: #333; }
.note-editor:empty::before { content: '输入段落笔记...'; color: #bbb; }
.note-editor :deep(p) { margin: 0 0 12px; white-space: pre-wrap; }
</style>
