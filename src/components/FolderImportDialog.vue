<script setup>
import { ref, computed, nextTick } from 'vue'
import { validateFolderBundle, importFolder } from '@/api'
import { readBundleFile, formatBytes, MAX_BUNDLE_BYTES } from '@/utils/folderBundle'
import rootIcon from './icons/根目录.svg'

const props = defineProps({
  currentFolderId: { type: String, default: 'root' },
  currentFolderName: { type: String, default: '' },
})
const emit = defineEmits(['imported'])

const limitMB = MAX_BUNDLE_BYTES / 1024 / 1024

function menuIconStyle(url) {
  return { '--menu-icon': `url("${url}")` }
}

const showDialog = ref(false)
const bundle = ref(null)
const fileName = ref('')
const bytes = ref(0)
const target = ref('current')
const busy = ref(false)
const dragging = ref(false)
const error = ref('')
const summary = ref(null)
const fileInput = ref(null)

const hasCurrentFolder = computed(
  () => props.currentFolderId && props.currentFolderId !== 'root'
)
const targetParentId = computed(() =>
  target.value === 'current' && hasCurrentFolder.value ? props.currentFolderId : 'root'
)
const fileStatus = computed(() => {
  if (busy.value) return { icon: '⏳', text: '正在预检…', tone: 'busy' }
  if (error.value) return { icon: '⚠️', text: '校验未通过', tone: 'error' }
  if (summary.value) return { icon: '✅', text: '预检通过，可以导入', tone: 'ok' }
  return { icon: '📄', text: '等待校验', tone: 'idle' }
})

async function open() {
  showDialog.value = true
  reset()
  await nextTick()
  if (fileInput.value) fileInput.value.value = ''
}

function close() {
  showDialog.value = false
}

function reset() {
  bundle.value = null
  fileName.value = ''
  bytes.value = 0
  error.value = ''
  summary.value = null
  busy.value = false
  dragging.value = false
  target.value = hasCurrentFolder.value ? 'current' : 'root'
}

async function loadFile(f) {
  reset()
  fileName.value = f.name
  busy.value = true
  try {
    const r = await readBundleFile(f)
    bundle.value = r.bundle
    bytes.value = r.bytes
    const res = await validateFolderBundle({
      bundle: r.bundle,
      targetParentId: targetParentId.value,
    })
    summary.value = res.data
  } catch (err) {
    error.value = err.message || '预检失败'
    bundle.value = null
  } finally {
    busy.value = false
  }
}

async function onFileChange(e) {
  const f = e.target.files?.[0]
  if (f) await loadFile(f)
}

async function onDrop(e) {
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) await loadFile(f)
}

