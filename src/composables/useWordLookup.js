import { ref } from 'vue'
import { lookupWord } from '@/api'
import { normalizeLookupText, lookupErrorMessage } from '@/utils/wordQuery'

export function useWordLookup() {
  const wordLookupEnabled = ref(false)
  const selectedWord = ref('')
  const wordResult = ref({})
  const wordCardPos = ref({ x: 0, y: 0 })
  // 默认开启：进入文章页即显示手动查词卡片（关闭仍走 Ctrl+Shift+Z / 工具栏「查词」按钮）
  const showManualCard = ref(true)
  const showWordCard = ref(false)
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
