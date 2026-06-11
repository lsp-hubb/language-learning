# Language Learning

外语阅读辅助工具 — 读英文文章、查词、添加批注、手绘标记。

## 功能

- 文件夹管理（无限层级嵌套，右键菜单，刷新保持位置）
- 英文文章阅读/编辑，两端对齐排版，滚动条在容器右侧
- 选中单词自动查询有道词典（音标、释义、翻译，缓存去重；T 键开关）
- PDF 风格批注（E 高亮 / W 下划线，自动填入查词释义，精美卡片）
- 手绘画布（R 键开关，画笔/矩形/橡皮擦，6 色，每篇文章笔迹独立存储）
- 收藏文章（★ 按钮，数据持久化）
- 外部链接面板（腾讯元宝 iframe，查阅时可快速翻译）
- 局域网共享 + 访问验证码（本机免验证）
- 重启恢复：回到上次退出前的页面

## 快速开始

```bash
# 安装依赖
npm install

# 配置 .env（MySQL 连接信息）

# 启动 MySQL（首次或未运行时）
start-mysql.bat

# 一键启动前后端（Windows）
start.bat

# 或手动启动
npm run dev:server   # 后端 :3000
npm run dev          # 前端 :5173
```

## 技术栈

Vue 3 + Vite + Pinia + Express + MySQL + 有道词典

## 文档

| 文件 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 项目架构文档 |
| [GIT_GUIDE.md](./GIT_GUIDE.md) | Git 使用指南 |
| [MySQL连接配置说明.md](./MySQL连接配置说明.md) | 数据库配置说明 |
