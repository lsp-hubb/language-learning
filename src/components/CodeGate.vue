<script setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits(['verified'])

const code = ref('')
const error = ref('')
const checking = ref(false)
const isVerified = ref(false)

// 本机访问不需要验证
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

// sessionStorage 中已通过验证或本机则跳过
onMounted(() => {
  if (isLocal || sessionStorage.getItem('code_verified') === '1') {
    isVerified.value = true
    emit('verified')
  }
})

async function submitCode() {
  const input = code.value.trim()
  if (input.length < 4) {
    error.value = '请输入8位验证码'
    return
  }

  checking.value = true
  error.value = ''

  try {
    const res = await fetch('/api/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: input }),
    })
    const data = await res.json()

    if (data.ok) {
      sessionStorage.setItem('code_verified', '1')
      isVerified.value = true
      emit('verified')
    } else {
      error.value = data.message || '验证码错误，请重试'
      code.value = ''
    }
  } catch {
    error.value = '网络错误，请检查连接后重试'
  } finally {
    checking.value = false
  }
}

function onKeydown(e) {
  if (e.key === 'Enter') submitCode()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="!isVerified" class="gate-overlay">
      <div class="gate-card">
        <div class="gate-icon">🔐</div>
        <h2 class="gate-title">访问验证</h2>
        <p class="gate-desc">请输入 8 位访问验证码</p>

        <input
          v-model="code"
          class="gate-input"
          type="text"
          maxlength="8"
          placeholder="输入验证码"
          autocomplete="off"
          spellcheck="false"
          @keydown="onKeydown"
        />

        <p v-if="error" class="gate-error">{{ error }}</p>

        <button class="gate-btn" :disabled="checking" @click="submitCode">
          {{ checking ? '验证中...' : '确认' }}
        </button>

        <p class="gate-hint">验证码已显示在服务器终端中</p>
      </div>
    </div>
  </Teleport>
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
