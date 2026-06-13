# Git 使用指南

## 当前状态

项目已初始化 Git 仓库，最近提交：

| 提交 | 说明 |
|------|------|
| `60754b9` | fix: 注释卡片编辑模式下移出不关闭，点击外部自动保存 |
| `008ca27` | docs: 重写 README、新增划词自动扩展单词 |
| `4019632` | fix: 恢复画布笔迹 MySQL 存储代码 |
| `d4252e1` | docs: 更新文档 |
| `baf027e` | feat: 画布功能、单页阅读优化、链接面板、UI调整 |
| `ad3b437` | feat: 收藏功能、多页批注修复、外部链接面板、文档更新 |
| `aab7901` | feat: 多页阅读视图、查词开关、UI 优化 |

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

## 备注

- 用户信息已配置：`JTL` / `jtl@example.com`
- 远程仓库：https://github.com/lsp-hubb/language-learning
- 项目仓库在：`f:\PythonProject\Language-learning\.git`
- 使用 SSH 方式连接（更稳定，不走 443 端口）
- 不跟踪 `node_modules`，换电脑后执行 `npm install` 即可恢复依赖
- **代码注释建议用英文**，`start.bat` 等批处理文件必须用纯英文避免编码问题
