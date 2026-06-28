# Git 使用指南

## 当前状态

项目已初始化 Git 仓库，最近提交：

| 提交 | 说明 |
|------|------|
| *待提交* | feat: 加载状态优化 + 注释卡片Enter确认 + SVG图标统一 + 侧边栏返回关闭 |
| `915b7ac` | feat: 翻译句子高亮 + 批注栏开关/内嵌按钮 + SVG图标 + 左侧工具侧边栏 + 文章卡片纯色 + 文档更新 |
| `7d775eb` | feat: sentence批注卡片不可见 + 同类型不可重叠 + 快捷键监听优化 |
| `4d65414` | fix: 长难句Delete改鼠标悬停定位 (无需先点击) |
| `603d0c7` | fix: 长难句蓝色+支持Delete删除+嵌套连续删除自动弹卡 |
| `aab7901` | feat: 多页阅读视图、查词开关、UI优化 |
| `faafd11` | fix: ManualWordCard查词防重复 + 点击选中清除 + ContentArea/ArticleCard样式优化 |
| `fec6ef1` | docs: 全量更新markdown — 移除验证码/回收站API补充/数据库表结构修正/提交记录同步 |
| `180ce80` | feat: 段落编号悬停显示+翻译提示仅在has-trans时显示 |
| `ea50665` | feat: 更新数据库备份 — 18篇文章/105条批注(新增4篇考研英语文章+20条批注) |
| `1d12290` | fix: 修正数据概览 — 实际18篇文章/105条批注(考研英语10篇) |
| `42e38f6` | docs: 全量更新markdown — 数据概览修正(GIT_GUIDE提交记录同步+ARCHITECTURE数据14条文章/85条批注+README项目结构补充) |
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
git commit -m "feat: 更新验证码逻辑"
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
start-all.bat
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
