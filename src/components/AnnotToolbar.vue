<script setup>
defineProps({
  visible: Boolean,
  position: { type: Object, default: () => ({ x: 0, y: 0 }) },
})
const emit = defineEmits(['highlight', 'underline'])
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="annot-toolbar"
      :style="{ left: position.x + 'px', top: position.y + 'px' }"
      @click.stop
      @wheel.prevent.stop
    >
      <button class="tb-btn tb-highlight" title="黄色高亮" @click="emit('highlight')">
        <svg viewBox="0 0 22 20" width="22" height="20">
          <rect x="1" y="1" width="20" height="18" rx="3" fill="#FFEB3B"/>
          <text x="11" y="15" text-anchor="middle" font-size="15" font-weight="700" fill="#333" font-family="Georgia,serif">T</text>
        </svg>
      </button>
      <div class="tb-divider"></div>
      <button class="tb-btn tb-underline" title="红色下划线" @click="emit('underline')">
        <svg viewBox="0 0 22 20" width="22" height="20">
          <text x="11" y="15" text-anchor="middle" font-size="15" font-weight="700" fill="#333" font-family="Georgia,serif">T</text>
          <line x1="3" y1="17" x2="19" y2="17" stroke="#e74c3c" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.annot-toolbar {
  position: fixed;
  z-index: 9997;
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 6px 8px;
  transform: translate(-50%, -100%);
  user-select: none;
}
.tb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1.5px solid transparent;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s;
}
.tb-btn:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}
.tb-divider {
  width: 1px;
  height: 20px;
  background: #e2e8f0;
  margin: 0 4px;
}
</style>
