<script setup>
import { ref, nextTick, watch } from 'vue'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import { normalizeQuotes } from '@/utils/normalizeQuotes'

const store = useFileExplorerStore()

const showArticleDialog = ref(false)
const articleForm = ref({
  title: '',
  content: '',
})
const titleInput = ref(null)

watch(showArticleDialog, (val) => {
  if (val) {
    nextTick(() => {
      titleInput.value?.focus()
    })
  }
})

function cleanContent(text) {
  // 输入侧清洗：新建文章正文落库前归一弯引号（弯单引号 → '，弯双引号 → "）
  return normalizeQuotes(
    text
      .split('\n')
      .map((line) => line.trimEnd())
      .reduce((acc, line) => {
        if (line === '') {
          if (acc.length > 0 && acc[acc.length - 1] !== '') acc.push('')
        } else {
          acc.push(line)
        }
        return acc
      }, [])
      .join('\n')
      .trim(),
  )
}

function open() {
  articleForm.value = { title: '', content: '' }
  showArticleDialog.value = true
}

async function confirmArticle() {
  const title = articleForm.value.title.trim()
  if (!title) return
  // 根目录不允许建文章（后端 POST /api/articles 也有同样校验，双保险）
  if (store.currentFolderId === 'root') {
    alert('根目录下不能新建文章，请先进入一个文件夹')
    return
  }

  const content = cleanContent(articleForm.value.content)

  const folderId = store.currentFolderId
  const ok = await store.createArticle({
    title,
    content,
    folderId,
  })

  if (!ok) {
    alert('创建失败，请检查后端服务')
    return
  }
  showArticleDialog.value = false
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div v-if="showArticleDialog" class="dialog-overlay" @click.self="showArticleDialog = false">
      <div class="dialog dialog-article" @click.stop>
        <div class="dialog-title">📰 新建外刊</div>
        <p v-if="store.currentFolderId === 'root'" class="root-tip">
          ⚠️ 根目录下不能新建文章，请先进入一个文件夹
        </p>
        <div class="field">
          <label class="field-label">标题 *</label>
          <input
            ref="titleInput"
            v-model="articleForm.title"
            class="field-input"
            type="text"
            placeholder="文章标题"
            @keyup.esc="showArticleDialog = false"
          />
        </div>
        <div class="field field-grow">
          <label class="field-label">文章内容</label>
          <textarea
            v-model="articleForm.content"
            class="field-textarea"
            placeholder="将整篇文章粘贴到这里，段落之间用空行分隔&#10;多余空行会自动清理"
            spellcheck="false"
          ></textarea>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-cancel" @click="showArticleDialog = false">取消</button>
          <button
            class="btn btn-accent"
            :disabled="!articleForm.title.trim() || store.currentFolderId === 'root'"
            @click="confirmArticle"
          >
            创建
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
.dialog.dialog-article {
  width: 560px;
}
.dialog-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  flex-shrink: 0;
}
.field {
  margin-bottom: 14px;
  flex-shrink: 0;
}
.root-tip {
  margin: 0 0 12px;
  font-size: 12px;
  color: #c45656;
  background: #fef0f0;
  border: 1px solid #fde2e2;
  border-radius: 6px;
  padding: 8px 10px;
}
.field-grow {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
.field-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.field-input:focus {
  border-color: #4a90d9;
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.15);
}
.field-textarea {
  width: 100%;
  flex: 1;
  min-height: 280px;
  padding: 12px;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  font-size: 14px;
  font-family: 'Georgia', 'Times New Roman', serif;
  line-height: 1.7;
  text-align: justify;
  outline: none;
  resize: vertical;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.field-textarea:focus {
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
.btn-accent:hover {
  background: #1a365d;
}
.btn-accent:disabled {
  background: #8faec8;
  cursor: not-allowed;
}
.btn-cancel {
  background: #e8e8e8;
  color: #333;
}
.btn-cancel:hover {
  background: #d4d4d4;
}
</style>
