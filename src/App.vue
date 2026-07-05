<script setup>
import { ref, provide } from 'vue'
import { useRouter } from 'vue-router'
import CodeGate from '@/components/CodeGate.vue'
import NoteEditor from '@/components/NoteEditor.vue'

const router = useRouter()
const ready = ref(false)
const showSidePanel = ref(false)
provide('showSidePanel', showSidePanel)

// 侧面板模式: 'link' | 'note'
const panelMode = ref('link')
provide('panelMode', panelMode)

// 段落笔记共享状态（由 ArticlePage 填充）
const paragraphNotes = ref({})
const editingNotePara = ref(-1)
const saveNoteFn = { current: null }  // 普通对象，避免 ref 解包歧义
provide('paragraphNotes', paragraphNotes)
provide('editingNotePara', editingNotePara)
provide('saveParagraphNote', saveNoteFn)

function onVerified() {
  if (window.location.pathname === '/' || window.location.pathname === '') {
    const last = localStorage.getItem('lastPage')
    if (last && last.startsWith('article:')) {
      const articleId = last.slice(8)
      router.replace({ name: 'article', params: { id: articleId } })
    }
  }
  ready.value = true
}
</script>

<template>
  <CodeGate @verified="onVerified" />
  <div v-if="ready">
    <router-view />
    <div class="side-panel" :class="{ visible: showSidePanel }">
      <div class="panel-tabs">
        <button
          class="panel-tab"
          :class="{ active: panelMode === 'link' }"
          @click="panelMode = 'link'"
        >链接</button>
        <button
          class="panel-tab"
          :class="{ active: panelMode === 'note' }"
          @click="panelMode = 'note'"
        >笔记</button>
      </div>
      <iframe v-show="panelMode === 'link'" class="panel-iframe" src="https://yuanbao.tencent.com/chat/naQivTmsDa" title="腾讯元宝" allow="clipboard-read; clipboard-write"></iframe>
      <NoteEditor v-show="panelMode === 'note'" class="panel-note" :para-index="editingNotePara" :notes="paragraphNotes?.value || paragraphNotes || {}" />
    </div>
  </div>
</template>

<style scoped>
.side-panel { position: fixed; right: -46vw; top: 0; width: 46vw; height: 100vh; overflow: hidden; background: #fff; border: 1px solid #d4c5b0; border-right: none; display: flex; flex-direction: column; box-shadow: -2px 0 12px rgba(0,0,0,0.08); transition: right 0.4s ease; z-index: 9000; border-radius: 12px 0 0 12px; }
.side-panel.visible { right: 0; }
.panel-tabs { display: flex; flex-shrink: 0; border-bottom: 1px solid #e0d8cc; }
.panel-tab { flex: 1; border: none; background: transparent; padding: 10px; font-size: 13px; font-weight: 500; color: #8a7a66; cursor: pointer; transition: all 0.15s; }
.panel-tab:hover { background: #f8f5f0; }
.panel-tab.active { color: #8b3a2a; border-bottom: 2px solid #8b3a2a; background: #fcf9f4; }
.panel-iframe { flex: 1; width: 100%; border: none; border-radius: 0 0 0 12px; }
.panel-note { flex: 1; width: 100%; border: none; overflow: hidden; }
</style>
