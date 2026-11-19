<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { fetchReadTtsStatus } from '@/api'

// 音频准备情况查看器：只读查询当前文章各段在「三音色 × 三级缓存」中的就绪状态。
// 打开面板 / 点击刷新时才请求，不做任何合成；「立即准备」由父组件触发预热并回调 refresh。
const props = defineProps({
  visible: { type: Boolean, default: false },
  texts: { type: Array, default: () => [] },
  currentVoiceId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'rewarm', 'select-voice'])

const loading = ref(false)
const error = ref('')
const data = ref(null)
const showDetail = ref(false)
let reqId = 0
const panelEl = ref(null)

async function refresh() {
  if (!props.visible) return
  const id = ++reqId
  loading.value = true
  error.value = ''
  try {
    const res = await fetchReadTtsStatus(props.texts)
    if (id !== reqId) return
    data.value = res
  } catch (e) {
    if (id !== reqId) return
    error.value = e?.message || '查询失败'
    data.value = null
  } finally {
    if (id === reqId) loading.value = false
  }
}

// 点击面板以外区域关闭面板：用 document 级 click 监听，而非全屏 overlay——
// 这样面板外的那次点击（如朗读按钮、正文选区）照常生效，不被遮罩吞掉。
// 延迟到下一个宏任务再注册，避免「打开面板」那次点击冒泡到 document 后又立刻把面板关掉。
let docListenTimer = 0
function onDocClick(e) {
  if (!props.visible) return
  if (panelEl.value?.contains(e.target)) return // 面板内部点击不关闭
  emit('close')
}
watch(() => props.visible, (v) => {
  if (v) {
    refresh()
    clearTimeout(docListenTimer)
    docListenTimer = setTimeout(() => document.addEventListener('click', onDocClick), 0)
  } else {
    clearTimeout(docListenTimer)
    document.removeEventListener('click', onDocClick)
  }
})
onUnmounted(() => {
  clearTimeout(docListenTimer)
  document.removeEventListener('click', onDocClick)
})
defineExpose({ refresh })

function pct(n) {
  const total = data.value?.total || 0
  return total ? `${((n / total) * 100).toFixed(1)}%` : '0%'
}
function statusLabel(s) {
  return { memory: '内存命中', disk: '磁盘命中', pending: '正在生成', miss: '未准备' }[s] || s
}
</script>

<template>
  <div v-if="visible" ref="panelEl" class="audio-status-panel">
    <div class="as-header">
      <span class="as-title">音频准备情况</span>
      <button class="as-icon-btn" title="重新检测" :disabled="loading" @click="refresh">↻</button>
      <button class="as-icon-btn" title="关闭" @click="emit('close')">✕</button>
    </div>

    <div class="as-meta">共 {{ data?.total ?? texts.length }} 段 · 三音色缓存就绪统计</div>

    <div v-if="error" class="as-error">{{ error }}<button class="as-retry" @click="refresh">重试</button></div>
    <div v-else-if="loading && !data" class="as-loading">正在查询缓存状态…</div>

    <template v-else>
      <div
        v-for="v in data?.voices || []"
        :key="v.id"
        class="as-voice as-voice-pick"
        :class="{ current: v.id === currentVoiceId }"
        :title="v.id === currentVoiceId ? '当前朗读音色' : `点击切换为 ${v.name}`"
        @click="emit('select-voice', v.id)"
      >
        <div class="as-voice-head">
          <b>{{ v.name }}</b>
          <span v-if="v.id === currentVoiceId" class="as-current-tag">当前</span>
          <span class="as-count">{{ v.ready }}/{{ v.total }} 已就绪</span>
        </div>
        <div class="as-bar">
          <span class="seg mem" :style="{ width: pct(v.memory) }" :title="`内存 ${v.memory} 段`"></span>
          <span class="seg disk" :style="{ width: pct(v.disk) }" :title="`磁盘 ${v.disk} 段`"></span>
          <span class="seg pending" :style="{ width: pct(v.pending) }" :title="`生成中 ${v.pending} 段`"></span>
        </div>
        <div class="as-legend">
          <span><i class="dot mem"></i>内存 {{ v.memory }}</span>
          <span><i class="dot disk"></i>磁盘 {{ v.disk }}</span>
          <span><i class="dot pending"></i>生成中 {{ v.pending }}</span>
          <span><i class="dot miss"></i>未准备 {{ v.miss }}</span>
        </div>
      </div>

      <button class="as-toggle" @click="showDetail = !showDetail">
        {{ showDetail ? '收起' : '展开' }}逐段明细
      </button>
      <div v-if="showDetail" class="as-detail">
        <div v-for="p in data?.paragraphs || []" :key="p.index" class="as-row">
          <span class="as-idx">{{ p.index + 1 }}</span>
          <span class="as-preview" :title="p.preview">{{ p.preview }}</span>
          <span class="as-badges">
            <i
              v-for="v in data?.voices || []"
              :key="v.id"
              class="as-badge"
              :class="p.status[v.id]"
              :title="`${v.name}：${statusLabel(p.status[v.id])}`"
            >{{ v.name.charAt(0) }}</i>
          </span>
        </div>
        <div v-if="!data?.paragraphs?.length" class="as-empty">本文章没有可朗读的段落</div>
      </div>

      <button class="as-warm" :disabled="loading" @click="emit('rewarm')">立即准备全部音色</button>
      <div class="as-hint">仅查询状态不会合成音频；点「立即准备」触发预热，完成后自动刷新本面板。</div>
    </template>
  </div>
