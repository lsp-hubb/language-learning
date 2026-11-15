import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FileExplorer from '../FileExplorer.vue'
import { useFileExplorerStore } from '@/stores/fileExplorer'

// 模拟路由与 API：onMounted 会触发 store 初始化与数据加载
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/api', () => ({
  fetchFolders: vi.fn().mockResolvedValue({ data: [] }),
  fetchFavorites: vi.fn().mockResolvedValue({ data: [] }),
}))

describe('FileExplorer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('挂载后加载文件夹并显示根目录名', async () => {
    const store = useFileExplorerStore()
    store.initDB = vi.fn().mockResolvedValue(undefined)
    store.restoreFolder = vi.fn().mockResolvedValue(undefined)
    store.loadFavorites = vi.fn()

    const wrapper = mount(FileExplorer)
    // onMounted 的异步链：等待多个微任务让 initDB/loadFolders 完成
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(store.initDB).toHaveBeenCalled()
    expect(store.restoreFolder).toHaveBeenCalled()
    expect(store.folders.root.name).toBe('根目录')
    expect(wrapper.text()).toContain('根目录')
  })
})
