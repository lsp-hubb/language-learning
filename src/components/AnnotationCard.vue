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
  const maxW = Math.min(340, vw - margin * 2)

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
    const orig = { ...adjustedPos.value }

    if (!orig.placeAbove && r.bottom > vh - margin) {
      adjustedPos.value = { x: orig.x, y: props.position.y - r.height - gap, placeAbove: true }
    }
    if (adjustedPos.value.y < margin) {
      adjustedPos.value = { ...adjustedPos.value, y: margin }
    }
    if (adjustedPos.value.x + r.width > vw - margin) {
      adjustedPos.value = { ...adjustedPos.value, x: vw - margin - r.width }
    }
    if (adjustedPos.value.x < margin) {
      adjustedPos.value = { ...adjustedPos.value, x: margin }
    }
  })
}

function startEdit() {
  editNote.value = props.annotation.note || ''
  isEditing.value = true
  nextTick(() => adjustPosition())
}

function saveNote() {
  emit('save', props.annotation.id, editNote.value)
  isEditing.value = false
  nextTick(() => adjustPosition())
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
      :class="{ 'place-above': adjustedPos.placeAbove }"
      :style="{ left: adjustedPos.x + 'px', top: adjustedPos.y + 'px' }"
      @wheel.stop
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
        <div class="card-actions">
          <button class="act-delete" @click="emit('delete', annotation.id)">删除</button>
        </div>
      </template>
    </div>
  </Transition>
</template>

<style scoped>
.annot-card {
  position: fixed;
  z-index: 9998;
  min-width: 220px;
  max-width: 360px;
  max-height: 50vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
  padding: 12px 14px 10px;
  font-size: 13px;
  color: #1e293b;
  box-sizing: border-box;
  overflow-wrap: break-word;
  word-break: break-word;
}

.card-arrow {
  position: absolute;
  left: 24px;
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
}
.annot-card:not(.place-above) .card-arrow {
  top: -8px;
  border-bottom: 8px solid #fff;
}
.annot-card.place-above .card-arrow {
  bottom: -8px;
  border-top: 8px solid #fff;
}

.card-note {
  font-size: 0.85rem;
  color: #475569;
  line-height: 1.6;
  padding: 4px 0;
  white-space: pre-wrap;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}
.card-note:hover {
  background: #f8fafc;
}
.card-note-empty {
  font-size: 0.85rem;
  color: #94a3b8;
  font-style: italic;
  padding: 4px 0;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}
.card-note-empty:hover {
  background: #f8fafc;
  color: #64748b;
}

.card-textarea {
  width: 100%;
  margin-top: 4px;
  padding: 8px 10px;
  border: 1px solid #d4c5b0;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.6;
  color: #334155;
  background: #fefefe;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
  min-height: 60px;
}
.card-textarea:focus {
  border-color: #4b6cb7;
  box-shadow: 0 0 0 3px rgba(75, 108, 183, 0.1);
}

.card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 8px;
  gap: 6px;
}
.act-delete {
  border: none;
  background: none;
  color: #e74c3c;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s;
}
.act-delete:hover {
  background: #fee2e2;
}

/* 过渡动画 — 向下展开 */
.card-down-enter-active { transition: all 0.2s ease-out; }
.card-down-leave-active { transition: all 0.15s ease-in; }
.card-down-enter-from { opacity: 0; transform: translateY(8px) scale(0.96); }
.card-down-leave-to { opacity: 0; transform: translateY(-4px) scale(0.96); }

/* 过渡动画 — 向上展开 */
.card-up-enter-active { transition: all 0.2s ease-out; }
.card-up-leave-active { transition: all 0.15s ease-in; }
.card-up-enter-from { opacity: 0; transform: translateY(-8px) scale(0.96); }
.card-up-leave-to { opacity: 0; transform: translateY(4px) scale(0.96); }

/* 查看模式提示 */
.card-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 11px;
  color: #94a3b8;
}
.card-hint kbd {
  display: inline-block;
  padding: 1px 5px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  font-size: 10px;
  font-family: inherit;
}
</style>
