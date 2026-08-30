import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus, { ElConfigProvider } from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
// 必须晚于 element-plus 的样式引入，其中对 ElMessage 的覆盖规则才能生效
import './assets/main.css'

import App from './App.vue'
import router from './router'

// 统一所有 ElMessage 的位置：左上角。
// 走 ConfigProvider 的全局配置，调用点无需逐个传 placement。
// （动画方向在 assets/base.css 里覆盖为「从左侧右滑」）
const app = createApp({
  name: 'AppRoot',
  render: () =>
    h(ElConfigProvider, { message: { placement: 'top-left' } }, () => h(App)),
})

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

app.mount('#app')
