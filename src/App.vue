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
        <div class="panel-toolbar">
          <el-button-group>
            <el-button
              v-for="(s, key) in SIDE_SITE_DEFS"
              :key="key"
              size="small"
              :type="sideSite === key ? 'primary' : ''"
              :class="{ 'is-current-site': sideSite === key }"
              @click="sideSite = key"
            >{{ s.name }}</el-button>
          </el-button-group>
          <el-button
            v-if="!SIDE_SITE_DEFS[sideSite].canEmbed"
            size="small"
            type="success"
            @click="openSideInNewWindow"
          >外部打开</el-button>
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
          <p class="ph-text">{{ SIDE_SITE_DEFS[sideSite].name }} 拒绝被嵌入 iframe，请点击「外部打开」或下方按钮在新标签页使用。</p>
          <el-button type="primary" size="small" @click="openSideInNewWindow">
            在浏览器中打开 {{ SIDE_SITE_DEFS[sideSite].name }}
          </el-button>
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
.panel-toolbar { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px; border-bottom: 1px solid #ebeef5; }
.panel-toolbar .el-button.is-current-site { font-weight: 700; }
.panel-iframe { flex: 1; width: 100%; border: none; border-radius: 0 0 0 12px; }
.panel-placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; background: #f5f7fa; }
.ph-text { font-size: 13px; color: #606266; margin: 0 0 8px; line-height: 1.6; }

/* 笔记区域 */
.panel-note { flex: 1; width: 100%; min-height: 0; overflow: hidden; }
</style>
