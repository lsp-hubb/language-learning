# 段落笔记功能问题记录与解决方案

> 记录段落笔记功能开发过程中遇到的各类问题及最终解决方案，便于后续维护与排查。

---

## 目录

1. [数据传递问题](#1-数据传递问题)
2. [后端数据加载问题](#2-后端数据加载问题)
3. [状态管理与响应式问题](#3-状态管理与响应式问题)
4. [编辑器/阅读器 UI 问题](#4-编辑器阅读器-ui-问题)
5. [保存与换行处理问题](#5-保存与换行处理问题)
6. [滚动位置保持问题](#6-滚动位置保持问题)
7. [总结：核心教训](#7-总结核心教训)

---

## 1. 数据传递问题

### 1.1 段落笔记显示 NaN

**现象**：NoteEditor 中显示 `第NaN段`。

**根因**：段落编号通过 `provide/inject` 传递时，inject 返回的 ref 被 Vue 自动解包，导致在模板中作为字符串拼接时变成 `NaN`。

**解决**：使用 prop `:para-index` 代替 inject 传递段落索引，确保类型明确。

### 1.2 段落笔记显示 0

**现象**：所有段落的笔记编号固定显示 `第0段`。

**根因**：inject 的 ref 在父组件通过 `provide('key', ref)` 提供，子组件 `inject('key')` 接收时 Vue 自动解包为原始值。当多个段落循环渲染时，`0` 始终返回初始值而不是循环变量。

**解决**：

```vue
<!-- 改用 prop 传值，确保每个段落获取正确的循环索引 -->
<NoteEditor :para-index="paraIndex" :notes="paragraphNotes" />
```

### 1.3 保存函数传递失败：inject 返回非函数

**现象**：点击保存按钮后一直显示"保存中..."，无法完成保存。

**根因**：Vue 3 的 `inject` 在注入 ref 时，访问 `inject('key')` 返回的是解包后的值（而非 ref），且 `provide` 如果传递箭头函数，inject 端获取时函数内的 `this` 指向错误或函数体立即执行。

**解决过程**：

1. 尝试 `provide('saveFn', saveParagraphNote)` → inject 获取到 `undefined`
2. 尝试 `provide('saveFn', () => saveParagraphNote)` → inject 获取到函数但闭包丢失
3. **最终方案**：使用普通对象包裹函数引用：

```js
// App.vue — provide
const saveNoteFn = { current: null }
provide('saveFn', saveNoteFn)

// ArticlePage.vue — 注册函数
saveNoteFn.current = async (articleId, paraIndex, content) => {
  // ...保存逻辑
}

// NoteEditor.vue — 读取函数
const saveFn = inject('saveFn')
await saveFn.current(articleId.value, paraIndex.value, content)
```

---

## 2. 后端数据加载问题

### 2.1 笔记保存后不显示（后端缺别名）

**现象**：保存笔记到 MySQL 后，重新加载文章仍然看不到已保存的笔记内容。

**根因**：后端 SQL 查询使用 `SELECT paragraph_notes FROM articles`，但返回的字段名是 `paragraph_notes`（下划线风格），而前端代码读取 `row.paragraphNotes`（驼峰风格），导致笔记数据被忽略。

**解决**：后端 SQL 添加 `AS` 别名：

```js
// server/index.js
const sql = `SELECT id, title, content, folder_id AS folderId,
             created_at AS createdAt,
             paragraph_notes AS paragraphNotes
             FROM articles WHERE id = ?`
```

### 2.2 文章加载时序：watch 失效

**现象**：笔记保存后，刷新页面段落笔记无法加载。

**根因**：原本依赖 `watch(() => route.params.id, ...)` 或 `onMounted` 来加载文章数据。但在路由跳转时，如果参数未变化或组件被 keep-alive 缓存，watcher 不会触发。

**解决**：在 `setup` 中直接调用加载函数，同时保留 `onMounted` 作为兜底：

```js
// setup 中直接调用（最早期，确保数据加载）
const articleId = route.params.id
loadArticle(articleId)

// onMounted 兜底（解决某些生命周期分支未覆盖的情况）
onMounted(() => {
  if (route.params.id) {
    loadArticle(route.params.id)
  }
})
```

### 2.3 笔记保存 API 超时

**现象**：保存笔记请求卡住，无任何响应。

**根因**：未设置请求超时，后端在某些异常情况下不返回响应。

**解决**：前端 API 调用增加 10 秒 AbortController 超时：

```js
export async function updateArticle(id, data) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  // ...fetch 请求
  clearTimeout(timeout)
}
```

---

## 3. 状态管理与响应式问题

### 3.1 笔记状态提升：兄弟组件无法共享

**问题**：ArticlePage.vue 包含 ArticleReader（阅读器）和 NoteEditor（笔记编辑器），两者需要共享 `paragraphNotes` 数据。但最初笔记状态放在 ArticleReader 中，NoteEditor 无法访问。

**解决**：将 `paragraphNotes`、`editingNotePara`、`saveNoteFn` 等状态从 ArticlePage 提升到 App.vue，通过 provide/inject（或 prop）在子组件间共享。

**最终数据流**：

```
MySQL → Express API → App.vue (paragraphNotes ref)
                        ├─ provide('saveFn', { current: null })
                        └─ <ArticlePage>
                              ├─ <ArticleReader :paragraph-notes="paragraphNotes" />
                              └─ sidebar panel
                                   └─ <NoteEditor :notes="paragraphNotes" :para-index="idx" />
```

### 3.2 保存按钮状态停留在"保存中"

**现象**：点击保存后按钮变为"保存中..."并卡住不动。

**根因**：`saveParagraphNote` 函数内部抛出异常，但未被 try/catch 捕获；同时函数通过 inject 传递时引用丢失，导致 `await` 被跳过。

**解决**：

```js
// 包裹 try/catch
async function saveParagraphNote(articleId, paraIndex, content) {
  savingNotePara.value = paraIndex
  try {
    const article = await getArticle(articleId)
    const notes = { ...article.paragraphNotes, [paraIndex]: content }
    await updateArticle(articleId, { paragraphNotes: notes })
    paragraphNotes.value[paraIndex] = content
  } catch (e) {
    console.error('笔记保存失败:', e)
  } finally {
    savingNotePara.value = null
  }
}
```

---

## 4. 编辑器/阅读器 UI 问题

### 4.1 编辑器与阅读器宽度不一致

**现象**：笔记在编辑器和阅读器之间切换时，段落文字左右边界位置不同，产生视觉跳动。

**根因**：编辑器容器和阅读器容器使用了不同的 CSS 属性计算宽度。

**解决**：统一使用与文章阅读器一致的容器宽度：

```css
.note-editor,
.note-reader {
  max-width: 42em;
  margin: 0 auto;
  text-align: justify;
  scrollbar-gutter: stable;
}
```

### 4.2 段落规则不一致

**现象**：笔记阅读器按空行区分段落，但编辑器不按此规则渲染。

**根因**：编辑器 contenteditable 换行输出 `<br>`，而阅读器将连续两个 `\n` 渲染为段落间距。

**解决**：编辑器和阅读器统一处理规则：`\n\n` → 段落间距，单 `\n` → 行内换行（`<br>`）。

### 4.3 底部留白不一致

**现象**：编辑器底部与阅读器底部距离页面底部的高度不一致。

**解决**：统一容器 `padding-bottom`，确保两者末尾段落与容器底部的间距相同。

### 4.4 📝 按钮位置闪烁

**现象**：鼠标悬停在段落附近时，段落笔记按钮位置闪烁。

**根因**：按钮位于段落内部并用 `position: absolute` + 百分比定位，不同段落宽度不一致导致位置偏移。

**解决**：固定在段落右侧外侧：

```css
.note-btn {
  position: absolute;
  right: 0;
  transform: translateX(calc(100% + 8px));
  width: 28px;
  height: 28px;
}
```

---

## 5. 保存与换行处理问题

### 5.1 多次编辑保存后文字越来越挤

**现象**：第一次编辑保存正常，第二次编辑同一段落后所有回车全部丢失，文字连成一片。

**根因**：编辑器 contenteditable 在 innerHTML 中的换行标记格式不唯一。第一次保存时解析的 HTML 格式能被第二次编辑器正确还原，但第二次编辑器可能输出不同格式的 HTML，导致后续解析出错。

**详细数据流**：

```
保存: contenteditable.innerHTML → 正则解析
加载: 字符串 → 设置 contenteditable.innerHTML
```

当 innerHTML 中混合了 `<br>`、`</p><p>`、`<div>` 等不同换行标记时，正则匹配可能遗漏某些标记。

**解决**：统一解析规则，`getContent()` 执行两次替换确保覆盖全面：

```js
function getContent(el) {
  let html = el.innerHTML
  // 第一次：</p><p> → \n\n
  html = html.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
  // 第二次：<br> → \n
  html = html.replace(/<br\s*\/?>/gi, '\n')
  // 清理首尾 <p> 标签
  html = html.replace(/^<p[^>]*>/i, '').replace(/<\/p>$/i, '')
  // 弯引号替换
  html = html.replace(/\u2018|\u2019/g, "'").replace(/\u201C|\u201D/g, '"')
  return html
}
```

### 5.2 读取笔记时换行丢失

**现象**：从数据库加载笔记内容后，原有的段落划分全部消失。

**根因**：`formatContent()` 中使用 `.textContent` 获取文本，丢失了 `<br>` 标记。

**解决**：改为读取 innerHTML 并保留 `<br>` 标记：

```js
function formatContent(text) {
  if (!text) return ''
  // 将字符串转为 HTML：\n\n → </p><p>，\n → <br>
  return text
    .split('\n\n')
    .map(p => p.replace(/\n/g, '<br>'))
    .join('</p><p>')
}
```

---

## 6. 滚动位置保持问题

### 6.1 编辑后返回阅读器滚动位置丢失

**现象**：在阅读器某位置点击编辑，编辑器打开后自动回到顶部，保存返回阅读器后仍然在顶部。

**解决**：在编辑器打开前记录滚动位置，保存后恢复：

```js
// ArticlePage.vue
let savedScrollPos = 0

function startEdit() {
  savedScrollPos = window.scrollY
  editing.value = true
  nextTick(() => {
    window.scrollTo(0, savedScrollPos)
  })
}

function saveEdit() {
  editing.value = false
  nextTick(() => {
    window.scrollTo(0, savedScrollPos)
  })
}
```

---

## 7. 总结：核心教训

### 7.1 Vue 3 provide/inject 陷阱

| 传递类型 | 子组件接收 | 行为 |
|---------|-----------|------|
| `provide('key', refVal)` | `const v = inject('key')` | `v` 是**解包后值**，非 ref |
| `provide('key', { current: fn })` | `const v = inject('key')` | `v.current` 可安全调用 fn |
| `provide('key', reactive(obj))` | `const v = inject('key')` | `v` 是响应式对象 |

**规则**：尽量避免通过 inject 传递函数；如需传递，使用普通对象包裹（`{ current: null }`）。

### 7.2 后端字段名映射

- MySQL 列名：`snake_case`（如 `paragraph_notes`）
- JavaScript 对象属性：`camelCase`（如 `paragraphNotes`）
- **必须在 SQL 中使用 `AS` 别名**确保两者匹配

### 7.3 contenteditable 数据一致性

- 保存：解析 `innerHTML` 提取纯文本（含换行标记）
- 加载：将纯文本渲染回 `innerHTML`
- 两种方向转换必须**可逆**，否则多次编辑后数据失真

### 7.4 数据加载防御性编程

```js
// 三级保障加载数据
setup() 中直接调用      // ① 立即加载
onMounted() 兜底调用    // ② 生命周期确保
watch() 响应路由变化     // ③ 路由切换更新
```
