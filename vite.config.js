import { fileURLToPath, URL } from 'node:url'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

// 探测本机编辑器 exe 绝对路径（优先 VS Code，其次 CodeBuddy）
function resolveEditorExe() {
  const local = process.env.LOCALAPPDATA || ''
  const candidates = [
    'D:\\Program Files\\Microsoft VS Code\\Code.exe',
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    `${local}\\Programs\\Microsoft VS Code\\Code.exe`,
    'D:\\Programs\\CodeBuddy CN\\CodeBuddy CN.exe',
    'C:\\Program Files\\CodeBuddy\\CodeBuddy.exe',
    `${local}\\Programs\\CodeBuddy\\CodeBuddy.exe`,
  ]
  return candidates.find((p) => existsSync(p)) || null
}

const editorExe = resolveEditorExe()

// 拦截 Vite 的 /__open-in-editor 请求，用 spawn + windowsHide 直接启动编辑器 exe，
// 绕开 Vite 内置 launch-editor 在 Windows 上 child_process.exec(cmd shell) 导致的弹 cmd 窗口问题
function noWindowOpenInEditor() {
  return {
    name: 'no-window-open-in-editor',
    configureServer(server) {
      if (!editorExe) return
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '', 'http://localhost')
        if (!url.pathname.endsWith('/__open-in-editor')) return next()
        const file = url.searchParams.get('file')
        if (!file) {
          res.statusCode = 400
          res.end('missing file')
          return
        }
        // 解析 path:line:col → VS Code / CodeBuddy 的 --goto 参数
        const m = file.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/)
        // inspector 传的是相对项目根目录的路径，须解析为绝对路径，否则编辑器找不到文件
        let pathname = m[1]
        if (pathname.startsWith('file://')) {
          pathname = fileURLToPath(pathname)
        } else if (!isAbsolute(pathname)) {
          pathname = resolve(server.config.root, pathname)
        }
        const args = m[2]
          ? ['--goto', `${pathname}:${m[2]}${m[3] ? `:${m[3]}` : ''}`]
          : [pathname]
        // 直接 spawn exe：无需 cmd.exe，不会出现黑色 cmd 窗口
        const child = spawn(editorExe, args, {
          detached: true,     // 独立于 vite 进程，vite 退出不影响已打开的编辑器
          windowsHide: true,  // 关键：隐藏控制台窗口
          stdio: 'ignore',
        })
        child.unref()
        res.end()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // 放最前面，确保先于 Vite 内置的 launch-editor 中间件注册，从而拦截请求
    noWindowOpenInEditor(),
    vue(),
    vueJsx(),
    vueDevTools({
      componentInspector: {
        // 按 Shift 键切换组件检查模式（按一下开，再按一下关）
        toggleComboKey: 'shift',
        toggleButtonVisibility: 'active',
        launchEditor: editorExe || 'code',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
