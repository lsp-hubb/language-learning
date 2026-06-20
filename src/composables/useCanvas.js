import { ref, watch } from 'vue'

export function useCanvas(closeWordCard, closeAnnotationCard, hideAnnotToolbar) {
  const drawMode = ref(false)
  const drawActive = ref(false)
  const drawTool = ref('pen')
  const drawColor = ref('#e74c3c')
  const drawColors = ['#e74c3c', '#1c2833', '#1f6ea8', '#1a7a42', '#b9770e', '#76448a']

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

  return { drawMode, drawActive, drawTool, drawColor, drawColors, closeCanvas }
}
