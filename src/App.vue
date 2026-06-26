<script setup>
import { ref, provide } from 'vue'
import { useRouter } from 'vue-router'
import CodeGate from '@/components/CodeGate.vue'

const router = useRouter()
const ready = ref(false)
const showSidePanel = ref(false)
provide('showSidePanel', showSidePanel)

function onVerified() {
  // 仅在首页（/）时恢复上次文章页面；新标签打开具体文章时不覆盖
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
    <!-- 侧边面板提前挂载，预加载 iframe -->
    <div class="side-panel" :class="{ visible: showSidePanel }">
      <iframe class="panel-iframe" src="https://yuanbao.tencent.com/chat/naQivTmsDa" title="腾讯元宝"></iframe>
    </div>
  </div>
</template>

<style scoped>
.side-panel { position: fixed; right: -46vw; top: 0; width: 46vw; height: 100vh; overflow: hidden; background: #fff; border-left: 1px solid #e8e0d4; display: flex; flex-direction: column; box-shadow: -2px 0 12px rgba(0,0,0,0.08); transition: right 0.4s ease; z-index: 9000; }
.side-panel.visible { right: 0; }
.side-panel .panel-iframe { flex: 1; width: 100%; border: none; }
</style>