</template>

<style scoped>
.audio-status-panel {
  position: fixed;
  left: 72px;
  top: 50%;
  transform: translateY(-50%);
  width: 360px;
  max-height: 80vh;
  overflow-y: auto;
  z-index: 1100;
  padding: 14px 16px 16px;
  background: #fffdf8;
  border: 1px solid #d4c5b0;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
  font-size: 13px;
  color: #4a3f33;
}
.as-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebe1d2;
}
.as-title {
  flex: 1;
  font-size: 15px;
  font-weight: 700;
  color: #8b3a2a;
}
.as-icon-btn {
  width: 26px;
  height: 26px;
  border: 1px solid #d4c5b0;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: #6b5b46;
}
.as-icon-btn:hover:not(:disabled) { background: #f0e8d8; border-color: #8b3a2a; }
.as-icon-btn:disabled { opacity: 0.5; cursor: default; }
.as-meta {
  margin: 10px 0 8px;
  color: #8a7a63;
  font-size: 12px;
}
.as-error {
  padding: 10px;
  color: #cf1322;
  background: #fff1f0;
  border: 1px solid #ffa39e;
  border-radius: 6px;
}
.as-retry {
  margin-left: 8px;
  border: none;
  background: none;
  color: #8b3a2a;
  cursor: pointer;
  text-decoration: underline;
}
.as-loading { padding: 16px 0; color: #8a7a63; text-align: center; }
.as-voice {
  padding: 10px 0;
  border-bottom: 1px dashed #ebe1d2;
}
.as-voice-pick { cursor: pointer; }
.as-voice-pick:hover { background: #f0e8d8; border-radius: 6px; }
.as-voice.current {
  background: #f6efe2;
  border-radius: 6px;
  padding: 10px 8px;
}
.as-voice-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.as-voice-head b { font-size: 14px; }
.as-current-tag {
  padding: 0 5px;
  border-radius: 8px;
  background: #8b3a2a;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
}
.as-count { margin-left: auto; color: #6b5b46; font-size: 12px; }
.as-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: #e8e2d7;
}
.seg { display: block; height: 100%; }
.seg.mem { background: #52c41a; }
.seg.disk { background: #409eff; }
.seg.pending { background: #faad14; }
.as-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 6px;
  font-size: 11px;
  color: #7a6a53;
}
.as-legend span { display: inline-flex; align-items: center; gap: 3px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.dot.mem { background: #52c41a; }
.dot.disk { background: #409eff; }
.dot.pending { background: #faad14; }
.dot.miss { background: #cfc7ba; }
.as-toggle {
  margin: 12px 0 8px;
  padding: 0;
  border: none;
  background: none;
  color: #8b3a2a;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.as-detail {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid #ebe1d2;
  border-radius: 6px;
  background: #fff;
}
.as-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid #f2ece2;
  font-size: 12px;
}
.as-row:last-child { border-bottom: none; }
.as-idx { flex: 0 0 24px; color: #a08f76; text-align: right; }
.as-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #4a3f33;
}
.as-badges { display: flex; gap: 3px; flex: 0 0 auto; }
.as-badge {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  font-size: 10px;
  font-style: normal;
  line-height: 16px;
  text-align: center;
  color: #fff;
}
.as-badge.memory { background: #52c41a; }
.as-badge.disk { background: #409eff; }
.as-badge.pending { background: #faad14; }
.as-badge.miss { background: #cfc7ba; color: #6b5b46; }
.as-empty { padding: 12px; text-align: center; color: #a08f76; }
.as-warm {
  width: 100%;
  margin-top: 12px;
  padding: 7px 0;
  border: 1px solid #8b3a2a;
  border-radius: 6px;
  background: #8b3a2a;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}
.as-warm:hover:not(:disabled) { background: #6f2c20; }
.as-warm:disabled { opacity: 0.5; cursor: default; }
.as-hint { margin-top: 6px; color: #a08f76; font-size: 11px; line-height: 1.5; }
</style>
