# Language Learning

外语阅读辅助工具 — 读英文文章、查词、添加批注。

## 功能

- 文件夹管理（无限层级嵌套，右键菜单）
- 英文文章阅读/编辑
- 选中单词自动查询有道词典（音标、释义、翻译）
- PDF 风格批注（黄色高亮 + 红色下划线，注释编辑，数据存 MySQL）
- 局域网共享 + 访问验证码

## 快速开始

```bash
# 安装依赖
npm install

# 配置 .env（MySQL 连接信息）

# 一键启动（Windows）
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
