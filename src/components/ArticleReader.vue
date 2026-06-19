<script setup>
import DrawCanvas from './DrawCanvas.vue'

defineProps({
  article: { type: Object, required: true },
  paragraphSegments: { type: Array, required: true },
  drawMode: Boolean,
  drawActive: Boolean,
  drawTool: String,
  drawColor: String,
  drawColors: Array,
  articleId: String,
  panelOpen: Boolean,
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
])

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
      <div class="reader-body">
        <p v-for="(segments, i) in paragraphSegments" :key="i" class="article-para">
          <template v-for="(seg, j) in segments" :key="j">
            <span v-if="seg.type === 'text'">{{ seg.text }}</span>
            <span
              v-else
              class="annotated"
              :class="[seg.annotation.type]"
              :style="
                seg.annotation.type === 'highlight'
                  ? { backgroundColor: seg.annotation.color }
                  : {}
              "
              :data-annot-id="seg.annotation.id"
              @mouseenter="onAnnotEnter($event, seg.annotation)"
              @mouseleave="onAnnotLeave"
              @click.stop="onAnnotClick($event, seg.annotation)"
              >{{ seg.text }}</span
            >
          </template>
        </p>
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
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 20px;
  color: #333;
  line-height: 1.8;
  text-align: justify;
  text-justify: inter-ideograph;
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
</style>
