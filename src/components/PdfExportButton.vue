<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import pdfIcon from './icons/pdf文件.svg'
import { normalizeQuotes } from '@/utils/normalizeQuotes'

const props = defineProps({
  article: { type: Object, default: null },
  annotations: { type: Array, default: () => [] },
  annotationsLandscape: { type: Boolean, default: true }, // 批注章节独立横版（默认开）
})

// Python 导出服务（server/pdf_service.py：reportlab 排版 + PyMuPDF 写注释）
const PDF_SERVICE = 'http://127.0.0.1:5057'

// 导出策略：高亮批注 -> PDF Highlight 注释，下划线批注 -> PDF Underline 注释，
// 颜色与注释内容（note）都取自批注自身；
// includeNotes：产物按 5 个独立片段整页拼接，每个都从新的一页开始 ——
//   「批注」（三栏，注释内容写入 PDF Highlight 注释）/「重点」
//   （来自 marks）/「句子」（收藏的笔记卡片内容拷贝：英文 + 中文）/ 文章正文 / 笔记全文；各有内容才生成。
//   五者按同序写进 PDF 大纲，作为五个一级书签（不是笔记下的二级目录）
// 重点标记（marks）与收藏句子（note_favorites）都不在 article 对象里，导出时另经独立接口读取后随 payload 一起发往服务
const EXPORT_OPTIONS = {
  markHighlight: true,
  markUnderline: true,
  withContents: true,
  includeNotes: true,
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

// 重点标记 GET /api/articles/:id/marks：article 对象里没有 marks（NotePanel 单独读写），
// 导出前实时取一次，刚标记完未刷新页面也能生效；失败时降级为「无重点」，不阻断导出
async function fetchMarks(articleId) {
  if (!articleId) return {}
  try {
    const res = await fetch(`/api/articles/${articleId}/marks`)
    if (!res.ok) return {}
    const d = await res.json()
    return d && d.data && typeof d.data === 'object' ? d.data : {}
  } catch {
    return {}
  }
}

// 收藏的句子（articles.note_favorites）：article 对象里没有，导出前实时取一次，
// 失败降级为「无收藏句子」，不阻断导出
async function fetchFavorites(articleId) {
  if (!articleId) return []
  try {
    const res = await fetch(`/api/articles/${articleId}/note-favorites`)
    if (!res.ok) return []
    const d = await res.json()
    return Array.isArray(d && d.data) ? d.data : []
  } catch {
    return []
  }
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
    // 重点标记与笔记同源但走独立接口，实时读取后再一起发给 5057
    const marks = await fetchMarks(props.article.id)
    // 收藏的句子（articles.note_favorites）走独立接口，实时读取后再一起发出
    const favorites = await fetchFavorites(props.article.id)
    const payload = {
      title: props.article.title || '',
      // 与 ArticlePage.paragraphs 用同一套清洗，保证批注的段内偏移基准一致
      content: normalizeQuotes(props.article.content || ''),
      // 笔记生文本（纯文本；无笔记时服务跳过合并）
      notes: props.article.notes || '',
      // 重点标记：键 `noteIndex__词汇文本`，值 true 的项在笔记 PDF 中标红
      marks,
      // 收藏的句子：每项是 {english, chinese, vocabItems} 的内容拷贝，PDF 里只取英文 + 中文
      favorites,
      // text（被标注原文）供产物最前面的「批注」三栏直接展示；
      // 正文 PDF 的 Highlight / Underline 注释仍只用坐标，不依赖该字段
      annotations: props.annotations.map((a) => ({
        paragraphIndex: a.paragraphIndex,
        startOffset: a.startOffset,
        endOffset: a.endOffset,
        type: a.type,
        color: a.color,
        text: a.text || '',
        note: a.note || '',
      })),
      options: { ...EXPORT_OPTIONS, annotationsLandscape: props.annotationsLandscape },
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

    // 服务回写：1 = 已附带笔记侧片段（笔记全文或批注/重点节任一有内容；全空时为 0）
    const withNotes = res.headers.get('X-Include-Notes') === '1'
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
    const parts = []
    if (markCount.value) parts.push(`${markCount.value} 处批注`)
    if (favorites.length) parts.push('句子')
    if (withNotes) parts.push('笔记')
    ElMessage.success(
      parts.length ? `已导出 PDF（正文 + ${parts.join(' + ')}）` : '已导出 PDF（纯正文）'
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
    <img :src="pdfIcon" class="btn-icon" alt="" aria-hidden="true" />
  </el-button>
</template>

<style scoped>
/* 按钮在导出进行中仍保持恒定宽度（不显示 loading 圆圈），
   进行中状态改由 ElMessage 提示传达，避免顶动同排兄弟按钮。 */
.pdf-export-btn.el-button {
  min-width: 60px;
  justify-content: center;
}
/* 纯图标按钮：去掉 PDF 文字后只剩状态灯 + 图标，图标放大并柔化自带的深灰填充 */
.btn-icon {
  display: block;
  width: 16px;
  height: 16px;
  opacity: 0.85;
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
