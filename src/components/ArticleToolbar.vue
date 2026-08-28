<script setup>
defineProps({
  isEditing: Boolean,
  saving: Boolean,
  canSave: Boolean,
  timerDisplay: String,
  timerRunning: Boolean,
  wordCount: Number,
  showLeftPanel: Boolean,
  panelMode: { type: String, default: 'link' },
  fontSize: { type: Number, default: 16 },
  annotToolbarEnabled: { type: Boolean, default: true },
})
const emit = defineEmits(['back', 'startEdit', 'cancelEdit', 'saveEdit', 'toggleTimer', 'toggleLink', 'toggleNote', 'changeFontSize', 'toggleAnnotToolbar', 'highlight', 'underline'])
</script>

<template>
  <div class="reader-toolbar">
    <div class="toolbar-left">
      <el-button text size="small" @click="emit('back')">
        <span class="back-arrow">←</span>&nbsp;返回列表
      </el-button>
      <template v-if="!isEditing">
        <el-button
          class="act-edit"
          text
          size="small"
          title="编辑文章"
          @click="emit('startEdit')"
        >
          <svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor" style="margin-right:4px;vertical-align:-1px">
            <path d="M469.333333 128a42.666667 42.666667 0 0 1 0 85.333333H213.333333v597.333334h597.333334v-256l0.298666-4.992A42.666667 42.666667 0 0 1 896 554.666667v256a85.333333 85.333333 0 0 1-85.333333 85.333333H213.333333a85.333333 85.333333 0 0 1-85.333333-85.333333V213.333333a85.333333 85.333333 0 0 1 85.333333-85.333333z m414.72 12.501333a42.666667 42.666667 0 0 1 0 60.330667L491.861333 593.066667a42.666667 42.666667 0 0 1-60.330666-60.330667l392.192-392.192a42.666667 42.666667 0 0 1 60.330666 0z"/>
          </svg>
          编辑
        </el-button>
        <span class="font-size-group">
          <el-button size="small" title="缩小字号" @click="emit('changeFontSize', -1)">A−</el-button>
          <span class="fs-value">{{ fontSize }}</span>
          <el-button size="small" title="增大字号" @click="emit('changeFontSize', 1)">A+</el-button>
        </span>
      </template>
      <template v-else>
        <el-button size="small" @click="emit('cancelEdit')">Cancel</el-button>
        <el-button
          size="small"
          type="primary"
          :disabled="!canSave"
          :loading="saving"
          @click="emit('saveEdit')"
        >✓ Save</el-button>
      </template>
    </div>

    <div class="toolbar-right">
      <template v-if="!isEditing">
        <template v-if="!annotToolbarEnabled">
          <button class="tb-inline-annot tb-inline-hl" title="黄色高亮 (E)" @click="emit('highlight')">
            <svg viewBox="0 0 22 20" width="20" height="18" fill="none">
              <rect x="1" y="1" width="20" height="18" rx="3" fill="#FFEB3B"/>
              <text x="11" y="15" text-anchor="middle" font-size="15" font-weight="700" fill="#333" font-family="Georgia,serif">T</text>
            </svg>
          </button>
          <button class="tb-inline-annot tb-inline-ul" title="红色下划线 (W)" @click="emit('underline')">
            <svg viewBox="0 0 22 20" width="20" height="18" fill="none">
              <text x="11" y="15" text-anchor="middle" font-size="15" font-weight="700" fill="#333" font-family="Georgia,serif">T</text>
              <line x1="3" y1="17" x2="19" y2="17" stroke="#e74c3c" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </button>
        </template>
        <button
          class="annot-toggle"
          :class="{ active: annotToolbarEnabled }"
          :title="annotToolbarEnabled ? '禁用浮动批注栏' : '启用浮动批注栏'"
          @click="emit('toggleAnnotToolbar')"
        ><span class="annot-toggle-arrow">{{ annotToolbarEnabled ? '▲' : '▼' }}</span></button>
        <span class="tb-item">
          <span class="tb-label">计时</span>
          <el-button
            text
            size="small"
            :type="timerRunning ? 'danger' : ''"
            @click="emit('toggleTimer')"
          >{{ timerDisplay }}</el-button>
        </span>
        <span class="word-count">{{ wordCount }} words</span>
        <el-button
          size="small"
          :type="showLeftPanel && panelMode === 'link' ? 'primary' : ''"
          @click="emit('toggleLink')"
        >AI</el-button>
        <el-button
          size="small"
          :type="showLeftPanel && panelMode === 'note' ? 'primary' : ''"
          @click="emit('toggleNote')"
        >笔记</el-button>
      </template>
      <template v-else>
        <span class="edit-indicator">编辑中…</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.reader-toolbar {
  width: 100%;
  max-width: 960px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  margin-bottom: 0;
  min-height: 40px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-bottom: none;
  border-radius: 12px 12px 0 0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  box-sizing: border-box;
}
.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 关闭换行：批注内嵌按钮显隐时，禁止工具栏换行导致高度/布局扰动 */
  flex-wrap: nowrap;
  min-width: 0;
  white-space: nowrap;
}
.back-arrow {
  font-size: 15px;
  transition: transform 0.2s ease;
}
.toolbar-left .el-button:hover .back-arrow {
  transform: translateX(-3px);
}
.font-size-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  user-select: none;
}
.fs-value {
  font-size: 11px;
  color: #8a7a66;
  min-width: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.word-count {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
  user-select: none;
  margin: 0 4px;
}
.tb-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 2px;
}
.tb-label {
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
  user-select: none;
}
.edit-indicator {
  font-size: 12px;
  color: #e6a23c;
  font-weight: 500;
  user-select: none;
}
.annot-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d4c5b0;
  background: transparent;
  color: #8a7a66;
  cursor: pointer;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  transition: all 0.2s;
  line-height: 1;
  padding: 0;
}
.annot-toggle:hover {
  background: #f0e8d8;
  border-color: #8b3a2a;
  color: #5a4a36;
}
.annot-toggle.active {
  background: #8b3a2a;
  color: #fff;
  border-color: #8b3a2a;
}
.annot-toggle-arrow {
  font-size: 11px;
  line-height: 1;
}
.tb-inline-annot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s;
}
.tb-inline-annot:hover {
  background: #f0e8d8;
  border-color: #d4c5b0;
}
</style>
