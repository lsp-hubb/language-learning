# Language Learning

外语阅读辅助工具 — 读英文文章、查词、添加批注、手绘标记。

## 功能

- 文件夹管理（无限层级嵌套，右键菜单，刷新保持位置）
- 英文文章阅读/编辑，两端对齐排版，滚动条在容器右侧
- 选中单词自动查询有道词典（音标、释义、翻译，缓存去重；T 键开关；音标区悬停播发音）
- PDF 风格批注（E 高亮 / W 下划线，自动填入查词释义，精美卡片）
- 手绘画布（R 键开关，画笔/矩形/矩形擦除，6 色，笔迹 MySQL 存储支持局域网共享）
- 收藏文章（★ 按钮，数据持久化）
- 外部链接面板（腾讯元宝 iframe，L 键开关）
- 阅读计时器（点击切换开始/暂停/归零）
- 手动查词卡片（Ctrl+Shift+Z，支持联想词、一键复制、任意拖动、位置记忆、TTS 自动发音）
- 工具栏显示文章英文单词数
- 局域网共享 + 访问验证码（本机免验证）
- 重启恢复：回到上次退出前的页面

## 从零开始的安装说明

### 1. 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | ^20.19.0 或 >=22.12.0 | [下载](https://nodejs.org/) |
| **MySQL** | 8.0 | [下载](https://dev.mysql.com/downloads/installer/) |
| **npm** | 随 Node.js 自带 | — |
| **Git**（可选） | — | 用于克隆仓库，[下载](https://git-scm.com/) |

### 2. 获取代码

```bash
# 方式一：克隆仓库（需要 Git）
git clone git@github.com:lsp-hubb/language-learning.git
cd language-learning

# 方式二：直接下载 ZIP
# https://github.com/lsp-hubb/language-learning/archive/refs/heads/main.zip
# 解压后进入目录
```

### 3. 安装依赖

```bash
npm install
```

### 4. 配置 MySQL

#### 4.1 确保 MySQL 服务运行

```bash
# Windows — 检查 MySQL80 服务状态
sc query MySQL80

# 如果未运行，以管理员身份启动：
net start MySQL80

# 或双击项目根目录的 start-mysql.bat
```

#### 4.2 创建数据库

```bash
# 方式一：命令行
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS language_learning DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 方式二：MySQL Workbench 等 GUI 工具新建数据库 language_learning
```

#### 4.3 配置环境变量

在项目根目录创建 `.env` 文件（已加入 `.gitignore`，不会提交到 Git）：

```ini
# MySQL 连接配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=          # 你的 MySQL 密码（默认为空）
DB_NAME=language_learning

# 服务端口
SERVER_PORT=3000
```

### 5. 首次启动（初始化数据库）

#### 一键启动（Windows 推荐）

```bash
start.bat
```

此命令会自动：
1. 清理旧 Node 进程
2. 启动后端（端口 3000）
3. 启动前端（端口 5173，监听 `0.0.0.0`）
4. 显示局域网 IP 地址
5. 打开浏览器

#### 手动分别启动

```bash
# 终端 1：后端
npm run dev:server

# 终端 2：前端
npm run dev
```

#### 初始化数据库表

首次启动后，浏览器访问：

```
http://localhost:5173
```

前端会自动调用 `POST /api/init` 创建数据表。也可手动触发：

```bash
curl -X POST http://localhost:3000/api/init
```

> 画布笔迹 API（`canvas-strokes`）支持自动建表，无需手动 init。

### 6. 访问应用

| 地址 | 说明 |
|------|------|
| `http://localhost:5173` | 本机访问（免验证） |
| `http://192.168.x.x:5173` | 局域网其他设备访问（需输入验证码） |

> 验证码在启动后打印在**后端终端**中，为 8 位随机字符。

#### 局域网访问（首次需开放防火墙）

```cmd
netsh advfirewall firewall add rule name="Vite5173" dir=in action=allow protocol=TCP localport=5173
```

## 项目结构

```
Language-learning/
├── server/          # Express 后端 + MySQL
│   ├── db.js        # 数据库连接池
│   └── index.js     # API 路由
├── src/             # Vue 3 前端
│   ├── views/       # 页面（文件管理器、文章阅读）
│   ├── components/  # 组件（卡片、画布、菜单等）
│   ├── api/         # API 请求封装
│   ├── stores/      # Pinia 状态管理
│   └── router/      # 路由配置
├── start.bat        # Windows 一键启动
└── start-mysql.bat  # MySQL 启动脚本
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| E / W | 高亮 / 下划线 |
| T | 全局开关单词查询 |
| R | 开关画布模式 |
| L | 开关右侧链接面板 |
| Ctrl+Shift+Z | 打开/关闭手动查词卡片 |
| 1 / 2 / 3 | 画笔 / 矩形 / 矩形擦除（画布开启时） |
| Esc | 取消选中 / 关闭浮动卡片 / 关闭画布并保存 |
| Delete / Backspace | 删除当前查看的批注 |

## 技术栈

Vue 3 + Vite + Pinia + Express + MySQL + 有道词典

## 文档

| 文件 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 项目架构文档（详细架构、API 列表、数据流） |
| [GIT_GUIDE.md](./GIT_GUIDE.md) | Git 使用指南 |
| [MySQL连接配置说明.md](./MySQL连接配置说明.md) | 数据库配置说明 |
