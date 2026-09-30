import { ref } from 'vue'

// 文章卡片的「右键菜单」与「顶部删除确认通知」的共享状态，
// 另含一个全局「当前活跃菜单」标记，用于与通用的 ContextMenu.vue 互斥。
//
// 为什么需要共享：每个 ArticleCard 都是独立组件实例，若各自维护一份
// visible，右键卡片 B 时卡片 A 收不到通知，A 的弹层不会关闭，
// 反复右键就会叠加出多个菜单 / 多个通知。
// 这里所有卡片共用同一份状态：打开新的会覆盖上一次的，
// 配合模板中 `articleId === article.id` 的判断，保证同时只显示一个。

const menu = ref({ visible: false, x: 0, y: 0, articleId: '' })
const notice = ref({ visible: false, articleId: '', title: '' })

// 当前活跃的右键菜单：'' = 无；'card' = 文章卡片菜单；'context' = 通用 ContextMenu
// 两者共用此标记，任一打开都会把对方挤掉，避免同时出现。
const activeMenu = ref('')

export function useArticleContextMenu() {
  /** 打开右键菜单：记录位置与所属文章，上一次的菜单自动失效 */
  function openMenu(e, articleId) {
    menu.value = {
      visible: true,
      x: e.clientX,
      y: e.clientY,
      articleId: articleId || '',
    }
    activeMenu.value = 'card'
  }

  function closeMenu() {
    if (!menu.value.visible) return
    menu.value = { ...menu.value, visible: false }
    if (activeMenu.value === 'card') activeMenu.value = ''
  }

  /** 打开顶部删除确认通知：同样会顶掉上一次的通知 */
  function openNotice(articleId, title) {
    notice.value = {
      visible: true,
      articleId: articleId || '',
      title: title || '',
    }
  }

  function closeNotice() {
    if (!notice.value.visible) return
    notice.value = { ...notice.value, visible: false }
  }

  /** 供通用 ContextMenu.vue 调用：打开 / 关闭时登记活跃菜单 */
  function setActiveMenu(v) {
    activeMenu.value = v || ''
  }

  return {
    menu,
    openMenu,
    closeMenu,
    notice,
    openNotice,
    closeNotice,
    activeMenu,
    setActiveMenu,
  }
}