async function doImport() {
  if (!bundle.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await importFolder({
      bundle: bundle.value,
      targetParentId: targetParentId.value,
    })
    close()
    emit('imported', res.data)
  } catch (err) {
    error.value = err.message || '导入失败'
  } finally {
    busy.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div v-if="showDialog" class="dialog-overlay" @click.self="close">
      <div class="dialog" @click.stop>
        <header class="dialog-head">
          <div class="head-icon">📥</div>
          <div class="head-text">
            <h2>导入文件夹数据</h2>
            <p>选择数据包，确认后生成全新的文件夹副本</p>
          </div>
          <button class="icon-close" title="关闭" @click="close">×</button>
        </header>

        <div class="dialog-body">
          <label
            class="dropzone"
            :class="{ 'is-drag': dragging, 'has-file': !!fileName, 'is-error': !!error }"
            @dragenter.prevent="dragging = true"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <input
              ref="fileInput"
              class="file-input"
              type="file"
              accept=".json,.llfolder.json,application/json"
              @change="onFileChange"
            />
            <template v-if="!fileName">
              <span class="dz-icon">📦</span>
              <span class="dz-title">点击选择或拖拽数据包到这里</span>
              <span class="dz-sub">纯 JSON · 单文件上限 {{ limitMB }} MB</span>
            </template>
            <template v-else>
              <span class="dz-file-icon">{{ fileStatus.icon }}</span>
              <span class="dz-file">
                <b class="dz-file-name" :title="fileName">{{ fileName }}</b>
                <span class="dz-file-meta" :class="'tone-' + fileStatus.tone">
                  {{ formatBytes(bytes) }} · {{ fileStatus.text }}
                </span>
              </span>
              <span class="dz-change">更换文件</span>
            </template>
          </label>

          <div v-if="summary" class="summary">
            <div class="summary-head">
              <span class="summary-title">数据包内容</span>
              <span class="badge" :class="{ 'badge-root': summary.sourceFolderId === 'root' }">
                {{ summary.sourceFolderId === 'root' ? '全部文件夹' : '单个文件夹' }}
              </span>
              <span class="summary-source" :title="summary.sourceName">
                {{ summary.sourceName || '未知来源' }}
              </span>
            </div>
            <div class="stat-grid">
              <div class="stat"><b>{{ summary.folders }}</b><span>文件夹</span></div>
              <div class="stat"><b>{{ summary.articles }}</b><span>文章</span></div>
              <div class="stat"><b>{{ summary.annotations || 0 }}</b><span>批注</span></div>
              <div class="stat"><b>{{ summary.favorites || 0 }}</b><span>收藏</span></div>
              <div class="stat"><b>{{ summary.canvasStrokes || 0 }}</b><span>画布笔迹</span></div>
              <div class="stat"><b>{{ summary.noteFavorites || 0 }}</b><span>笔记收藏</span></div>
              <div class="stat"><b class="stat-text">{{ formatBytes(bytes) }}</b><span>文件大小</span></div>
            </div>
            <p v-if="summary.skippedOrphans" class="summary-note">
              ⚠ 导出时跳过 {{ summary.skippedOrphans }} 篇孤儿文章（所属文件夹不存在或已删除）
            </p>
            <p v-if="summary.skippedInvalidAnnotations || summary.skippedInvalidCanvasStrokes" class="summary-note">
              ⚠ 导出时跳过 {{ summary.skippedInvalidAnnotations || 0 }} 条异常批注、{{ summary.skippedInvalidCanvasStrokes || 0 }} 条异常笔迹记录
            </p>
          </div>

          <div v-if="error" class="error-bar">
            <span class="error-icon">⚠️</span>
            <span>失败：{{ error }}</span>
          </div>

          <div class="section-label">导入到</div>
          <div class="target-grid">
            <label v-if="hasCurrentFolder" class="target-card" :class="{ active: target === 'current' }">
              <input v-model="target" type="radio" value="current" />
              <span class="target-icon">📁</span>
              <span class="target-text">
                <b>当前文件夹</b>
                <small>{{ currentFolderName || '当前目录' }}</small>
              </span>
              <span class="target-check">✓</span>
            </label>
            <label class="target-card" :class="{ active: target === 'root' }">
              <input v-model="target" type="radio" value="root" />
              <span class="target-icon"><span class="icon-img" aria-hidden="true" :style="menuIconStyle(rootIcon)"></span></span>
              <span class="target-text">
                <b>根目录</b>
                <small>作为顶层文件夹导入</small>
              </span>
              <span class="target-check">✓</span>
            </label>
          </div>
        </div>

        <footer class="dialog-foot">
          <p class="foot-hint">
            完整导入文件夹、文章（含笔记 / 重点 / 类型）、批注、收藏与画布笔迹；不含回收站内容。
            导入会生成全新 ID，重复导入将产生独立副本。
          </p>
          <div class="dialog-actions">
            <button class="btn btn-cancel" @click="close">取消</button>
            <button class="btn btn-primary" :disabled="!bundle || busy" @click="doImport">
              <span v-if="busy" class="btn-spinner"></span>
              {{ busy ? '处理中…' : '确认导入' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(24, 38, 60, 0.42);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.dialog {
  width: 520px;
  max-width: 100%;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e6ebf2;
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(20, 35, 60, 0.24);
  overflow: hidden;
}

/* ===== 头部 ===== */
.dialog-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid #eef1f6;
  background: linear-gradient(180deg, #fbfcfe 0%, #fff 100%);
  flex-shrink: 0;
}
.head-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  background: #eaf3fd;
  border-radius: 10px;
}
.head-text { flex: 1; min-width: 0; }
.head-text h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
}
.head-text p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #8a97a8;
}
.icon-close {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #94a3b8;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
}
.icon-close:hover { background: #f1f4f8; color: #475569; }

/* ===== 主体 ===== */
.dialog-body {
  padding: 18px 20px 4px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.dropzone {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 108px;
  padding: 16px;
  border: 2px dashed #cbd8e8;
  border-radius: 12px;
  background: #f8fbff;
  cursor: pointer;
  transition: all 0.18s;
  flex-wrap: wrap;
  justify-content: center;
  text-align: center;
}
.dropzone:hover { border-color: #4a90d9; background: #f2f8ff; }
.dropzone.is-drag { border-color: #4a90d9; background: #eaf3fd; transform: scale(1.01); }
.dropzone.has-file { justify-content: flex-start; text-align: left; border-style: solid; background: #fff; }
.dropzone.is-error { border-color: #f0b4b4; background: #fffafa; }
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}
.dz-icon { font-size: 26px; line-height: 1; }
.dz-title { width: 100%; font-size: 13px; font-weight: 600; color: #2c5282; }
.dz-sub { width: 100%; font-size: 11px; color: #94a3b8; }
.dz-file-icon { flex-shrink: 0; font-size: 24px; line-height: 1; }
.dz-file { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dz-file-name {
  font-size: 13px;
  font-weight: 600;
  color: #34495e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dz-file-meta { font-size: 11px; color: #94a3b8; }
.dz-file-meta.tone-ok { color: #2e9e6b; }
.dz-file-meta.tone-error { color: #e74c3c; }
.dz-file-meta.tone-busy { color: #4a90d9; }
.dz-change {
  flex-shrink: 0;
  font-size: 11px;
  color: #4a90d9;
  border: 1px solid #cfe0f5;
  border-radius: 6px;
  padding: 4px 10px;
}

/* ===== 摘要 ===== */
.summary {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid #e3ebf5;
  border-radius: 12px;
  background: #f8fafd;
}
.summary-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.summary-title { font-size: 13px; font-weight: 600; color: #2c3e50; }
.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e8f2fd;
  color: #2c5282;
}
.badge-root { background: #e7f6ee; color: #237a4b; }
.summary-source {
  margin-left: auto;
  max-width: 180px;
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.stat {
  background: #fff;
  border: 1px solid #e8eef6;
  border-radius: 9px;
  padding: 9px 6px;
  text-align: center;
}
.stat b {
  display: block;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.3;
  color: #2c5282;
}
.stat b.stat-text { font-size: 13px; line-height: 1.9; }
.stat span { display: block; margin-top: 2px; font-size: 11px; color: #8a97a8; }
.summary-note {
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: #b26a00;
}

/* ===== 错误条 ===== */
.error-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #f8d0d0;
  border-left: 3px solid #e74c3c;
  border-radius: 8px;
  background: #fff6f6;
  font-size: 12px;
  line-height: 1.6;
  color: #b93b32;
  word-break: break-word;
}
.error-icon { flex-shrink: 0; }

/* ===== 目标位置 ===== */
.section-label {
  margin: 18px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: #7f8c8d;
}
.target-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.target-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #dfe6ef;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
}
.target-card:hover { border-color: #9dc2ea; background: #f8fbff; }
.target-card.active { border-color: #4a90d9; background: #eff6ff; box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.14); }
.target-card:focus-within { outline: 2px solid rgba(74, 144, 217, 0.4); outline-offset: 2px; }
.target-card input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.target-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  line-height: 1;
}
.target-icon .icon-img {
  display: block;
  width: 20px;
  height: 20px;
  background-color: #4a90d9;
  -webkit-mask-image: var(--menu-icon);
  mask-image: var(--menu-icon);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.target-text { min-width: 0; display: flex; flex-direction: column; }
.target-text b { font-size: 12px; font-weight: 600; color: #34495e; }
.target-text small {
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.target-check {
  margin-left: auto;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #4a90d9;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  opacity: 0;
  transition: opacity 0.15s;
}
.target-card.active .target-check { opacity: 1; }

/* ===== 底部 ===== */
.dialog-foot {
  padding: 14px 20px 18px;
  border-top: 1px solid #eef1f6;
  background: #fcfdff;
  flex-shrink: 0;
}
.foot-hint {
  margin: 0 0 14px;
  font-size: 11px;
  line-height: 1.7;
  color: #94a3b8;
}
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 18px;
  border-radius: 8px;
  border: 1px solid #dcdfe6;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-cancel { color: #475569; }
.btn-cancel:hover { background: #f1f4f8; }
.btn-primary { background: #4a90d9; border-color: #4a90d9; color: #fff; }
.btn-primary:hover { background: #357abd; border-color: #357abd; }
.btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-top-color: #fff;
  border-radius: 50%;
  animation: fb-spin 0.7s linear infinite;
}
@keyframes fb-spin { to { transform: rotate(360deg); } }

@media (max-width: 560px) {
  .dialog-head { padding: 14px 16px; }
  .dialog-body { padding: 14px 16px 4px; }
  .dialog-foot { padding: 12px 16px 14px; }
  .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .target-grid { grid-template-columns: 1fr; }
}
</style>
