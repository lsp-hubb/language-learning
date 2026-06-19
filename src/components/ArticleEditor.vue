<script setup>
defineProps({
  title: String,
  content: String,
  saving: Boolean,
})
const emit = defineEmits(['update:title', 'update:content', 'save', 'cancel'])
</script>

<template>
  <div class="reader editor-mode">
    <input v-model.lazy="titleModel" class="editor-title" type="text" placeholder="文章标题" />
    <textarea
      v-model.lazy="contentModel"
      class="editor-textarea"
      spellcheck="false"
      placeholder="文章内容..."
    ></textarea>
  </div>
</template>

<style scoped>
.reader {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 1080px;
  background: #fcf9f4;
  border-radius: 12px;
  border: 1px solid #e8e0d4;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 24px 0 40px;
  align-items: center;
}
.editor-title {
  width: 100%;
  max-width: 800px;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid #d4c5b0;
  border-radius: 4px;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 28px;
  font-weight: 700;
  color: #1a1a1a;
  background: #fff;
  outline: none;
  flex-shrink: 0;
}
.editor-title:focus {
  border-color: #8b3a2a;
  box-shadow: 0 0 0 3px rgba(139, 58, 42, 0.1);
}
.editor-textarea {
  width: 100%;
  max-width: 800px;
  flex: 1;
  min-height: 0;
  padding: 12px;
  border: 1px solid #d4c5b0;
  border-radius: 4px;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 16px;
  line-height: 1.9;
  color: #2a2a2a;
  background: #fff;
  text-align: justify;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
  margin-top: 12px;
}
.editor-textarea:focus {
  border-color: #8b3a2a;
  box-shadow: 0 0 0 3px rgba(139, 58, 42, 0.1);
}
</style>
