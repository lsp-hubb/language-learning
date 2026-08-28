<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({
  title: String,
  content: String,
  saving: Boolean,
  scrollTop: { type: Number, default: 0 },
  fontSize: { type: Number, default: 16 },
})
const emit = defineEmits(['update:title', 'save', 'cancel'])

const contentBody = ref(null)

function formatContent(text) {
  if (!text) return ''
  return text
    .split('\n')
    .filter(l => l.trim())
    .map(l => `<p>${l}</p>`)
    .join('')
}

onMounted(() => {
  if (contentBody.value) {
    contentBody.value.innerHTML = formatContent(props.content)
    contentBody.value.addEventListener('keydown', onSaveShortcut)
  }
  // 恢复至阅读时的滚动位置
  if (props.scrollTop) {
    const el = contentBody.value?.closest('.reader-content')
    if (el) el.scrollTop = props.scrollTop
  }
})

function onSaveShortcut(e) {
  if (e.ctrlKey && (e.key === 'Enter' || e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    emit('save')
  }
}

function getContent() {
  if (!contentBody.value) return ''
  const raw = contentBody.value.innerHTML
  // 弯引号/HTML实体 → 直引号
  return raw
    .replace(/[\u2018\u2019]|&lsquo;|&rsquo;|&#8216;|&#8217;/g, "'")
    .replace(/[\u201C\u201D]|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
}

defineExpose({ getContent })
</script>

<template>
  <div class="reader">
    <div class="reader-content">
      <input
        class="editor-title"
        type="text"
        placeholder="文章标题"
        :value="title"
        @input="$emit('update:title', $event.target.value)"
        @keydown.ctrl.enter="$emit('save')"
      />
      <div
        ref="contentBody"
        class="editor-body"
        contenteditable="true"
        spellcheck="false"
        :style="{ fontSize: props.fontSize + 'px' }"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.reader {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 960px;
  background: #fff;
  border-radius: 0 0 12px 12px;
  border: 1px solid #ebeef5;
  border-top: none;
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
  padding: 20px 32px 40px;
}
.editor-title {
  width: 100%;
  max-width: 720px;
  padding: 0;
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
  max-width: 720px;
  padding: 0;
  box-sizing: border-box;
  outline: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  line-height: 1.8;
  color: #333;
  text-align: justify;
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
