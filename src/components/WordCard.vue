<script setup>
import { ref, watch, nextTick, computed } from 'vue'

const props = defineProps({
  word: { type: String, default: '' },
  result: { type: Object, default: () => ({}) },
  visible: { type: Boolean, default: false },
  position: { type: Object, default: () => ({ x: 0, y: 0 }) },
})

const emit = defineEmits(['close'])

const cardRef = ref(null)
const adjustedPos = ref({ x: 0, y: 0, placeAbove: false })

watch(() => props.visible, async (val) => {
  if (val) {
    await nextTick()
    adjustPosition()
  }
})

watch(() => props.position, () => {
  if (props.visible) nextTick(() => adjustPosition())
}, { deep: true })

// 结果返回后卡片尺寸变化，重新定位
watch(() => props.result, () => {
  if (props.visible && props.result.word) nextTick(() => adjustPosition())
}, { deep: true })

function adjustPosition() {
  if (!cardRef.value) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 8
  const margin = 16

  // 先求理想 maxWidth（不超视口）
  const maxW = Math.min(360, vw - margin * 2)

  // 水平：尽量让卡片左边缘对齐选中位置，右溢出则改右对齐
  let x = props.position.x
  if (x + maxW > vw - margin) {
    x = vw - margin - maxW        // 贴右
  }
  if (x < margin) x = margin      // 贴左

  // 垂直：优先放在下方
  let y = props.position.y + gap
  let placeAbove = false

  // 如果下方放不下，尝试放在上方
  // （先做一次估算，取典型高度 200px）
  if (y + 200 > vh - margin) {
    placeAbove = true
    y = props.position.y - gap
  }
  if (y < margin) {
    // 上下都放不下，强制贴顶
    placeAbove = false
    y = margin
  }

  adjustedPos.value = { x, y, placeAbove }

  // 二次校正：获取卡片真实尺寸后微调
  nextTick(() => {
    if (!cardRef.value) return
    const r = cardRef.value.getBoundingClientRect()

    // 下方溢出 → 移到上方
    if (!adjustedPos.value.placeAbove && r.bottom > vh - margin) {
      adjustedPos.value = {
        x: adjustedPos.value.x,
        y: props.position.y - r.height - gap,
        placeAbove: true,
      }
      // 移到上方后仍溢出底部 → 直接贴顶
      if (props.position.y - r.height - gap + r.height > vh - margin) {
        adjustedPos.value = { ...adjustedPos.value, y: margin, placeAbove: false }
      }
    }

    // 已在上方但仍溢出底部 → 上移使底部不超出
    if (adjustedPos.value.placeAbove && r.bottom > vh - margin) {
      adjustedPos.value = { ...adjustedPos.value, y: vh - margin - r.height }
    }

    // 顶部溢出 → 贴顶
    if (adjustedPos.value.y < margin) {
      adjustedPos.value = { ...adjustedPos.value, y: margin }
    }

    // 右/左贴边二次确认
    if (adjustedPos.value.x + r.width > vw - margin) {
      adjustedPos.value = { ...adjustedPos.value, x: vw - margin - r.width }
    }
    if (adjustedPos.value.x < margin) {
      adjustedPos.value = { ...adjustedPos.value, x: margin }
    }
  })
}

const isLoaded = computed(() => props.result.word !== undefined)
const hasDefs = computed(() => props.result.definitions?.length > 0)
const hasError = computed(() => !!props.result.error)
const isLoading = computed(() => props.visible && !!props.word && !isLoaded.value)
const isLongQuery = computed(() => props.word.split(/\s+/).length > 5)
</script>

<template>
  <Transition :name="adjustedPos.placeAbove ? 'card-up' : 'card-down'">
    <div
      v-if="visible"
      ref="cardRef"
      class="word-card"
      :class="{ 'place-above': adjustedPos.placeAbove }"
      :style="{ left: adjustedPos.x + 'px', top: adjustedPos.y + 'px' }"
      @wheel.prevent.stop
    >
      <div class="card-arrow"></div>
      <button class="card-close" @click="emit('close')">✕</button>

      <div v-if="isLoading" class="card-loading">
        <div class="spinner"></div>
        <span>查询中...</span>
      </div>

      <div v-else-if="hasError" class="card-error">{{ result.error }}</div>

      <div v-else-if="!hasDefs && !result.translation" class="card-empty">未找到释义</div>

      <div v-else class="card-body">
        <template v-if="!isLongQuery">
          <div class="card-word">{{ result.word }}</div>
          <div v-if="result.phonetic_uk || result.phonetic_us" class="card-phonetic">
            <span v-if="result.phonetic_uk" class="phone">英 {{ result.phonetic_uk }}</span>
            <span v-if="result.phonetic_us" class="phone">美 {{ result.phonetic_us }}</span>
          </div>
        </template>
        <div v-if="hasDefs" class="card-defs">
          <div v-for="(def, i) in result.definitions" :key="i" class="card-def">
            <span class="def-pos">{{ def.part_of_speech }}</span>
            <span class="def-text">{{ def.translation }}</span>
          </div>
        </div>
        <div v-else-if="result.translation" class="card-translation">
          {{ result.translation }}
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.word-card {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  max-width: 380px;
  max-height: 60vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
  padding: 12px 14px;
  font-size: 13px;
  color: #1e293b;
  box-sizing: border-box;
  overflow-wrap: break-word;
  word-break: break-word;
}

/* 指向选中词的小三角 */
.card-arrow {
  position: absolute;
  left: 24px;
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
}
.word-card:not(.place-above) .card-arrow {
  top: -8px;
  border-bottom: 8px solid #fff;
}
.word-card.place-above .card-arrow {
  bottom: -8px;
  border-top: 8px solid #fff;
}
.card-close {
  position: absolute;
  top: 6px;
  right: 10px;
  border: none;
  background: none;
  font-size: 16px;
  color: #94a3b8;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s;
  line-height: 1;
}
.card-close:hover {
  color: #475569;
  background: #f1f5f9;
}
.card-word {
  font-size: 1.2rem;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 4px;
  padding-right: 20px;
}
.card-phonetic {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}
.phone {
  font-size: 0.8rem;
  color: #64748b;
  font-family: 'Segoe UI', Arial, sans-serif;
}
.card-defs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.card-def {
  font-size: 0.85rem;
  line-height: 1.5;
}
.def-pos {
  display: inline-block;
  color: #4b6cb7;
  font-weight: 600;
  margin-right: 6px;
  font-size: 0.75rem;
}
.def-text {
  color: #334155;
}
.card-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #64748b;
  font-size: 0.9rem;
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #e2e8f0;
  border-top-color: #4b6cb7;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.card-error {
  color: #e74c3c;
  font-size: 0.9rem;
}
.card-empty {
  color: #94a3b8;
  font-size: 0.9rem;
}
.card-translation {
  font-size: 0.85rem;
  line-height: 1.6;
  color: #334155;
  margin-top: 6px;
}

/* 过渡 — 向下展开 */
.card-down-enter-active {
  transition: all 0.2s ease-out;
}
.card-down-leave-active {
  transition: all 0.15s ease-in;
}
.card-down-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
.card-down-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

/* 过渡 — 向上展开 */
.card-up-enter-active {
  transition: all 0.2s ease-out;
}
.card-up-leave-active {
  transition: all 0.15s ease-in;
}
.card-up-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}
.card-up-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.96);
}
</style>
