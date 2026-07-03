<script setup>
import DrawCanvas from './DrawCanvas.vue'

import { ref, onMounted, onUnmounted } from 'vue'

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
  translations: { type: Array, default: () => [] },
  visibleTrans: { type: Set, default: () => new Set() },
  highlightedTransSents: { type: Map, default: () => new Map() },
})

function splitTransSents(text) {
  if (!text) return []
  return text.split(/(?<=。)/g).filter(Boolean)
}
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
  'toggleTrans',
  'toggleBookmarks',
  'runScript',
])

const hoveredPara = ref(-1)

function onParaEnter(i) {
  hoveredPara.value = i
}
function onParaLeave() {
  hoveredPara.value = -1
}

function onTransKeydown(e) {
  if ((e.key === 's' || e.key === 'S') && hoveredPara.value >= 0) {
    e.preventDefault()
    emit('toggleTrans', hoveredPara.value)
  }
}

onMounted(() => document.addEventListener('keydown', onTransKeydown))
onUnmounted(() => document.removeEventListener('keydown', onTransKeydown))

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
        <button class="lt-btn" title="书签" @click="emit('toggleBookmarks')">
          <svg class="lt-icon" viewBox="0 0 1024 1024" width="18" height="18">
            <path d="M811.6 264.1H378.2c-19.8 0-36-16.2-36-36s16.2-36 36-36h433.5c19.8 0 36 16.2 36 36-0.1 19.8-16.3 36-36.1 36zM811.6 522.1H378.2c-19.8 0-36-16.2-36-36s16.2-36 36-36h433.5c19.8 0 36 16.2 36 36-0.1 19.8-16.3 36-36.1 36zM811.6 780.1H378.2c-19.8 0-36-16.2-36-36s16.2-36 36-36h433.5c19.8 0 36 16.2 36 36-0.1 19.8-16.3 36-36.1 36z" fill="currentColor"/>
            <path d="M210.2 229m-37.9 0a37.9 37.9 0 1 0 75.8 0 37.9 37.9 0 1 0-75.8 0Z" fill="currentColor"/>
            <path d="M210.2 487m-37.9 0a37.9 37.9 0 1 0 75.8 0 37.9 37.9 0 1 0-75.8 0Z" fill="currentColor"/>
            <path d="M210.2 745m-37.9 0a37.9 37.9 0 1 0 75.8 0 37.9 37.9 0 1 0-75.8 0Z" fill="currentColor"/>
          </svg>
        </button>
        <button class="lt-btn" title="启动脚本" @click="emit('runScript')">
          <svg class="lt-icon" viewBox="0 0 1024 1024" width="18" height="18">
            <path d="M420.693333 85.333333C353.28 85.333333 298.666667 139.946667 298.666667 207.36v71.68h183.04c16.64 0 30.293333 24.32 30.293333 40.96H207.36C139.946667 320 85.333333 374.613333 85.333333 442.026667v161.322666c0 67.413333 54.613333 122.026667 122.026667 122.026667h50.346667v-114.346667c0-67.413333 54.186667-122.026667 121.6-122.026666h224c67.413333 0 122.026667-54.229333 122.026666-121.642667V207.36C725.333333 139.946667 670.72 85.333333 603.306667 85.333333z m-30.72 68.693334c17.066667 0 30.72 5.12 30.72 30.293333s-13.653333 38.016-30.72 38.016c-16.64 0-30.293333-12.8-30.293333-37.973333s13.653333-30.336 30.293333-30.336z" fill="#3C78AA"/>
            <path d="M766.250667 298.666667v114.346666a121.6 121.6 0 0 1-121.6 121.984H420.693333A121.6 121.6 0 0 0 298.666667 656.597333v160a122.026667 122.026667 0 0 0 122.026666 122.026667h182.613334A122.026667 122.026667 0 0 0 725.333333 816.64v-71.68h-183.082666c-16.64 0-30.250667-24.32-30.250667-40.96h304.64A122.026667 122.026667 0 0 0 938.666667 581.973333v-161.28a122.026667 122.026667 0 0 0-122.026667-122.026666zM354.986667 491.221333l-0.170667 0.170667c0.512-0.085333 1.066667-0.042667 1.621333-0.170667z m279.04 310.442667c16.64 0 30.293333 12.8 30.293333 37.973333a30.293333 30.293333 0 0 1-30.293333 30.293334c-17.066667 0-30.72-5.12-30.72-30.293334s13.653333-37.973333 30.72-37.973333z" fill="#FDD835"/>
          </svg>
        </button>
        <button class="lt-btn" title="功能三">📊</button>
      </div>
      <h1 class="reader-title">{{ article.title }}</h1>
      <div class="reader-body" :style="{ fontSize: props.fontSize + 'px' }">
        <div
          v-for="(segments, i) in paragraphSegments"
          :key="i"
          class="para-block"
          :class="{ 'para-hovered': hoveredPara === i, 'has-trans': !!translations[i] }"
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
                  ...(seg.annotations?.find(a => a.type === 'sentence') ? { color: '#2980b9' } : {}),
                }"
                :data-annot-id="seg.annotation.id"
                @mouseenter="onAnnotEnter($event, seg.annotation)"
                @mouseleave="onAnnotLeave()"
                @click.stop="onAnnotClick($event, seg.annotation)"
                >{{ seg.text }}</span
              >
            </template>
          </p>
          <div v-if="translations[i]" class="trans-row">
            <div v-if="visibleTrans.has(i)" class="trans-text">
              <template v-for="(sent, j) in splitTransSents(translations[i])" :key="j">
                <span v-if="highlightedTransSents.get(i) === j" class="trans-sent-highlighted">{{ sent }}</span>
                <span v-else>{{ sent }}</span>
              </template>
            </div>
          </div>
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
  max-width: 1080px;
  background: #fcf9f4;
  border-radius: 12px;
  border: 1px solid #e8e0d4;
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
  padding: 24px 0 40px;
}
.reader-title,
.reader-body {
  width: 100%;
  max-width: 800px;
  padding: 0 40px;
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
  font-family: 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif;
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
.annotated.sentence {
  font-weight: 500;
}
.annotated.sentence:hover {
  opacity: 0.75;
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
.trans-row {
  margin: 4px 0 16px 0;
}
.para-hovered {
  position: relative;
  background: #fafafa;
  border-radius: 6px;
  margin: 0 -8px;
  padding: 0 8px;
}
.para-hovered.has-trans::after {
  content: '按 S 查看翻译';
  position: absolute;
  right: 8px;
  top: -4px;
  font-size: 10px;
  color: #aaa;
  pointer-events: none;
  animation: hintFade 0.2s ease-out;
}
@keyframes hintFade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.trans-text {
  margin-top: 8px;
  padding: 12px 16px;
  background: #f5faf5;
  border-left: 3px solid #81c784;
  border-radius: 6px;
  font-size: 0.9em;
  line-height: 1.8;
  color: #444;
  animation: transFadeIn 0.25s ease-out;
}
@keyframes transFadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.trans-sent-highlighted {
  background: #fce4ec;
  border-radius: 3px;
  padding: 1px 0;
}
.reader-left-tools {
  position: fixed;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 6px;
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
