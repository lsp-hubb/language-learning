import { ref } from 'vue'
import { lookupWord } from '@/api'

export function useWordLookup() {
  const wordLookupEnabled = ref(false)
  const selectedWord = ref('')
  const wordResult = ref({})
  const wordCardPos = ref({ x: 0, y: 0 })
  const showManualCard = ref(false)
  const showWordCard = ref(false)
  let lookupTimer = null
  let lookupAbortController = null

  function onTextSelection(mouseX, mouseY) {
    if (!wordLookupEnabled.value) return
    const selection = window.getSelection()
    const raw = selection?.toString()
    if (!raw) return

    let text = raw.split('\n').join(' ').trim()
    if (!text) return

    const punc = '.,;:!?"\'，。！？；：、·…`()（）[]{}<>《》【】'
    while (punc.includes(text[0])) text = text.slice(1).trim()
    while (punc.includes(text[text.length - 1])) text = text.slice(0, -1).trim()
    if (!text) return

    if (/[/\\]/.test(text)) return
    if (text.split('.').pop()?.match(/^(png|jpg|jpeg|gif|txt|exe|pdf|py|js|ts|css|html|json)$/i)) return
    if (/^\d+$/.test(text)) return
    if (!/[a-zA-Z]{2,}/.test(text)) return

    const word = text.toLowerCase()
    if (word === selectedWord.value) return

    selectedWord.value = word
    wordCardPos.value = { x: mouseX ?? 0, y: (mouseY ?? 0) + 8 }

    clearTimeout(lookupTimer)
    wordResult.value = {}
    lookupTimer = setTimeout(async () => {
      if (lookupAbortController) lookupAbortController.abort()
      lookupAbortController = new AbortController()
      showWordCard.value = true
      try {
        const res = await lookupWord(word, lookupAbortController.signal)
        wordResult.value = res
      } catch (err) {
        if (err.name === 'AbortError') return
      }
    }, 0)
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
    onTextSelection, closeWordCard, cleanupLookup,
  }
}
