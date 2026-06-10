<div align="center">

<img src="banner.jpg" alt="点之出众餐饮智能工作台" width="500"/>

<p>

**线上餐饮代运营定制化 AI 智能助手**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-28+-9feaf9.svg)](https://www.electronjs.org/)

</div>

---

## 📖 简介

点之出众餐饮智能工作台是面向**线上餐饮代运营**场景的定制化 AI 智能助手。它帮助餐饮运营团队自动化处理外卖平台数据采集、经营分析、评价管理、门店巡检、运营报告生成等日常工作。

### 🎯 核心场景

- 📊 **数据采集** — 自动采集美团/饿了么等平台的营业数据、评分、评价
- 📈 **经营分析** — 分析每日/每周/每月经营数据，发现异常和趋势
- ⭐ **评价管理** — 监控差评预警，协助撰写回复话术
- 🏪 **门店巡检** — 通过浏览器自动化检查门店页面信息是否完整准确
- 📋 **运营报告** — 自动生成日报/周报，发送到飞书/企微群
- ⏰ **定时任务** — 设置每日营业数据采集、定时发送报告等
- 🔧 **营销支持** — 活动策划建议、竞品分析、菜品定价参考

### ✨ 核心能力

- 🤖 **多 Tab 多 Agent** — 每个门店/每个平台独立会话，互不干扰
- 🔧 **20+ 内置工具** — 浏览器控制、文件操作、飞书/微信/企微消息、定时任务等
- 🧠 **记忆系统** — 长期记住门店信息、菜品数据、运营经验、客户反馈
- 🌐 **浏览器自动化** — 自动操作外卖平台页面，采集数据、检查信息
- 📱 **多平台接入** — 飞书、微信、企业微信，运营团队随时对话
- 🔌 **Skill 扩展** — 可安装专业技能包，扩展 AI 能力

---

## 🚀 快速开始

### 桌面版（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/cheakerwu/dzcz--agent.git
cd dzcz--agent

# 2. 安装依赖
pnpm install

# 3. 启动开发环境
pnpm run dev
```

### Docker 部署

```bash
# 1. 复制配置文件并填写 API Key
cp .env.example .env
# 编辑 .env，填写 AI_API_KEY、AI_BASE_URL、AI_MODEL_ID

# 2. 启动
docker-compose up -d

# 3. 访问
# http://localhost:3008
```

---

## 📦 项目结构

```
src/
├── main/                      # 主进程（Electron）
│   ├── agent-runtime/         # Agent 运行时
│   ├── agents/                # Agent 配置和 Prompt 加载
│   ├── browser/               # 浏览器自动化（agent-browser）
│   ├── connectors/            # 外部平台连接器（飞书/微信/企微/客服）
│   ├── database/              # 数据库（SQLite）
│   ├── prompts/               # 系统提示词模板
│   ├── scheduled-tasks/       # 定时任务引擎
│   ├── session/               # 会话管理
│   ├── tools/                 # 20+ 内置工具
│   └── gateway.ts             # 核心网关（消息路由）
├── renderer/                  # 前端界面（React）
├── server/                    # Web 服务模式（Express + WebSocket）
└── shared/                    # 共享类型和工具
```

---

## 🔧 配置

### AI 模型配置

在 `.env` 或桌面版「系统设置」中配置：

```env
AI_API_KEY=your-api-key
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL_ID=qwen-max
AI_API_TYPE=openai-completions
```

支持的模型提供商：
- **通义千问**（默认）— qwen-max / qwen-plus
- **DeepSeek** — deepseek-chat
- **OpenAI** — gpt-4o
- **Google Gemini** — gemini-2.5-pro-preview
- **Anthropic Claude** — claude-sonnet-4-6

### 外部平台接入

| 平台 | 用途 | 配置方式 |
|------|------|---------|
| 飞书 | 运营群消息、文档操作 | 系统设置 → 飞书 |
| 微信 | 私聊/群聊 | 系统设置 → 微信 |
| 企业微信 | 应用消息推送 | 系统设置 → 企业微信 |
| 智能客服 | 客户服务 | 系统设置 → 智能客服 |

---

## 📝 常用指令

| 指令 | 说明 |
|------|------|
| `/new` | 清空当前会话，开始新对话 |
| `/memory` | 查看和管理记忆 |
| `/history` | 查看对话历史统计 |
| `/stop` | 停止当前正在执行的任务 |
| `/status` | 查看当前任务执行状态 |
| `/reload-path` | 刷新环境变量 |

---

## 🛠️ 技术栈

- **前端**：React 18 + TypeScript + Tailwind CSS + Vite
- **桌面端**：Electron 28+
- **后端**：Express + WebSocket
- **数据库**：SQLite
- **AI 引擎**：@mariozechner/pi-agent-core
- **浏览器自动化**：agent-browser (Playwright)
- **包管理**：pnpm

---

## 📄 许可证

[MIT License](LICENSE)

---

<div align="center">

**点之出众** — 让餐饮运营更智能

</div>
