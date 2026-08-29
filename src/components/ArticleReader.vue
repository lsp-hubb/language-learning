<script setup>
import DrawCanvas from './DrawCanvas.vue'

import { ref, inject, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  article: { type: Object, required: true },
  paragraphSegments: { type: Array, required: true },
  drawMode: Boolean,
  drawActive: Boolean,
  drawTool: String,
  drawColor: String,
  drawColors: Array,
  articleId: String,
  panelOpen: Boolean,
  fontSize: { type: Number, default: 16 },
  scrollTop: { type: Number, default: 0 },
})

const emit = defineEmits([
  'annotMouseEnter',
  'annotMouseLeave',
  'annotClick',
  'scrollAway',
  'toggleTool',
  'toggleDraw',
  'closeCanvas',
  'newCanvas',
  'update:tool',
  'update:color',
  'toggleBookmarks',
  'runScript',
])

const hoveredPara = ref(-1)

function onParaEnter(i) { hoveredPara.value = i }
function onParaLeave() { hoveredPara.value = -1 }

// ===== 笔记面板搜索联动：正文选中文本 → 通知笔记面板查找高亮 =====
const noteSearchText = inject('noteSearchText', null)
const noteSearchNonce = inject('noteSearchNonce', null)
const showSidePanel = inject('showSidePanel', null)
const panelMode = inject('panelMode', null)

