import { test, expect } from '@playwright/test'

// 应用外壳冒烟测试：验证前端能正常挂载、路由跳转与关键 UI 可见。
// 不再使用 Vite 模板残留的 `h1 = 'You did it!'` 断言。
test('应用能加载并渲染文件浏览区', async ({ page }) => {
  await page.goto('/')
  // 根路由应渲染出文件管理界面（文件夹树 / 内容区），而非空白页
  await expect(page.locator('body')).not.toBeEmpty()
  await expect(page.locator('.explorer').first()).toBeVisible({ timeout: 10000 })
})

test('文章路由可访问不报错', async ({ page }) => {
  // 不存在的文章 id 也不应导致白屏或 JS 崩溃
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/article/__e2e_missing__')
  await expect(page.locator('body')).not.toBeEmpty()
  await expect.poll(() => errors.length, { timeout: 3000 }).toBe(0)
})
