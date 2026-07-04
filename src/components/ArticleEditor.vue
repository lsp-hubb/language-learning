<script setup>
import { computed, ref, watch, nextTick } from 'vue'

const props = defineProps({
  title: String,
  content: String,
  saving: Boolean,
})
const emit = defineEmits(['update:title', 'update:content', 'save', 'cancel'])

const titleModel = computed({
  get: () => props.title || '',
  set: (val) => emit('update:title', val),
})

const contentBody = ref(null)

function onBodyInput(e) {
  emit('update:content', e.target.innerHTML)
}

// 初始化正文内容
watch(() => props.content, (val) => {
  if (contentBody.value && val !== undefined) {
    contentBody.value.innerHTML = formatContent(val)
  }
}, { immediate: true })

function formatContent(text) {
  if (!text) return ''
  return text
    .split('\n')
    .filter(l => l.trim())
    .map(l => `<p>${l}</p>`)
    .join('')
}

const titleRef = ref(null)

watch(() => props.content, () => {
  nextTick(() => titleRef.value?.focus())
}, { once: true })

function onSaveShortcut(e) {
  if (e.ctrlKey && (e.key === 'Enter' || e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    emit('save')
  }
}
</script>

<template>
  <div class="reader">
    <div class="reader-content">
      <input
        ref="titleRef"
        v-model="titleModel"
        class="editor-title"
        type="text"
        placeholder="文章标题"
      />
      <div
        ref="contentBody"
        class="editor-body"
        contenteditable="true"
        spellcheck="false"
        @input="onBodyInput"
        @keydown="onSaveShortcut"
        v-html="formatContent(content)"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.reader {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 1080px;
  background: #fcf9f4;
  border-radius: 12px;
  border: 1px solid #e8e0d4;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.reader-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0 40px;
}
.editor-title {
  width: 100%;
  max-width: 800px;
  padding: 0 40px;
  box-sizing: border-box;
  outline: none;
  font-family: inherit;
  font-size: 28px;
  font-weight: 700;
  color: #1a1a2e;
  line-height: 1.3;
  margin: 0 0 8px;
  letter-spacing: -0.5px;
  border: none;
  background: transparent;
}
.editor-title::placeholder {
  color: #bbb;
}
.editor-body {
  width: 100%;
  max-width: 800px;
  padding: 0 40px;
  box-sizing: border-box;
  outline: none;
  font-family: 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif;
  font-size: 16px;
  line-height: 1.8;
  color: #333;
  text-align: justify;
  min-height: 200px;
}
.editor-body:empty::before {
  content: '文章内容...';
  color: #bbb;
}
.editor-body :deep(p) {
  margin: 0 0 16px;
  white-space: pre-wrap;
}
</style>
