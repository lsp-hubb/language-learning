import { fileURLToPath, URL } from 'node:url'
import { spawn, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve, dirname, join, basename } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

/**
 * 探测本机编辑器 exe 绝对路径（优先 VS Code，其次 CodeBuddy）。
 *
 * 关键点：必须拿到真正的 .exe，而不能是 code / code.cmd。
 * code.cmd 是批处理脚本，spawn 它必然经过 cmd.exe → 弹出黑色控制台窗口。
 *
 * 两级探测：
 *   1) 常见硬编码路径（快）
 *   2) 动态反推（稳）：`where code` 得到 <安装目录>\bin\code.cmd，
 *      真正的 exe 在其上一级 <安装目录>\Code.exe
 *      —— 这样 VS Code 装在任何盘符都能定位，不依赖硬编码。
 */
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
  for (const p of candidates) if (existsSync(p)) return { exe: p, via: 'hardcoded' }

  // 动态探测：从 PATH 中的启动脚本反推真实 exe
  const probeCmds = ['code', 'CodeBuddy']
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  for (const cmd of probeCmds) {
    try {
      const out = execSync(`${whichCmd} ${cmd}`, {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
      if (!first) continue
      // <安装目录>\bin\code.cmd → <安装目录>\Code.exe
      const installDir = dirname(dirname(first))
      for (const name of ['Code.exe', 'CodeBuddy.exe', `${cmd}.exe`]) {
        const exe = join(installDir, name)
        if (existsSync(exe)) return { exe, via: `where ${cmd}` }
      }
    } catch (_) { /* 该命令不存在，继续下一个 */ }
  }
  return { exe: null, via: 'not-found' }
}

const { exe: editorExe, via: editorVia } = resolveEditorExe()
console.log(
  editorExe
    ? `[vite] editor resolved (${editorVia}): ${editorExe}`
    : '[vite] WARN: editor exe not found — open-in-editor will fall back and may flash a cmd window'
)

// 项目根：本脚本位于 <项目根>/，取自身所在目录
const APP_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * 探测 pythonw.exe（无窗口版本）绝对路径。
 * 必须用 pythonw 而非 python —— python.exe 是控制台程序，会弹出黑色 cmd 窗口，
 * 正是我们要避免的问题。
 *
 * 依次尝试：项目根 .venv → 上级目录 .venv → PATH 中的 pythonw
 * 优先 venv 是因为它已装好 pywin32（前置窗口依赖 win32gui）。
 */
function resolvePythonw() {
  const candidates = [
    join(APP_ROOT, '.venv', 'Scripts', 'pythonw.exe'),
    join(dirname(APP_ROOT), '.venv', 'Scripts', 'pythonw.exe'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  try {
    const out = execSync('where pythonw', {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (first && existsSync(first)) return first
  } catch (_) { /* PATH 中无 pythonw */ }
  return null
}

const pythonw = resolvePythonw()
const focusScript = join(APP_ROOT, 'scripts', 'focus_editor.py')
// 默认开启，设 VITE_FOCUS_EDITOR=0 可关闭
const focusEnabled = process.env.VITE_FOCUS_EDITOR !== '0'

if (pythonw && existsSync(focusScript) && focusEnabled) {
  console.log(`[vite] editor auto-focus enabled via: ${pythonw}`)
} else if (focusEnabled) {
  console.log('[vite] WARN: pythonw/focus_editor.py not found — editor will open but not be focused')
}

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

        // 打开文件后，用 pythonw 把编辑器窗口提到最前。
        // VS Code 常复用已有窗口，不置前的话用户还得手动 Alt+Tab。
        if (pythonw && existsSync(focusScript) && focusEnabled) {
          const procName = editorExe ? basename(editorExe) : 'Code.exe'
          const p = spawn(
            pythonw,
            [focusScript, '--process', procName, '--file', pathname, '--root', APP_ROOT],
            { detached: true, windowsHide: true, stdio: 'ignore' }
          )
          p.unref()
        }
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
