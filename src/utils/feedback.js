// 统一反馈层：消息提示 / 结果详情弹窗 / 确认框
// 复用项目已全局引入的 element-plus；外观在 src/assets/base.css 中统一覆盖。
// 全部内容用 VNode 渲染，不使用 HTML 字符串，避免文件名等外部数据造成 XSS。
import { h } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const BOX_CLASS = 'fb-message-box'

export function notify(message, type = 'info', options = {}) {
  return ElMessage({
    message,
    type,
    showClose: true,
    duration: type === 'error' ? 6000 : 3200,
    ...options,
  })
}

export const notifySuccess = (message, options) => notify(message, 'success', options)
export const notifyError = (message, options) => notify(message, 'error', options)
export const notifyWarning = (message, options) => notify(message, 'warning', options)
export const notifyInfo = (message, options) => notify(message, 'info', options)

/**
 * 展示带统计卡片的结果弹窗（导出 / 导入完成摘要）。
 * @param {{title:string, subtitle?:string, type?:'success'|'info'|'warning', stats?:{label:string,value:string|number}[], notes?:string[]}} options
 */
export function showResult({ title, subtitle = '', type = 'success', stats = [], notes = [] }) {
  const blocks = []
  if (subtitle) blocks.push(h('p', { class: 'fb-result-sub' }, subtitle))
  if (stats.length) {
    blocks.push(
      h(
        'div',
        { class: 'fb-stats' },
        stats.map((s) =>
          h('div', { class: 'fb-stat' }, [
            h('b', { class: 'fb-stat-value' }, String(s.value)),
            h('span', { class: 'fb-stat-label' }, s.label),
          ])
        )
      )
    )
  }
  if (notes.length) {
    blocks.push(h('ul', { class: 'fb-notes' }, notes.map((n) => h('li', null, n))))
  }

  return ElMessageBox.alert(h('div', { class: 'fb-result' }, blocks), title, {
    type,
    confirmButtonText: '知道了',
    showClose: true,
    customClass: `${BOX_CLASS} fb-message-box--result`,
  })
}

/**
 * Promise 化确认框；取消 / 关闭一律返回 false。
 * danger=true 时确认按钮变红，用于删除等不可逆操作。
 */
export async function askConfirm({
  title = '请确认',
  message = '',
  detail = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  const blocks = []
  if (message) blocks.push(h('p', { class: 'fb-confirm-msg' }, message))
  if (detail) blocks.push(h('p', { class: 'fb-confirm-detail' }, detail))

  try {
    await ElMessageBox.confirm(h('div', { class: 'fb-confirm' }, blocks), title, {
      type: danger ? 'warning' : 'info',
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      confirmButtonClass: danger ? 'fb-btn-danger' : '',
      showClose: false,
      closeOnClickModal: false,
      customClass: `${BOX_CLASS}${danger ? ' is-danger' : ''}`,
    })
    return true
  } catch (_) {
    return false
  }
}
