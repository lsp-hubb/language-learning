<script setup>
import { ref, provide, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import CodeGate from '@/components/CodeGate.vue'
import NotePanel from '@/components/NotePanel.vue'

const router = useRouter()
const route = useRoute()
const ready = ref(false)
const showSidePanel = ref(false)
provide('showSidePanel', showSidePanel)

// 侧面板模式: 'link' (AI) | 'note' (笔记)
const panelMode = ref('link')
provide('panelMode', panelMode)

// 当前文章 ID（供笔记面板读取/保存），从路由参数获取
const currentArticleId = computed(() => route.params.id || '')
provide('currentArticleId', currentArticleId)

// ===== 侧边栏 AI 站点定义 =====
// canEmbed: true → 用常驻 iframe 内嵌；false → 显示占位提示 + 外部打开
const SIDE_SITE_DEFS = {
  yuanbao:  { name: '元宝',     url: 'https://yuanbao.tencent.com/chat/naQivTmsDa', canEmbed: true },
  doubao:   { name: '豆包',     url: 'https://www.doubao.com/chat/',               canEmbed: true },
  qianwen:  { name: '千问',     url: 'https://qianwen.com/chat/',                  canEmbed: false },
  deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/',                 canEmbed: false },
}
const SIDE_STATE_KEY = 'sidePanelState'

function loadSideState() {
  try {
    const raw = localStorage.getItem(SIDE_STATE_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (s && SIDE_SITE_DEFS[s.site]) return s.site
    }
  } catch (_) {}
  return 'yuanbao'
}

const sideSite = ref(loadSideState())
watch(sideSite, (v) => {
  try { localStorage.setItem(SIDE_STATE_KEY, JSON.stringify({ site: v })) } catch (_) {}
})

function openSideInNewWindow() {
  const s = SIDE_SITE_DEFS[sideSite.value]
  if (s?.url) window.open(s.url, '_blank', 'noopener,noreferrer')
}

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
      <!-- AI 外链面板：所有可嵌入站点的 iframe 常驻 DOM，切换只显隐不重建 -->
      <!-- 显示哪个面板由工具栏「AI」「笔记」开关控制（panelMode），面板内无标签栏 -->
      <div v-show="panelMode === 'link'" class="panel-outer">
        <div class="panel-site-bar">
          <button
            v-for="(s, key) in SIDE_SITE_DEFS"
            :key="key"
            class="site-btn"
            :class="{ active: sideSite === key }"
            @click="sideSite = key"
          >{{ s.name }}</button>
        </div>
        <iframe
          v-for="(s, key) in SIDE_SITE_DEFS"
          v-show="sideSite === key && s.canEmbed"
          :key="'frame-' + key"
          class="panel-iframe"
          :src="s.url"
          :title="s.name"
          allow="clipboard-read; clipboard-write"
        ></iframe>
        <!-- 不可嵌入站点：占位提示 + 外部打开 -->
        <div v-if="!SIDE_SITE_DEFS[sideSite].canEmbed" class="panel-placeholder">
          <p class="ph-text">{{ SIDE_SITE_DEFS[sideSite].name }} 不允许被页面嵌入</p>
          <button class="site-btn site-open" @click="openSideInNewWindow">
            在浏览器中打开 {{ SIDE_SITE_DEFS[sideSite].name }}
          </button>
        </div>
      </div>

      <!-- 笔记面板：常驻，仅显隐，避免切换时重新加载 -->
      <NotePanel
        v-show="panelMode === 'note'"
        class="panel-note"
        :article-id="currentArticleId"
      />
    </div>
  </div>
</template>

<style scoped>
.side-panel { position: fixed; right: -46vw; top: 0; width: 46vw; height: 100vh; overflow: hidden; background: #fff; border: 1px solid #d4c5b0; border-right: none; display: flex; flex-direction: column; box-shadow: -2px 0 12px rgba(0,0,0,0.08); transition: right 0.4s ease; z-index: 9000; border-radius: 12px 0 0 12px; }
.side-panel.visible { right: 0; }
/* AI 外链区域 */
.panel-outer { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.panel-site-bar { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 6px 8px; border-bottom: 1px solid #e0d8cc; }
.site-btn { border: 1px solid #d4c5b0; background: transparent; color: #6b5a3e; font-size: 11px; font-weight: 500; cursor: pointer; padding: 3px 10px; border-radius: 12px; white-space: nowrap; transition: all 0.15s; }
.site-btn:hover { background: #f0e8d8; border-color: #8b3a2a; }
.site-btn.active { background: #8b3a2a; color: #fff; border-color: #8b3a2a; }
.site-open { background: #f0e8d8; }
.panel-iframe { flex: 1; width: 100%; border: none; border-radius: 0 0 0 12px; }
.panel-placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; }
.ph-text { font-size: 13px; color: #8a7a66; margin: 0; }

/* 笔记区域 */
.panel-note { flex: 1; width: 100%; min-height: 0; overflow: hidden; }
</style>
