# Git 使用指南

## 当前状态

项目已初始化 Git 仓库，最近提交：

| 提交 | 说明 |
|------|------|
| `6fb97ee` | docs: 全量核对代码并同步更新所有 markdown 文档 |
| `1dd3dfe` | feat: 正文选中联动笔记面板查找高亮 + 组件检查器改 Ctrl+I + 启停脚本免管理员处理 MySQL |
| `7557acf` | feat: 参考项目UI改造（顶部栏/阅读区/右侧面板）引入 Element Plus + 文档更新 |
| `51a44b0` | feat: 组件检查器定位后自动将编辑器窗口前置 |
| `73e8db5` | fix: 动态探测编辑器exe，修复组件检查器弹cmd黑窗 |
| `1ff2e42` | refactor: 移除侧面板顶部标签栏，改由工具栏开关控制面板内容 |
| `6f0f359` | feat: 右侧面板改为AI与笔记双标签页，照搬参考项目NotePanel |
| `51b988f` | style: ContentArea文件夹按名称排序 |
| `b1c30c2` | refactor: 彻底移除文章翻译功能 |
| `475a4f7` | chore: 移除已无功能的英文句点误判文档(abbrev-dot.md) |
| `87cee0b` | refactor: 移除段落翻译和翻译句子高亮功能 |
| `3d93ede` | chore: 清理旧迁移代码、更新数据库备份、同步markdown文档 |
| `ce6b764` | feat: b键快捷打开段落笔记 + 自动聚焦 + 阅读器/编辑器宽度加大 + 字号同步 + 编辑器v-once移除 |
| `07cb0ba` | style: 界面背景色统一 + 笔记字号增大 + 修复悬停笔记按钮抖动 |
| `796992e` | fix: 笔记按钮位置固定 — right:0+translateX替代硬编码-36px |
| `9d47f91` | style: 笔记按钮统一尺寸 — min-width+统一边框+居中 |
| `ccfec51` | fix: 笔记编辑/阅读器不一致 — 两端对齐text-align:justify |
| `6e3113f` | style: 笔记编辑/阅读器宽一致 — 加scrollbar-gutter:stable防滚动条位移 |
| `f6559c1` | fix: 笔记换行丢失 — 直接解析innerHTML中的&lt;br&gt;为\n，不依赖textContent |
| `346bfff` | fix: 笔记保存后换行丢失 — 移除textContent裁剪，保留原始内容\n |
| `effccda` | fix: 笔记保存后回车丢失 — 重写getContent/formatContent使用&lt;br&gt;保留换行 |
| `39dc0a5` | fix: 笔记编辑器矮框 — contenteditable加flex:1撑满 |
| `ba31e5e` | style: 笔记阅读器与编辑器等高 — min-height:100px |
| `6379900` | style: 笔记按钮加大+常显+去闪烁 |
| `1bcf755` | chore: 移除调试日志 — 笔记功能稳定后清理console.log |
| `4655a8a` | fix: 笔记不加载 — 后端SELECT缺AS paragraphNotes别名 |
| `4ee9993` | fix: 文章笔记加载 — setup中直接调用loadArticle不依赖生命周期 |
| `7db5445` | docs: 段落笔记功能文档 — 数据结构/API/表结构说明 |
| `9530658` | feat: 段落笔记 — 右侧笔记指示器、侧面板笔记编辑器、JSON存储 |
| `9926b15` | feat: pythonw无窗口运行脚本、TXT批量导入工具、文章预览首行、SVG图标替换 |
| `344e6b0` | feat: 书签面板、Python脚本启动、工具栏纯图标按钮 |
| `cb9d30c` | feat: 加载状态优化 + 注释卡片Enter确认 + SVG图标统一 + 侧边栏返回关闭 |
| `915b7ac` | feat: 翻译句子高亮 + 批注栏开关/内嵌按钮 + SVG图标 + 左侧工具侧边栏 + 文章卡片纯色 + 文档更新 |
| `7d775eb` | feat: sentence批注卡片不可见 + 同类型不可重叠 + 快捷键监听优化 |
| `4d65414` | fix: 长难句Delete改鼠标悬停定位 (无需先点击) |
| `603d0c7` | fix: 长难句蓝色+支持Delete删除+嵌套连续删除自动弹卡 |
| `aab7901` | feat: 多页阅读视图、查词开关、UI优化 |
| `faafd11` | fix: ManualWordCard查词防重复 + 点击选中清除 + ContentArea/ArticleCard样式优化 |
| `fec6ef1` | docs: 全量更新markdown — 移除验证码/回收站API补充/数据库表结构修正/提交记录同步 |
| `180ce80` | feat: 段落编号悬停显示+翻译提示仅在has-trans时显示 |
| `28d8355` | feat: 段落翻译导入(S键切换)+文章编辑器修复+画布字号调节 |
| `c45e72c` | chore: 移除访问验证码; 修复启动脚本标签问题; 更新文档 |

`node_modules`、`.env`、`mysql-data/`、`migrate-mysql.ps1` 已通过 `.gitignore` 排除。

