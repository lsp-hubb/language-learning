<script setup>
// 考研英语专用导入窗（src/kaoyan/ 下，独立于现有 ArticleDialog）
// 与普通「新建外刊」不同：这里只创建标题条目，正文留空 ——
// 考研英语的内容需分「题目原文 / 题目 / 答案」三块录入，进入文章后在试题页「录入 / 编辑」中填写。
import { ref, nextTick, watch } from 'vue'
import { useFileExplorerStore } from '@/stores/fileExplorer'

const store = useFileExplorerStore()

const show = ref(false)
const saving = ref(false)
const titleInput = ref(null)
const form = ref({ title: '' })

watch(show, (val) => {
  if (val) {
    nextTick(() => titleInput.value?.focus())
  }
})

function open() {
  form.value = { title: '' }
  show.value = true
}

async function confirm() {
  const title = form.value.title.trim()
  if (!title) return
  if (store.currentFolderId === 'root') return

  saving.value = true
  try {
    // 仅提交标题（年份），content 留空。
    // 不传 type：由后端按目录归属自动写入（默认 kaoyan-cloze），
    // 具体题型标签留给进入文章后的「录入 / 编辑」面板再选。
    const ok = await store.createArticle({
      title,
      content: '',
      folderId: store.currentFolderId,
    })
    if (!ok) {
      alert('创建失败，请检查后端服务')
      return
    }
    show.value = false
  } finally {
    saving.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="dialog-overlay" @click.self="show = false">
      <div class="dialog dialog-kaoyan" @click.stop>
        <div class="dialog-title">📝 新建考研英语题</div>

        <p class="ky-tip">
          仅创建<b>年份标题</b>（正文留空）。打开文章后点右上「录入 / 编辑」：<b>先选题型标签</b>
          （完形填空 / 阅读 Part A / Part B），再分别录入<b>题目原文</b>（完形用 <code>[12]</code> 标记空格）、<b>题目</b>、<b>答案</b>。
        </p>

        <div class="field">
          <label class="field-label">年份 *</label>
          <input
            ref="titleInput"
            v-model="form.title"
            class="field-input"
            type="text"
            placeholder="如：2021"
            @keyup.esc="show = false"
            @keyup.enter="confirm"
          />
        </div>

        <div class="dialog-actions">
          <button class="btn btn-cancel" @click="show = false">取消</button>
          <button
            class="btn btn-accent"
            :disabled="!form.title.trim() || saving"
            @click="confirm"
          >
            {{ saving ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}
.dialog-kaoyan {
  width: 520px;
}
.dialog-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 14px;
  flex-shrink: 0;
}
.ky-tip {
  margin: 0 0 16px;
  font-size: 12px;
  line-height: 1.7;
  color: #606266;
  background: #f4f8ff;
  border: 1px solid #d9e7fb;
  border-radius: 6px;
  padding: 10px 12px;
}
.ky-tip b { color: #409eff; }
.ky-tip code {
  background: #ecf5ff;
  color: #409eff;
  padding: 0 4px;
  border-radius: 3px;
  font-family: Consolas, monospace;
}
.field {
  margin-bottom: 14px;
  flex-shrink: 0;
}
.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #888;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.field-input,
.field-select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
  font-family: inherit;
}
.field-input:focus,
.field-select:focus {
  border-color: #4a90d9;
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.15);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  flex-shrink: 0;
}
.btn {
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.btn-accent {
  background: #2c5282;
  color: #fff;
}
.btn-accent:hover { background: #1a365d; }
.btn-accent:disabled {
  background: #8faec8;
  cursor: not-allowed;
}
.btn-cancel {
  background: #e8e8e8;
  color: #333;
}
.btn-cancel:hover { background: #d4d4d4; }
</style>
