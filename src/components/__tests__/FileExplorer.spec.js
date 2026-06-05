import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import FileExplorer from '../FileExplorer.vue'

describe('FileExplorer', () => {
  it('renders properly', () => {
    const wrapper = mount(FileExplorer, { props: { msg: 'Hello Vitest' } })
    expect(wrapper.text()).toContain('Hello Vitest')
  })
})
