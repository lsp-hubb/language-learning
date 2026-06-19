import { ref, computed, onUnmounted } from 'vue'

export function useTimer() {
  const timerRunning = ref(false)
  const timerSeconds = ref(0)
  let timerInterval = null

  const timerDisplay = computed(() => {
    const m = String(Math.floor(timerSeconds.value / 60)).padStart(2, '0')
    const s = String(timerSeconds.value % 60).padStart(2, '0')
    return `${m}:${s}`
  })

  function toggleTimer() {
    if (timerRunning.value) {
      timerRunning.value = false
      clearInterval(timerInterval)
      timerInterval = null
    } else if (timerSeconds.value > 0) {
      timerSeconds.value = 0
    } else {
      timerRunning.value = true
      timerInterval = setInterval(() => { timerSeconds.value++ }, 1000)
    }
  }

  onUnmounted(() => {
    clearInterval(timerInterval)
    timerInterval = null
  })

  return { timerRunning, timerDisplay, toggleTimer }
}