// 读取"单词边界自动扩展"后的完整选中文本（选区补全）
// 说明：鼠标划选可能只选中单词的一部分，这里按空白边界前后扩展，
//       返回补全后的完整词/短语作为查找关键词；仅读取，不改动真实选区。
// 注意：仅当选区边界位于"单词内部"（左右侧都是非空白字符）时才扩展，
//       若边界已在词首/词尾（紧邻空白），说明单词已完整，不再多扩展
//       （避免双击完整单词时误把后一个词也带进来）。
function getExpandedSelectionText() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || sel.isCollapsed) return ''
  const range = sel.getRangeAt(0)
  const expanded = range.cloneRange()

  // 起点：仅当左侧是非空白字符（起点位于单词内部）才向前补全到词首
  let node = range.startContainer
  let offset = range.startOffset
  if (node.nodeType === Node.TEXT_NODE) {
    if (offset > 0 && !/\s/.test(node.textContent[offset - 1])) {
      while (offset > 0 && !/\s/.test(node.textContent[offset - 1])) offset--
      expanded.setStart(node, offset)
    }
  }
  // 终点：仅当左右两侧都是非空白字符（终点位于单词内部）才向后补全到词尾
  node = range.endContainer
  offset = range.endOffset
  if (node.nodeType === Node.TEXT_NODE) {
    const leftIsWord = offset > 0 && !/\s/.test(node.textContent[offset - 1])
    const rightIsWord = offset < node.textContent.length && !/\s/.test(node.textContent[offset])
    if (leftIsWord && rightIsWord) {
      while (offset < node.textContent.length && !/\s/.test(node.textContent[offset])) offset++
      expanded.setEnd(node, offset)
    }
  }
  // 去掉首尾符号后再作为查找关键词（如 conclusion. → conclusion）
  // 保留单词内的撇号/连字符（don't、well-known），只清理两端成对的括号/引号和末尾标点
  let text = expanded.toString().trim()
  text = text.replace(/^[「『【〔［（(【\s"'([{]+/, '')            // 开头符号
  text = text.replace(/[」』】〕］）)】\s"'.,;:!?，。；：！？、)]+$/, '') // 末尾符号/标点
  return text.trim()
}

function onReaderMouseUp() {
  // 仅当笔记面板打开时联动
  if (!noteSearchText || !noteSearchNonce) return
  if (!showSidePanel?.value || panelMode?.value !== 'note') return
  // 用单词边界补全后的完整文本作为查找关键词（而非未完全选中的划取内容）
  const text = getExpandedSelectionText()
  if (!text) return
  noteSearchText.value = text
  noteSearchNonce.value++
}

onMounted(() => {
  // 恢复至编辑前的滚动位置
  if (props.scrollTop) {
    nextTick(() => {
      const el = document.querySelector('.reader .reader-content')
      if (el) el.scrollTop = props.scrollTop
    })
  }
})

function onAnnotEnter(e, annotation) {
  emit('annotMouseEnter', e, annotation)
}
function onAnnotLeave() {
  emit('annotMouseLeave')
}
function onAnnotClick(e, annotation) {
  emit('annotClick', e, annotation)
}
function onWheel() {
  emit('scrollAway')
}
</script>

<template>
  <div class="reader">
    <div class="reader-top-bar"></div>
    <div class="reader-content" @wheel="onWheel">
      <div class="reader-left-tools">
        <div class="lt-handle" title="左侧工具">▶</div>
        <div class="lt-buttons">
          <button class="lt-btn" title="书签" @click="emit('toggleBookmarks')">
            <img class="lt-icon" src="/list.png" alt="书签" width="20" height="20" />
          </button>
          <button class="lt-btn" title="启动脚本" @click="emit('runScript')">
            <svg class="lt-icon" viewBox="0 0 1024 1024" width="18" height="18">
              <path d="M420.693333 85.333333C353.28 85.333333 298.666667 139.946667 298.666667 207.36v71.68h183.04c16.64 0 30.293333 24.32 30.293333 40.96H207.36C139.946667 320 85.333333 374.613333 85.333333 442.026667v161.322666c0 67.413333 54.613333 122.026667 122.026667 122.026667h50.346667v-114.346667c0-67.413333 54.186667-122.026667 121.6-122.026666h224c67.413333 0 122.026667-54.229333 122.026666-121.642667V207.36C725.333333 139.946667 670.72 85.333333 603.306667 85.333333z m-30.72 68.693334c17.066667 0 30.72 5.12 30.72 30.293333s-13.653333 38.016-30.72 38.016c-16.64 0-30.293333-12.8-30.293333-37.973333s13.653333-30.336 30.293333-30.336z" fill="#3C78AA"/>
              <path d="M766.250667 298.666667v114.346666a121.6 121.6 0 0 1-121.6 121.984H420.693333A121.6 121.6 0 0 0 298.666667 656.597333v160a122.026667 122.026667 0 0 0 122.026666 122.026667h182.613334A122.026667 122.026667 0 0 0 725.333333 816.64v-71.68h-183.082666c-16.64 0-30.250667-24.32-30.250667-40.96h304.64A122.026667 122.026667 0 0 0 938.666667 581.973333v-161.28a122.026667 122.026667 0 0 0-122.026667-122.026666zM354.986667 491.221333l-0.170667 0.170667c0.512-0.085333 1.066667-0.042667 1.621333-0.170667z m279.04 310.442667c16.64 0 30.293333 12.8 30.293333 37.973333a30.293333 30.293333 0 0 1-30.293333 30.293334c-17.066667 0-30.72-5.12-30.72-30.293334s13.653333-37.973333 30.72-37.973333z" fill="#FDD835"/>
            </svg>
          </button>
          <button class="lt-btn" title="功能三">📊</button>
        </div>
      </div>
      <h1 class="reader-title">{{ article.title }}</h1>
      <div class="reader-body" :style="{ fontSize: props.fontSize + 'px' }" @mouseup="onReaderMouseUp">
        <div
          v-for="(segments, i) in paragraphSegments"
          :key="i"
          class="para-block"
          :class="{ 'para-hovered': hoveredPara === i }"
          @mouseenter="onParaEnter(i)"
          @mouseleave="onParaLeave"
        >
          <p class="article-para">
            <template v-for="(seg, j) in segments" :key="j">
              <span v-if="seg.type === 'text'">{{ seg.text }}</span>
              <span
                v-else
                class="annotated"
                :class="[...new Set([seg.annotation.type, ...(seg.annotations || []).map(a => a.type)])]"
                :style="{
                  ...(seg.annotations?.find(a => a.type === 'highlight') ? { backgroundColor: seg.annotations.find(a => a.type === 'highlight').color } : {}),
                }"
                :data-annot-id="seg.annotation.id"
                @mouseenter="onAnnotEnter($event, seg.annotation)"
                @mouseleave="onAnnotLeave()"
                @click.stop="onAnnotClick($event, seg.annotation)"
                >{{ seg.text }}</span
              >
            </template>
          </p>
        </div>
      </div>
      <DrawCanvas
        :draw-mode="drawMode"
        :draw-active="drawActive"
        :tool="drawTool"
        :color="drawColor"
        :colors="drawColors"
        :article-id="articleId"
        :panel-open="panelOpen"
        @toggle-tool="emit('toggleTool')"
        @toggle-draw="emit('toggleDraw')"
        @close-canvas="emit('closeCanvas')"
        @new-canvas="emit('newCanvas')"
        @update:tool="emit('update:tool', $event)"
        @update:color="emit('update:color', $event)"
      />
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
.reader-top-bar {
  display: none;
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
.reader-title,
.reader-body {
  width: 100%;
  max-width: 720px;
  padding: 0;
  box-sizing: border-box;
}
.reader-title {
  font-size: 28px;
  font-weight: 700;
  color: #1a1a2e;
  line-height: 1.3;
  margin: 0 0 8px;
  letter-spacing: -0.5px;
}
.reader-body {
  counter-reset: para;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  color: #333;
  line-height: 1.8;
  text-align: justify;
  user-select: text;
  cursor: text;
}
.reader-body ::selection {
  background: #fce4ec;
  color: #333;
}
.article-para {
  margin: 0 0 16px;
  white-space: pre-wrap;
}
.annotated {
  cursor: pointer;
  transition: opacity 0.15s;
}
.annotated:hover {
  opacity: 0.75;
}
.annotated.highlight {
  padding: 1px 0;
  border-radius: 2px;
}
.annotated.underline {
  text-decoration: underline;
  text-decoration-color: #e74c3c;
  text-decoration-thickness: 2px;
  text-underline-offset: 5px;
  text-decoration-skip-ink: none;
}
.annotated.underline:hover {
  text-decoration-color: #c0392b;
}

.para-block {
  margin-bottom: 4px;
  position: relative;
  counter-increment: para;
}
.para-hovered::before {
  content: '第' counter(para) '段';
  position: absolute;
  left: 8px;
  top: -4px;
  font-size: 10px;
  color: #bbb;
  white-space: nowrap;
  font-family: 'Consolas', 'Courier New', monospace;
  line-height: inherit;
  user-select: none;
  pointer-events: none;
  animation: hintFade 0.2s ease-out;
}
.para-hovered {
  position: relative;
  background: #fafafa;
  border-radius: 6px;
  box-shadow: 0 0 0 8px #fafafa;
  margin: 0;
  padding: 0;
}
.para-block { position: relative; }
.reader-left-tools {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 100;
  display: flex;
  flex-direction: row;
  align-items: center;
}
/* hover 判定仅基于本容器（半圆钮宽度）；按钮组绝对定位脱离流，不占宽、不扩大 hover 区域 */
.reader-left-tools:hover .lt-buttons,
.reader-left-tools:has(.lt-buttons:hover) .lt-buttons {
  visibility: visible;
  opacity: 1;
}
/* 小半圆钮：默认贴左缘，悬停展开按钮 */
.lt-handle {
  flex: 0 0 auto;
  width: 14px;
  height: 64px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-left: none;
  border-radius: 0 10px 10px 0;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: #909399;
  cursor: pointer;
  user-select: none;
}
/* 按钮组：绝对定位脱离流，不占宽；默认隐藏，容器（半圆钮）悬停时展开 */
.lt-buttons {
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 8px 8px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-left: none;
  border-radius: 0 10px 10px 0;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
  margin-left: -1px;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.3s ease;
}
.lt-btn {
  width: 36px;
  height: 36px;
  border: 1px solid #d4c5b0;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}
.lt-btn:hover {
  background: #f0e8d8;
  border-color: #8b3a2a;
  transform: scale(1.08);
}
</style>
