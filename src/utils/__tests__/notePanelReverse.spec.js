import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NotePanel from '../../components/NotePanel.vue'

describe('NotePanel 反向联动（emit 方式）', () => {
  it('组件能正常挂载（不再依赖 inject 反向通道）', () => {
    const wrapper = mount(NotePanel, {
      global: {
        stubs: { 'el-button': { template: '<button><slot /></button>' } },
      },
    })
    expect(wrapper.exists()).toBe(true)
    // Options API 中 emits 已声明
    expect(wrapper.vm.$options.emits).toContain('reverse-select')
  })

  it('无选区时 onReverseSelect 不 emit reverse-select', () => {
    const wrapper = mount(NotePanel, {
      global: {
        stubs: { 'el-button': { template: '<button><slot /></button>' } },
      },
    })
    // jsdom 无选区，getExpandedSelectionText 返回空，不应触发 emit
    wrapper.vm.onReverseSelect()
    expect(wrapper.emitted('reverse-select')).toBeFalsy()
  })
})

function mountPanel() {
  return mount(NotePanel, {
    global: {
      stubs: { 'el-button': { template: '<button><slot /></button>' } },
    },
  })
}

describe('NotePanel 重点集中卡片', () => {
  it('markedItems 按笔记顺序汇总所有标记为重点的词汇项', async () => {
    const wrapper = mountPanel()
    wrapper.vm.notes = [
      { subtitle: 's1', english: 'e1', chinese: 'c1', vocabItems: ['apple', 'banana'] },
      { subtitle: 's2', english: 'e2', chinese: 'c2', vocabItems: ['cat'] },
    ]
    wrapper.vm.marked = { '0__banana': true, '1__cat': true, '0__apple': false }
    await wrapper.vm.$nextTick()
    const items = wrapper.vm.markedItems
    expect(items.length).toBe(2)
    expect(items[0]).toMatchObject({ noteIndex: 0, vocab: 'banana' })
    expect(items[1]).toMatchObject({ noteIndex: 1, vocab: 'cat' })
  })

  it('默认不显示重点面板，toggleMarkedPanel 后展开并渲染重点项', async () => {
    const wrapper = mountPanel()
    wrapper.vm.notes = [
      { subtitle: 's1', english: 'e1', chinese: 'c1', vocabItems: ['apple', 'banana'] },
    ]
    wrapper.vm.marked = { '0__apple': true }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.marked-panel').exists()).toBe(false)

    wrapper.vm.toggleMarkedPanel()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.marked-panel').exists()).toBe(true)
    expect(wrapper.findAll('.marked-item').length).toBe(1)
    expect(wrapper.find('.marked-item').text()).toContain('apple')
  })

  it('无重点时展开显示空提示', async () => {
    const wrapper = mountPanel()
    wrapper.vm.notes = [
      { subtitle: 's1', english: 'e1', chinese: 'c1', vocabItems: ['apple'] },
    ]
    wrapper.vm.marked = {}
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleMarkedPanel()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.marked-panel').exists()).toBe(true)
    expect(wrapper.find('.marked-empty').exists()).toBe(true)
    expect(wrapper.findAll('.marked-item').length).toBe(0)
  })

  it('重点卡片为只读：条目不含取消重点的双击绑定，且标记只读标签', async () => {
    const wrapper = mountPanel()
    wrapper.vm.notes = [
      { subtitle: 's1', english: 'e1', chinese: 'c1', vocabItems: ['apple'] },
    ]
    wrapper.vm.marked = { '0__apple': true }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleMarkedPanel()
    await wrapper.vm.$nextTick()
    const item = wrapper.find('.marked-item')
    expect(item.exists()).toBe(true)
    // 只读：存在「只读」标记，且条目仅保留单击定位（无 dblclick 监听）
    expect(wrapper.find('.readonly-tag').exists()).toBe(true)
    expect(item.attributes('title')).toBe('单击在右侧显示所属笔记卡片')
    await item.trigger('dblclick')
    // 双击不改变重点标记状态（仍为 true）
    expect(wrapper.vm.marked['0__apple']).toBe(true)
  })

  it('打开卡片后右侧边栏默认显示第一张含重点的笔记卡片', async () => {
    const wrapper = mountPanel()
    wrapper.vm.notes = [
      { subtitle: 's1', english: 'e1', chinese: 'c1', vocabItems: ['apple', 'banana'] },
      { subtitle: 's2', english: 'e2', chinese: 'c2', vocabItems: ['cat'] },
      { subtitle: 's3', english: 'e3', chinese: 'c3', vocabItems: ['dog'] },
    ]
    wrapper.vm.marked = { '0__apple': true, '2__dog': true }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleMarkedPanel()
    await wrapper.vm.$nextTick()

    // 默认选中第一张含重点的笔记（索引 0），右侧边栏直接渲染该 .note-card
    expect(wrapper.vm.activeNoteIndex).toBe(0)
    const sidebar = wrapper.find('.marked-sidebar')
    expect(sidebar.exists()).toBe(true)
    const card = wrapper.find('.marked-sidebar .note-card')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('s1') // 副标题
    expect(card.text()).toContain('e1') // 英文
    expect(card.text()).toContain('c1') // 中文
  })

  it('点击左侧重点项在右侧边栏显示对应笔记卡片并高亮该项', async () => {
    const wrapper = mountPanel()
    wrapper.vm.notes = [
      { subtitle: 's1', english: 'e1', chinese: 'c1', vocabItems: ['apple'] },
      { subtitle: 's2', english: 'e2', chinese: 'c2', vocabItems: ['cat'] },
    ]
    wrapper.vm.marked = { '0__apple': true, '1__cat': true }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleMarkedPanel()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.activeNoteIndex).toBe(0)

    // 点击第二个重点项（属于笔记索引 1）→ 右侧边栏切换显示 #2 卡片、左侧项高亮
    const items = wrapper.findAll('.marked-item')
    await items[1].trigger('click')
    expect(wrapper.vm.activeNoteIndex).toBe(1)
    expect(wrapper.vm.activeNote.subtitle).toBe('s2')
    const card = wrapper.find('.marked-sidebar .note-card')
    expect(card.text()).toContain('s2')
    expect(wrapper.findAll('.marked-item')[1].classes()).toContain('is-active')
    expect(wrapper.findAll('.marked-item')[0].classes()).not.toContain('is-active')
  })

  it('无重点时右侧边栏不渲染卡片', async () => {
    const wrapper = mountPanel()
    wrapper.vm.notes = [
      { subtitle: 's1', english: 'e1', chinese: 'c1', vocabItems: ['apple'] },
    ]
    wrapper.vm.marked = {}
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleMarkedPanel()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.marked-sidebar').exists()).toBe(false)
  })

  it('ESC 键关闭已展开的重点集中卡片', async () => {
    const wrapper = mountPanel()
    wrapper.vm.notes = [
      { subtitle: 's1', english: 'e1', chinese: 'c1', vocabItems: ['apple'] },
    ]
    wrapper.vm.marked = { '0__apple': true }
    await wrapper.vm.$nextTick()
    wrapper.vm.toggleMarkedPanel()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.markedPanelVisible).toBe(true)

    // 派发 ESC keydown → 卡片收起
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.markedPanelVisible).toBe(false)
  })
})
