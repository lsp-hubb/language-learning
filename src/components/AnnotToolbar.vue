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
        <span class="tb-icon" style="background: #FFEB3B"></span>
      </button>
      <div class="tb-divider"></div>
      <button class="tb-btn tb-underline" title="红色下划线" @click="emit('underline')">
        <span class="tb-icon tb-icon-underline">U̲</span>
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
.tb-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 3px;
  font-size: 13px;
  line-height: 1;
}
.tb-icon-underline {
  font-weight: 700;
  font-size: 13px;
  color: #e74c3c;
  background: none !important;
}
.tb-divider {
  width: 1px;
  height: 20px;
  background: #e2e8f0;
  margin: 0 4px;
}
</style>
