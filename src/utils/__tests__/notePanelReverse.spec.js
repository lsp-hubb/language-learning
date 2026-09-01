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
