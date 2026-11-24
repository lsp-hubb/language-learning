import { ref, watch } from 'vue'
import { lookupWord } from '@/api'
import { normalizeLookupText, lookupErrorMessage } from '@/utils/wordQuery'

// 查词开关持久化：记住退出前的状态，下次进入文章页恢复（不再固定为默认）。
// 单个 key 存两个开关；读取失败回退旧默认（自动查词关 / 手动查词开）。
const LOOKUP_SETTINGS_KEY = 'wordLookupSettings'
function loadLookupSettings() {
  try {
    const raw = localStorage.getItem(LOOKUP_SETTINGS_KEY)
    if (!raw) return { auto: false, manual: true }
    const o = JSON.parse(raw)
    return {
      auto: typeof o.auto === 'boolean' ? o.auto : false,
      manual: typeof o.manual === 'boolean' ? o.manual : true,
    }
  } catch {
    return { auto: false, manual: true }
  }
}

export function useWordLookup() {
  const saved = loadLookupSettings()
  const wordLookupEnabled = ref(saved.auto)
  const selectedWord = ref('')
  const wordResult = ref({})
  const wordCardPos = ref({ x: 0, y: 0 })
  const showManualCard = ref(saved.manual)
  const showWordCard = ref(false)
  // 任一开关变化即写入 localStorage（覆盖工具栏 / T 键 / Ctrl+Shift+Z / 面板关闭等所有入口）
  watch([wordLookupEnabled, showManualCard], ([auto, manual]) => {
    try {
      localStorage.setItem(LOOKUP_SETTINGS_KEY, JSON.stringify({ auto, manual }))
    } catch {}
  })
  let lookupTimer = null
  let lookupAbortController = null
  let lookupToken = 0
  let lastLookupWord = ''

  function onTextSelection(mouseX, mouseY) {
    if (!wordLookupEnabled.value) return
    const selection = window.getSelection()
    const text = normalizeLookupText(selection?.toString())
    if (!text) return

    const word = text
    if (word === selectedWord.value) return

    selectedWord.value = word
    lastLookupWord = word
    wordCardPos.value = { x: mouseX ?? 0, y: (mouseY ?? 0) + 8 }

    clearTimeout(lookupTimer)
    wordResult.value = {}
    lookupTimer = setTimeout(() => runLookup(word), 0)
  }

  async function runLookup(word) {
    if (lookupAbortController) lookupAbortController.abort()
    lookupAbortController = new AbortController()
    const token = ++lookupToken
    showWordCard.value = true
    try {
      const res = await lookupWord(word, lookupAbortController.signal)
      if (token !== lookupToken) return
      wordResult.value = res
    } catch (err) {
      if (err.name === 'AbortError' || token !== lookupToken) return
      // 失败写入 error，让 WordCard 显示错误态而非永久 loading
      wordResult.value = { error: lookupErrorMessage(err) }
    }
  }

  // 划词卡片错误态的「重试」入口
  function retryLookup() {
    if (lastLookupWord) runLookup(lastLookupWord)
  }

  function closeWordCard() {
    showWordCard.value = false
    selectedWord.value = ''
    wordResult.value = {}
    clearTimeout(lookupTimer)
    if (lookupAbortController && !lookupAbortController.signal.aborted) {
      lookupAbortController.abort()
    }
    lookupAbortController = null
  }

  function cleanupLookup() {
    clearTimeout(lookupTimer)
    if (lookupAbortController) {
      lookupAbortController.abort()
      lookupAbortController = null
    }
  }

  return {
    wordLookupEnabled, selectedWord, wordResult, wordCardPos,
    showManualCard, showWordCard,
    onTextSelection, closeWordCard, cleanupLookup, retryLookup,
  }
}
