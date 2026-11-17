import { ref, watch } from 'vue'

export function useCanvas(closeWordCard, closeAnnotationCard, hideAnnotToolbar) {
  const drawMode = ref(true) // 画布默认开启（工具态仍默认关闭，不拦截正文）
  const drawActive = ref(false)
  const drawTool = ref('eraser')
  const drawColor = ref('#f08200')

  watch(drawActive, (val) => {
    if (val) {
      closeWordCard()
      closeAnnotationCard()
      hideAnnotToolbar()
      window.getSelection()?.removeAllRanges()
    }
  })

  function closeCanvas() {
    drawMode.value = false
    drawActive.value = false
  }

  return { drawMode, drawActive, drawTool, drawColor, closeCanvas }
}
