<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  article: { type: Object, default: null },
  annotations: { type: Array, default: () => [] },
})

// Python 导出服务（server/pdf_service.py：reportlab 排版 + PyMuPDF 写注释）
const PDF_SERVICE = 'http://127.0.0.1:5057'

// 导出策略：高亮批注 -> PDF Highlight 注释，下划线批注 -> PDF Underline 注释，
// 颜色与注释内容（note）都取自批注自身
const EXPORT_OPTIONS = {
  markHighlight: true,
  markUnderline: true,
  withContents: true,
}

const exporting = ref(false)
const checking = ref(false)
const serviceUp = ref(null) // null=未检测，true/false=检测结果
const checked = ref(false)

// 指示灯：绿=服务已连接，红=服务未启动，黄闪=检测中
const dotClass = computed(() => {
  if (checking.value) return 'checking'
  if (serviceUp.value === true) return 'up'
  if (serviceUp.value === false) return 'down'
  return 'checking'
})

const buttonTitle = computed(() => {
  if (exporting.value) return '正在导出…'
  if (serviceUp.value === false) return 'PDF 导出服务未启动，请先运行 scripts/start-all.py'
  return '导出PDF'
})

const markCount = computed(() => props.annotations.length)

function safeFileName(title) {
  const name = String(title || 'article').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim()
  return (name || 'article').slice(0, 80) + '.pdf'
}

// RFC 5987: attachment; filename="a.pdf"; filename*=UTF-8''%E4%B8%AD.pdf
function parseHeaderFilename(header) {
  if (!header) return ''
  const m = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      /* 忽略，退回普通 filename */
    }
  }
  const m2 = /filename="?([^";]+)"?/i.exec(header)
  return m2 ? m2[1].trim() : ''
}

async function checkService() {
  checking.value = true
  try {
    const r = await fetch(`${PDF_SERVICE}/health`, { method: 'GET' })
    const d = r.ok ? await r.json().catch(() => ({})) : {}
    serviceUp.value = !!(d && d.ok)
  } catch {
    serviceUp.value = false
  } finally {
    checking.value = false
    checked.value = true
  }
}

async function handleExport() {
  if (exporting.value) return
  if (!props.article || !(props.article.content || '').trim()) {
    ElMessage.warning('正文为空，无法导出')
    return
  }
  // 首次未检测过则先检测，避免每次都白等一次请求超时
  if (!checked.value) await checkService()
  if (!serviceUp.value) {
    ElMessage.warning('PDF 导出服务未启动，请先运行 scripts/start-all.py')
    return
  }

  exporting.value = true
  // 用消息提示表达进行中状态，不显示按钮 loading 圆圈（避免顶动同排按钮）
  const loadingMsg = ElMessage({
    message: '正在导出 PDF…',
    type: 'info',
    duration: 0,
  })
  try {
    const payload = {
      title: props.article.title || '',
      content: props.article.content || '',
      annotations: props.annotations.map((a) => ({
        paragraphIndex: a.paragraphIndex,
        startOffset: a.startOffset,
        endOffset: a.endOffset,
        type: a.type,
        color: a.color,
        note: a.note || '',
      })),
      options: EXPORT_OPTIONS,
    }

    const res = await fetch(`${PDF_SERVICE}/api/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error((d && d.error) || `服务返回 ${res.status}`)
    }

    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download =
      parseHeaderFilename(res.headers.get('Content-Disposition')) ||
      safeFileName(props.article.title)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 40000)

    loadingMsg.close()
    ElMessage.success(
      markCount.value
        ? `已导出 PDF，含 ${markCount.value} 处批注注释`
        : '已导出 PDF（纯正文，无批注）'
    )
  } catch (err) {
    loadingMsg.close()
    ElMessage.error('导出 PDF 失败：' + ((err && err.message) || err))
  } finally {
    exporting.value = false
  }
}

onMounted(checkService)
</script>

<template>
  <el-button
    class="pdf-export-btn"
    size="small"
    :title="buttonTitle"
    @click="handleExport"
  >
    <span class="status-dot" :class="dotClass" />
    <svg class="btn-icon" viewBox="0 0 1024 1024" width="13" height="13" fill="currentColor">
      <path
        d="M597.333333 128H256a85.333333 85.333333 0 0 0-85.333333 85.333333v597.333334a85.333333 85.333333 0 0 0 85.333333 85.333333h512a85.333333 85.333333 0 0 0 85.333333-85.333333V384z m0 85.333333l170.666667 170.666667H597.333333zM298.666667 597.333333h170.666666v85.333334H298.666667z m256 0h170.666666v85.333334h-170.666666z"
      />
    </svg>
    PDF
  </el-button>
</template>

<style scoped>
/* 按钮在导出进行中仍保持恒定宽度（不显示 loading 圆圈），
   进行中状态改由 ElMessage 提示传达，避免顶动同排兄弟按钮。 */
.pdf-export-btn.el-button {
  min-width: 60px;
  justify-content: center;
}
.btn-icon {
  margin-right: 4px;
  vertical-align: -1px;
}

/* 导出服务连接状态指示灯 */
.status-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  margin-right: 5px;
  background: #c0c4cc;
  transition: background 0.25s ease, box-shadow 0.25s ease;
}

.status-dot.up {
  background: #22c55e;
  box-shadow: 0 0 0 1.5px rgba(34, 197, 94, 0.22), 0 0 4px rgba(34, 197, 94, 0.85);
}

.status-dot.down {
  background: #ef4444;
  box-shadow: 0 0 0 1.5px rgba(239, 68, 68, 0.18);
}

.status-dot.checking {
  background: #e6a23c;
  box-shadow: 0 0 0 1.5px rgba(230, 162, 60, 0.18);
  animation: dotPulse 1s ease-in-out infinite;
}

@keyframes dotPulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot.checking {
    animation: none;
    opacity: 0.75;
  }
}
</style>