---

## 每日工作流

```bash
# 1. 查看改了什么
git status

# 2. 添加改动到暂存区
git add .

# 3. 提交
git commit -m "描述你的改动"
```

---

## 常用命令

### 查看

| 命令 | 说明 |
|------|------|
| `git status` | 查看改动了哪些文件 |
| `git diff` | 查看具体改了什么内容 |
| `git log --oneline` | 查看提交历史（简短版） |
| `git log --oneline -5` | 查看最近 5 条提交 |

### 提交

| 命令 | 说明 |
|------|------|
| `git add .` | 添加所有改动 |
| `git add 文件名` | 添加指定文件 |
| `git commit -m "消息"` | 提交并写说明 |

### 撤销

| 命令 | 说明 |
|------|------|
| `git checkout .` | 撤销所有未提交的改动 |
| `git checkout 文件名` | 撤销指定文件的改动 |
| `git reset HEAD 文件名` | 取消暂存，改动保留 |

---

## 提交信息规范

建议使用简短前缀标注改动类型：

```bash
git commit -m "feat: 添加批注高亮功能"
git commit -m "fix: 修复查词不翻译问题"
git commit -m "docs: 更新架构文档"
git commit -m "style: 调整样式"
git commit -m "refactor: 重构代码结构"
```

| 前缀 | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档更新 |
| `style` | 样式调整 |
| `refactor` | 代码重构 |
| `chore` | 杂项（配置、依赖等） |

---

## 场景示例

### 改完几个功能后提交

```bash
git add .
git commit -m "feat: 添加批注存储到MySQL"
```

### 只想提交某几个文件

```bash
git add src/components/WordCard.vue src/views/ArticlePage.vue
git commit -m "fix: 修复单词卡片显示"
```

### 忘记加了什么，先看看

```bash
git status          # 看改了哪些文件
git diff            # 看具体改了什么
git add .
git commit -m "feat: 更新批注逻辑"
```

### 改错了，想回到上次提交的状态

```bash
git checkout .      # ⚠️ 不可逆，会丢失全部未提交的改动
```

---

## 查看历史

```bash
# 简短的提交列表
git log --oneline

# 某个文件的修改历史
git log --oneline -- server/index.js

# 对比两次提交的差异
git diff HEAD~1     # 和上一次提交的差异
```

---

## 已排除的文件（.gitignore）

以下文件不会被 Git 跟踪：

- `node_modules/` — npm 依赖（通过 `npm install` 安装）
- `.env` — 数据库密码等敏感信息
- `dist/` — 打包产物
- `mysql-data/` — MySQL 数据库文件（本地数据）
- `migrate-mysql.ps1` — 数据迁移脚本（一次性使用）
- 日志文件、测试报告等

---

## GitHub 远程仓库

远程地址：`git@github.com:lsp-hubb/language-learning.git`（SSH）

### 推送本地代码

```bash
git push
```

### 另一台电脑克隆

```bash
# 1. 配置 SSH Key（同上一步连接到 GitHub）
ssh-keygen -t ed25519 -C "your@email.com"
# 复制 ~/.ssh/id_ed25519.pub → GitHub Settings → SSH Keys

# 2. 克隆仓库
git clone git@github.com:lsp-hubb/language-learning.git
cd language-learning

# 3. 安装依赖
npm install

# 4. 配置 .env（数据库连接）
```

### 协作工作流

```bash
# 另一台电脑修改后提交
git add .
git commit -m "feat: 新增功能"
git push

# 主机拉取更新
git pull
```

---

## 数据库备份与恢复

项目根目录的 `db/language_learning.sql` 是数据库完整备份（通过 Git 同步），方便换电脑时迁移数据。

### 更新备份（每次新增数据后）

```bash
mysqldump -u root --databases language_learning > db/language_learning.sql
git add .
git commit -m "feat: 更新数据库备份"
git push
```

### 在新电脑恢复

```bash
# 1. 克隆代码
git clone git@github.com:lsp-hubb/language-learning.git
cd language-learning && npm install

# 2. 配置 .env（修改数据库密码）

# 3. 创建数据库并导入备份
mysql -u root -e "CREATE DATABASE IF NOT EXISTS language_learning DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root language_learning < db/language_learning.sql

# 4. 启动
start-mysql.bat   # 先确保 MySQL 运行
start.bat         # 启动前/后端
```

> 如果 MySQL 设置了 root 密码，命令中需添加 `-p` 参数：`mysql -u root -p ...`

---

## 备注

- 用户信息已配置：`JTL` / `jtl@example.com`
- 远程仓库：https://github.com/lsp-hubb/language-learning
- 项目仓库在：`f:\PythonProject\Language-learning\.git`
- 使用 SSH 方式连接（更稳定，不走 443 端口）
- 不跟踪 `node_modules`，换电脑后执行 `npm install` 即可恢复依赖
- **代码注释建议用英文**，`start.bat` 等批处理文件必须用纯英文避免编码问题
