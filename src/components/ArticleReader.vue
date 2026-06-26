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
  'toggleTrans',
])

const hoveredPara = ref(-1)

function onParaEnter(i) { hoveredPara.value = i }
function onParaLeave() { hoveredPara.value = -1 }

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
                :class="[seg.annotation.type]"
                :style="
                  seg.annotation.type === 'highlight' ? { backgroundColor: seg.annotation.color } :
                  seg.annotation.type === 'sentence' ? { color: seg.annotation.color } : {}
                "
                :data-annot-id="seg.annotation.id"
                @mouseenter="onAnnotEnter($event, seg.annotation)"
                @mouseleave="onAnnotLeave"
                @click.stop="onAnnotClick($event, seg.annotation)"
                >{{ seg.text }}</span
              >
            </template>
          </p>
          <div v-if="translations[i]" class="trans-row">
            <div v-if="visibleTrans.has(i)" class="trans-text">{{ translations[i] }}</div>
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
.para-block { margin-bottom: 4px; position: relative; counter-increment: para; }
.para-hovered::before {
  content: "第" counter(para) "段";
  position: absolute; left: 8px; top: -4px;
  font-size: 10px; color: #bbb; white-space: nowrap;
  font-family: 'Consolas', 'Courier New', monospace;
  line-height: inherit; user-select: none; pointer-events: none;
  animation: hintFade 0.2s ease-out;
}
.trans-row { margin: 4px 0 16px 0; }
.para-hovered { position: relative; background: #fafafa; border-radius: 6px; margin: 0 -8px; padding: 0 8px; }
.para-hovered.has-trans::after {
  content: '按 S 查看翻译'; position: absolute; right: 8px; top: -4px;
  font-size: 10px; color: #aaa; pointer-events: none;
  animation: hintFade 0.2s ease-out;
}
@keyframes hintFade { from { opacity: 0; } to { opacity: 1; } }
.trans-text {
  margin-top: 8px; padding: 12px 16px;
  background: #f5faf5; border-left: 3px solid #81c784; border-radius: 6px;
  font-size: 0.9em; line-height: 1.8; color: #444;
  animation: transFadeIn 0.25s ease-out;
}
@keyframes transFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
