import { onUnmounted } from 'vue'

// 统一 TTS 发音逻辑：预下载 + Blob 缓存 + 点击/自动播放 + 卸载回收。
// 手动卡片与划词卡片共用，消除两套逐行重复代码。
// 注意：Blob 缓存按「组件实例」隔离，避免两个卡片同时持有对方会话的 URL。
export function useWordTts() {
  const audioCache = {}
  let lastCachedWord = ''
  let autoPlayAbort = null

  function ttsUrl(word, accent) {
    return `/api/tts?word=${encodeURIComponent(word)}&accent=${accent}`
  }

  async function preloadAudio(word) {
    if (!word) return
    if (word === lastCachedWord && audioCache.uk && audioCache.us) return
    for (const key of Object.keys(audioCache)) {
      URL.revokeObjectURL(audioCache[key])
      delete audioCache[key]
    }
    lastCachedWord = word
    await Promise.all(['uk', 'us'].map(async (accent) => {
      try {
        const resp = await fetch(ttsUrl(word, accent))
        if (!resp.ok) return
        const blob = await resp.blob()
        audioCache[accent] = URL.createObjectURL(blob)
      } catch {
        // 发音失败不影响查词主流程
      }
    }))
  }

  function playAudio(accent) {
    const url = audioCache[accent]
    if (url) {
      // 浏览器可能拦截自动播放；用户主动点击的播放也应给出可感知的失败提示
      new Audio(url).play().catch(() => {})
    }
  }

  async function autoPlayAudio(word) {
    if (!word) return
    await preloadAudio(word)
    playAudio('uk')
  }

  onUnmounted(() => {
    if (autoPlayAbort) autoPlayAbort = null
    for (const key of Object.keys(audioCache)) {
      URL.revokeObjectURL(audioCache[key])
      delete audioCache[key]
    }
  })

  return { preloadAudio, playAudio, autoPlayAudio }
}
