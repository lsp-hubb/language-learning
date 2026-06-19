import { ref, watch } from 'vue'

export function useCanvas(closeWordCard, closeAnnotationCard, hideAnnotToolbar) {
  const drawMode = ref(false)
  const drawActive = ref(false)
  const drawTool = ref('pen')
  const drawColor = ref('#e74c3c')
  const drawColors = ['#e74c3c', '#2c3e50', '#3498db', '#27ae60', '#f39c12', '#9b59b6']

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
