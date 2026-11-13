import { ref, watch } from 'vue'

export function useCanvas(closeWordCard, closeAnnotationCard, hideAnnotToolbar) {
  const drawMode = ref(false)
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
