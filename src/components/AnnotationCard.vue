<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  annotation: { type: Object, default: () => ({}) },
  visible: { type: Boolean, default: false },
  position: { type: Object, default: () => ({ x: 0, y: 0 }) },
})

const emit = defineEmits(['close', 'save', 'delete'])

const cardRef = ref(null)
const textareaRef = ref(null)
const adjustedPos = ref({ x: 0, y: 0, placeAbove: false })
const isEditing = ref(false)
const editNote = ref('')

// 卡片显示时重置编辑状态
watch(() => props.visible, async (val) => {
  if (val) {
    isEditing.value = false
    editNote.value = props.annotation.note || ''
    await nextTick()
    adjustPosition()
  }
})

watch(() => props.position, () => {
  if (props.visible) nextTick(() => adjustPosition())
}, { deep: true })

// 进入编辑模式时自动聚焦
watch(isEditing, async (val) => {
  if (val) {
    await nextTick()
    textareaRef.value?.focus()
  }
})

function adjustPosition() {
  if (!cardRef.value) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 8
  const margin = 16
  const maxW = Math.min(360, vw - margin * 2)

  let x = props.position.x
  if (x + maxW > vw - margin) x = vw - margin - maxW
  if (x < margin) x = margin

  let y = props.position.y + gap
  let placeAbove = false
  if (y + 200 > vh - margin) {
    placeAbove = true
    y = props.position.y - gap
  }
  if (y < margin) { placeAbove = false; y = margin }

  adjustedPos.value = { x, y, placeAbove }

  nextTick(() => {
    if (!cardRef.value) return
    const r = cardRef.value.getBoundingClientRect()

    if (!adjustedPos.value.placeAbove && r.bottom > vh - margin) {
      adjustedPos.value = { x: adjustedPos.value.x, y: props.position.y - r.height - gap, placeAbove: true }
      if (adjustedPos.value.y < margin) adjustedPos.value = { ...adjustedPos.value, y: margin, placeAbove: false }
    }
    if (adjustedPos.value.placeAbove && r.bottom > vh - margin) {
      adjustedPos.value = { ...adjustedPos.value, y: vh - margin - r.height }
    }
    if (adjustedPos.value.y < margin) adjustedPos.value = { ...adjustedPos.value, y: margin }
    if (adjustedPos.value.x + r.width > vw - margin) adjustedPos.value = { ...adjustedPos.value, x: vw - margin - r.width }
    if (adjustedPos.value.x < margin) adjustedPos.value = { ...adjustedPos.value, x: margin }
  })
}

function startEdit() {
  editNote.value = props.annotation.note || ''
  // 锁定当前尺寸避免编辑模式卡片变形
  if (cardRef.value) {
    const { width, height } = cardRef.value.getBoundingClientRect()
    cardRef.value.style.width = width + 'px'
    cardRef.value.style.minHeight = height + 'px'
  }
  isEditing.value = true
}

function saveNote() {
  emit('save', props.annotation.id, editNote.value)
  // 解锁尺寸
  if (cardRef.value) {
    cardRef.value.style.width = ''
    cardRef.value.style.minHeight = ''
  }
  isEditing.value = false
}

// 键盘事件：Delete 键删除批注
function onKeyDown(e) {
  if (!props.visible) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    // 编辑模式下且在 textarea 内不拦截（允许正常删除文字）
    if (isEditing.value && document.activeElement === textareaRef.value) return
    e.preventDefault()
    emit('delete', props.annotation.id)
  }
}

onMounted(() => document.addEventListener('keydown', onKeyDown))
onUnmounted(() => document.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <Transition :name="adjustedPos.placeAbove ? 'card-up' : 'card-down'">
    <div
      v-if="visible"
      ref="cardRef"
      class="annot-card"
      :class="{ 'place-above': adjustedPos.placeAbove, 'is-editing': isEditing }"
      :style="{ left: adjustedPos.x + 'px', top: adjustedPos.y + 'px' }"
      @wheel.prevent.stop
      @click.stop
      @mouseenter="$emit('mouseenter')"
      @mouseleave="$emit('mouseleave')"
    >
      <div class="card-arrow"></div>

      <!-- 查看模式：显示注释内容，点击进入编辑 -->
      <template v-if="!isEditing">
        <div v-if="annotation.note" class="card-note" @click="startEdit">{{ annotation.note }}</div>
        <div v-else class="card-note-empty" @click="startEdit">暂无注释，点击编辑</div>
      </template>

      <!-- 编辑模式 -->
      <template v-else>
        <textarea
          ref="textareaRef"
          v-model="editNote"
          class="card-textarea"
          placeholder="输入注释内容..."
          rows="3"
          @blur="saveNote"
          @keydown.ctrl.enter="saveNote"
        ></textarea>
      </template>
    </div>
  </Transition>
</template>

<style scoped>
.annot-card {
  position: fixed;
  z-index: 9998;
  min-width: 300px;
  max-width: 440px;
  max-height: 55vh;
  overflow-y: auto;
  background: linear-gradient(145deg, #fefefe 0%, #f9f7f4 100%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 14px;
  box-shadow:
    0 4px 6px rgba(0, 0, 0, 0.04),
    0 10px 30px rgba(0, 0, 0, 0.08),
    0 20px 60px rgba(0, 0, 0, 0.06);
  padding: 14px 16px 12px;
  font-size: 13px;
  color: #2d3748;
  box-sizing: border-box;
  overflow-wrap: break-word;
  word-break: break-word;
  backdrop-filter: blur(10px);
}

.card-arrow {
  position: absolute;
  left: 24px;
  width: 0;
  height: 0;
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
}
.annot-card:not(.place-above) .card-arrow {
  top: -9px;
  border-bottom: 9px solid #fefefe;
  filter: drop-shadow(0 -2px 2px rgba(0, 0, 0, 0.03));
}
.annot-card.place-above .card-arrow {
  bottom: -9px;
  border-top: 9px solid #f9f7f4;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.03));
}

.card-note {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 0.9rem;
  color: #2d3748;
  line-height: 1.7;
  padding: 6px 4px;
  white-space: pre-wrap;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.2s, box-shadow 0.2s;
}
.card-note:hover {
  background: rgba(139, 58, 42, 0.04);
  box-shadow: inset 0 0 0 1px rgba(139, 58, 42, 0.08);
}
.card-note-empty {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 0.9rem;
  color: #a0aec0;
  font-style: italic;
  padding: 6px 4px;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s;
}
.card-note-empty:hover {
  background: rgba(0, 0, 0, 0.03);
  color: #718096;
}

.annot-card.is-editing {
  display: flex;
  flex-direction: column;
}
.card-textarea {
  flex: 1;
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 13px;
  line-height: 1.6;
  color: #2d3748;
  background: #fff;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
  min-height: 80px;
  max-height: 40vh;
}
.card-textarea:focus {
  border-color: #8b3a2a;
  box-shadow: 0 0 0 3px rgba(139, 58, 42, 0.08);
}

/* 过渡动画 — 向下展开 */
.card-down-enter-active { transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
.card-down-leave-active { transition: all 0.15s ease-in; }
.card-down-enter-from { opacity: 0; transform: translateY(10px) scale(0.95); }
.card-down-leave-to { opacity: 0; transform: translateY(-6px) scale(0.95); }

/* 过渡动画 — 向上展开 */
.card-up-enter-active { transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
.card-up-leave-active { transition: all 0.15s ease-in; }
.card-up-enter-from { opacity: 0; transform: translateY(-10px) scale(0.95); }
.card-up-leave-to { opacity: 0; transform: translateY(6px) scale(0.95); }
</style>
