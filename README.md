# AI 比价购物系统

> 输入商品名称，AI 自动控制真实浏览器，同时访问京东、淘宝、拼多多三大平台，逐一点开前 5 个商品详情页，提取价格、评价、优惠券，最终给出最优购买建议。

[![.NET](https://img.shields.io/badge/.NET-8.0-512BD4?style=flat-square)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square)](https://react.dev/)
[![DeepSeek](https://img.shields.io/badge/LLM-DeepSeek-4F46E5?style=flat-square)](https://api-docs.deepseek.com/)
[![Browser--Use](https://img.shields.io/badge/Browser-Browser--Use-22C55E?style=flat-square)](https://github.com/browser-use/browser-use)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square)](https://docs.docker.com/compose/)

---

## 功能特性

- **真实浏览器操作**：基于 Browser-Use + Playwright，AI 操控有头 Chromium，完整模拟人工浏览
- **三平台同步比价**：京东、淘宝、拼多多，每平台逐一打开前 5 个商品详情页
- **深度信息提取**：商品名称、到手价、优惠券/满减、好评率、差评原因、月销量
- **自动领券尝试**：看到"领取"按钮自动点击，记录是否领取成功
- **实时可视化**：noVNC 将容器内浏览器画面实时传输到前端 iframe，所见即所得
- **AI 思考展示**：Agent 运行日志实时流式推送，思考过程可折叠展开
- **手动登录支持**：遇到扫码/密码登录弹窗时，系统暂停并提示用户，登录后自动继续
- **登录态持久化**：Cookie 自动保存，容器重启后无需重新登录
- **DeepSeek API Key 前端配置**：无需修改任何文件，点击右上角按钮即可设置

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     React 前端 (Vite)                    │
│   商品搜索框 · Agent 日志流 · noVNC 实时浏览器 · 比价报告  │
└───────────────────┬─────────────────────────────────────┘
                    │ Server-Sent Events (SSE)  /api/agent/search
┌───────────────────▼─────────────────────────────────────┐
│             C# ASP.NET Core 后端 (.NET 8)                │
│                                                          │
│  PriceHunterAgentService  ← ReAct 主循环                 │
│  ├── 调用 DeepSeek API（工具调用模式）                    │
│  ├── BrowserSearchTool   ← 调用 Python 浏览器服务        │
│  └── AgentController     ← SSE 流式推送 + 15s keepalive  │
│                                                          │
│  OpenAiCompatibleProvider ← 兼容 DeepSeek / OpenAI 格式  │
└───────────────────┬─────────────────────────────────────┘
                    │ HTTP  /search  /result  /resume
┌───────────────────▼─────────────────────────────────────┐
│           Python Browser-Use 微服务 (FastAPI)            │
│                                                          │
│  run_one_platform()  ← 每平台独立 Agent，共享浏览器上下文  │
│  ├── 京东：search.jd.com 搜索 + 详情页提取               │
│  ├── 淘宝：s.taobao.com 搜索 + 详情页提取                │
│  └── 拼多多：mobile.pinduoduo.com + JS 专用动作          │
│      ├── dismiss_pdd_overlay()   关闭扫码浮层             │
│      ├── extract_pdd_search_results()  卡片数据提取       │
│      └── extract_pdd_product_links()  商品链接提取        │
│                                                          │
│  Xvfb :99 → Chromium (headed) → x11vnc → websockify     │
│                              ↓                           │
│                    noVNC WebSocket :6080                  │
└─────────────────────────────────────────────────────────┘
```

---

## 项目结构

```
PriceHunterAgent/
├── docker-compose.yml                  # 一键启动三服务
│
├── browser-service/                    # Python Browser-Use 微服务
│   ├── Dockerfile
│   ├── main.py                         # FastAPI 服务 + Agent 逻辑 + 自定义动作
│   ├── requirements.txt
│   └── start.sh                        # Xvfb + x11vnc + websockify 启动脚本
│
├── backend/                            # C# ASP.NET Core 后端
│   └── PriceHunterAgent/
│       ├── Agent/
│       │   ├── PriceHunterAgentService.cs  # ReAct 主循环 + 工具调用
│       │   ├── LoginSessionStore.cs        # 登录暂停/恢复信号量
│       │   └── Tools/
│       │       └── BrowserSearchTool.cs    # 调用 Python 微服务
│       ├── Controllers/
│       │   └── AgentController.cs          # SSE 流式端点 + keepalive
│       ├── Providers/
│       │   ├── ILlmProvider.cs
│       │   ├── OpenAiCompatibleProvider.cs # DeepSeek / OpenAI 兼容层
│       │   └── LlmProviderFactory.cs
│       ├── Program.cs
│       └── appsettings.json                # DeepSeek 模型 + 服务地址配置
│
├── frontend/                           # React 前端
│   ├── Dockerfile
│   ├── nginx.conf                      # 静态服务 + /api 反代 + 缓存策略
│   └── src/
│       └── App.jsx                     # 全部 UI 逻辑
│
└── browser-data/                       # (运行时自动创建，挂载到宿主机)
    ├── Default/                        # Chromium 持久化 Profile（含 Cookie）
    └── saved_cookies.json              # Cookie 备份文件
```

---

## 快速启动

### 前提条件

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 已安装并运行
- [DeepSeek API Key](https://platform.deepseek.com/)（需要充值少量余额）

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd PriceHunterAgent
```

### 2. 启动所有服务

```bash
docker compose up --build
```

首次构建约需 3~5 分钟（下载依赖）。启动成功后：

| 服务 | 地址 |
|---|---|
| 前端主界面 | http://localhost |
| 实时浏览器 (noVNC) | http://localhost:6080 |
| 后端 API | http://localhost:5000 |

### 3. 配置 DeepSeek API Key

打开 **http://localhost**，点击右上角 **API Key** 按钮，输入你的 DeepSeek API Key（格式：`sk-...`），点击保存。

### 4. 开始比价

在搜索框输入商品名称（如"戴森 V15 吸尘器"），点击**开始比价**，观察 AI 在实时浏览器中自动操作。

---

## 登录说明

京东、淘宝、拼多多均需要登录后才能查看完整价格和优惠信息。

**首次使用**：

1. AI 遇到登录页时，前端会弹出提示横幅
2. 在 noVNC 实时浏览器窗口中手动扫码或输入账号密码完成登录
3. 点击前端的**已完成登录**按钮，AI 自动继续

**后续使用**：登录 Cookie 已自动保存到本地 `browser-data/` 目录，容器重启后无需重新登录。

---

## 容器管理命令

```bash
# 启动（后台）
docker compose up -d

# 查看日志
docker compose logs -f browser-service
docker compose logs -f backend

# 重启单个服务
docker compose restart browser-service

# 重新构建并启动（代码有修改时）
docker compose build backend && docker compose up -d backend

# 停止所有服务
docker compose down
```

---

## 热重载开发

`browser-service/` 目录已挂载为 volume，修改 `main.py` 后 `uvicorn --reload` 会自动重载，无需重新构建镜像。

`backend/` 和 `frontend/` 修改后需要重新构建对应镜像：

```bash
# 前端
docker compose build frontend && docker compose up -d frontend

# 后端
docker compose build backend && docker compose up -d backend
```

---

## 技术栈

| 层 | 技术 |
|---|---|
| 大模型（后端主逻辑） | DeepSeek API — `deepseek-v4-flash`（推理 + 工具调用） |
| 大模型（浏览器 Agent） | DeepSeek API — `deepseek-chat`（Browser-Use 要求支持 `tool_choice`） |
| 浏览器自动化 | Browser-Use 0.1.x + Playwright + Chromium |
| 浏览器可视化 | Xvfb + x11vnc + websockify + noVNC |
| 后端 | C# ASP.NET Core .NET 8 |
| 前端 | React 18 + Vite |
| 容器化 | Docker + Docker Compose |
| 反向代理 | Nginx |
| 流式通信 | Server-Sent Events (SSE) |

---

## 作者

**Raymondeng** © 2026
