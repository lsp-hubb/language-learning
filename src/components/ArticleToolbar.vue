<script setup>
defineProps({
  isEditing: Boolean,
  saving: Boolean,
  canSave: Boolean,
  timerDisplay: String,
  timerRunning: Boolean,
  wordCount: Number,
  showLeftPanel: Boolean,
  fontSize: { type: Number, default: 16 },
})
const emit = defineEmits(['back', 'startEdit', 'cancelEdit', 'saveEdit', 'toggleTimer', 'toggleLink', 'changeFontSize'])
</script>

<template>
  <div class="page-width">
    <div class="tb-left">
      <button class="back-btn" @click="emit('back')"><span class="back-arrow">←</span> Back</button>
      <template v-if="!isEditing">
        <button class="act-btn act-edit" @click="emit('startEdit')">✎ Edit</button>
        <span class="font-size-group">
          <button class="fs-btn" title="缩小字号" @click="emit('changeFontSize', -1)">A−</button>
          <span class="fs-value">{{ fontSize }}</span>
          <button class="fs-btn" title="增大字号" @click="emit('changeFontSize', 1)">A+</button>
        </span>
      </template>
      <template v-else>
        <button class="act-btn act-cancel" @click="emit('cancelEdit')">Cancel</button>
        <button class="act-btn act-save" :disabled="!canSave" @click="emit('saveEdit')">
          {{ saving ? 'Saving...' : '✓ Save' }}
        </button>
      </template>
    </div>
    <div class="tb-right">
      <span class="reading-timer" :class="{ running: timerRunning }" @click="emit('toggleTimer')"
        >阅读计时：{{ timerDisplay }}</span
      >
      <span class="word-count">{{ wordCount }} words</span>
      <button class="link-toggle" :class="{ active: showLeftPanel }" @click="emit('toggleLink')">
        链接
      </button>
    </div>
  </div>
</template>

<style scoped>
.page-width {
  width: 100%;
  max-width: 1080px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  margin-bottom: 10px;
  box-sizing: border-box;
}
.tb-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.word-count {
  font-size: 12px;
  color: #8a7a66;
  white-space: nowrap;
  user-select: none;
}
.reading-timer {
  font-size: 12px;
  color: #8a7a66;
  white-space: nowrap;
  user-select: none;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  font-variant-numeric: tabular-nums;
}
.reading-timer:hover {
  background: #f0ebe4;
  color: #5a4a36;
}
.reading-timer.running {
  color: #e74c3c;
  font-weight: 500;
}
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #d4c5b0;
  background: transparent;
  color: #6b5a3e;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 16px;
  border-radius: 20px;
  transition: all 0.2s ease;
}
.back-arrow {
  font-size: 15px;
  transition: transform 0.2s ease;
}
.back-btn:hover {
  background: #fcf9f4;
  border-color: #c4a87c;
  color: #8b3a2a;
}
.back-btn:hover .back-arrow {
  transform: translateX(-3px);
}
.act-btn {
  border: none;
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.act-edit {
  background: transparent;
  color: #6b5a3e;
}
.act-edit:hover {
  background: rgba(139, 58, 42, 0.06);
  color: #8b3a2a;
}
.act-cancel {
  background: #e8e8e8;
  color: #555;
}
.act-cancel:hover {
  background: #d4d4d4;
}
.act-save {
  background: #8b3a2a;
  color: #fff;
}
.act-save:hover:not(:disabled) {
  background: #6b2a1a;
}
.act-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.tb-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.font-size-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  user-select: none;
}
.fs-btn {
  border: 1px solid #d4c5b0;
  background: transparent;
  color: #6b5a3e;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1.2;
  transition: all 0.15s;
}
.fs-btn:hover {
  background: #f0e8d8;
  border-color: #8b3a2a;
}
.fs-value {
  font-size: 11px;
  color: #8a7a66;
  min-width: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.link-toggle {
  border: 1px solid #d4c5b0;
  background: transparent;
  color: #6b5a3e;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 5px 14px;
  border-radius: 20px;
  white-space: nowrap;
  transition: all 0.2s;
}
.link-toggle:hover {
  background: #f0e8d8;
  border-color: #8b3a2a;
}
.link-toggle.active {
  background: #8b3a2a;
  color: #fff;
  border-color: #8b3a2a;
}
</style>
