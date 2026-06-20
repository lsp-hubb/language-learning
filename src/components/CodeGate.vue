<script setup>
import { onMounted } from 'vue'

const emit = defineEmits(['verified'])

onMounted(() => {
  emit('verified')
})
</script>

<template>
</template>

<style scoped>
.gate-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
}
.gate-card {
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  padding: 36px 32px 28px;
  width: 340px;
  max-width: 90vw;
  text-align: center;
  box-sizing: border-box;
}
.gate-icon {
  font-size: 42px;
  margin-bottom: 12px;
}
.gate-title {
  font-size: 20px;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 8px;
}
.gate-desc {
  font-size: 14px;
  color: #64748b;
  margin: 0 0 20px;
}
.gate-input {
  width: 100%;
  padding: 10px 14px;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  font-size: 18px;
  text-align: center;
  letter-spacing: 6px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
  font-family: 'Consolas', 'Courier New', monospace;
}
.gate-input:focus {
  border-color: #4b6cb7;
  box-shadow: 0 0 0 3px rgba(75, 108, 183, 0.15);
}
.gate-error {
  color: #e74c3c;
  font-size: 13px;
  margin: 10px 0 0;
}
.gate-btn {
  width: 100%;
  margin-top: 16px;
  padding: 10px 0;
  border: none;
  border-radius: 8px;
  background: #4b6cb7;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
.gate-btn:hover:not(:disabled) {
  background: #3b5998;
}
.gate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.gate-hint {
  margin-top: 16px;
  font-size: 12px;
  color: #94a3b8;
}
</style>
