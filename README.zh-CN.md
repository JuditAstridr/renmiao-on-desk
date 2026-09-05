# Renmi on Desk

Renmi 是一个基于 Electron 的桌面宠物与专注工作台。它常驻在桌面上，陪伴用户进行 AI 编程和日常学习：桌宠会根据支持的 AI coding agent 状态播放动画，也会把番茄钟专注阶段与 Renmi 的视觉、声音反馈联动起来。

本仓库是在 Clawd on Desk 运行时基础上开发的 Renmi 应用，当前产品名称、默认主题、认证流程和用户入口均以 Renmi 为准。

**语言版本：** [English](README.md) · [繁體中文](README.zh-TW.md) · [한국어](README.ko-KR.md) · [日本語](README.ja-JP.md) · [Español](README.es.md)

## 功能概览

### 桌面宠物

- Renmi 默认主题包含 idle、thinking/working、notification、attention、sleeping 和 mini mode 等状态素材。
- 支持透明悬浮窗口、鼠标跟随、拖拽定位、边缘 mini mode 和跨显示器位置记忆。
- 支持点击互动、睡眠/唤醒、声音提示和系统托盘菜单。
- 桌宠状态可以由 AI coding agent 会话或 Study Companion 的专注阶段驱动；有活跃 coding agent 时，agent 状态优先。
- Settings → Theme 支持切换内置主题、主题自定义和导入兼容的 Codex Pet 动画包。当前内置主题为 Renmi、Clawd 和 Calico。

### AI coding agent 状态感知

仓库保留多 Agent 状态运行时，可以区分多个并行会话。当前包含以下 Agent 的适配能力：

Claude Code、Codex CLI、Copilot CLI、Gemini CLI、Antigravity CLI、Cursor Agent、CodeBuddy、WorkBuddy、Kiro CLI、Kimi Code CLI、Qwen Code、ZCode、CodeWhale、opencode、MiMo Code、Pi、OpenClaw、Hermes Agent、Qoder、QoderWork、QwenWork、Reasonix CLI 和 DeepSeek Harness。

不同 Agent 的能力不同：有些只上报状态，有些还支持本地权限气泡、会话视图或终端聚焦。具体安装状态、启用状态和可用操作以 Settings → Agents 中显示的内容为准。Renmi profile 不会静默改写用户机器上的外部集成文件。

### Study Companion 与番茄钟

从桌宠右键菜单或系统托盘菜单打开 `Open Study Dashboard`，进入独立的 Study Companion 工作窗口：

- 任务清单：任务标题、预估时长、DDL、标签/分类和四象限优先级。
- 子任务：把主任务拆分为步骤，显示完成进度，并可将子任务关联到专注时段。
- 任务整理：按创建时间、DDL、预估时长或优先级排序，也可以按标签或四象限分组。
- 番茄钟：支持倒计时和正计时，专注时长可选 15、25、30 或 45 分钟，并可设置短休息时间。
- 长任务：较长子任务可以拆分为多个专注周期，可选择周期之间自动暂停或手动继续。
- 专注模式：切换为全屏专注视图后隐藏任务列表，减少其他信息干扰。
- 完成联动：专注周期完成会触发 Renmi 的状态、动画和声音反馈；任务完成后会自动勾选并沉底。
- 数据持久化：任务、番茄钟和积分数据保存在 Electron 用户数据目录的 `study-data.json` 中，与 coding-agent session 状态分开管理。

### 登录与注册

Renmi 使用独立的认证服务。开发启动器会自动启动本地认证 API，并把 API 地址传给 Electron。当前认证界面面向已验证的 `@ruc.edu.cn` 邮箱，支持：

- 邮箱验证注册账号。
- 邮箱验证码登录或密码登录。
- 忘记密码和重置密码。
- 修改绑定邮箱时的邮箱验证。
- 管理员邮箱登录和管理员控制台。

本地开发的账号和审计数据默认保存在 `~/.renmiao/auth-dev.json`。验证码通过 Resend 发送，不会打印到终端。认证密钥应放在 `cloud/.env` 或部署平台的密钥管理中，不能写入渲染进程代码或客户端打包资源。

## 开发环境

### 环境要求

- Node.js `>= 22.12.0`
- npm
- 支持 Electron 的 Windows、macOS 或 Linux 环境
- 邮箱验证需要可用的 Resend API key 和已验证发件地址

### 安装与启动

```bash
npm install
cp cloud/.env.example cloud/.env
```

本地认证至少需要在 `cloud/.env` 中配置 `RENMI_ADMIN_PASSWORD_HASH`、`RESEND_API_KEY` 和已验证的 `AUTH_EMAIL_FROM`。管理员密码哈希可以使用下面的命令生成：

```bash
npm run cloud:hash-password
```

启动桌面应用：

```bash
npm start
# 或
npm run dev
```

两个命令使用同一个 `scripts/renmiao-dev.js` 启动器。它会在 `8787–8791` 中选择空闲端口，启动本地认证 API，等待健康检查通过后再启动 Electron，并自动传入选中的 API 地址。只启动认证 API 可使用：

```bash
npm run cloud:dev
```

### 测试与构建

```bash
npm test
npm run verify:electron
npm run audit:assets

npm run build
npm run build:mac
npm run build:linux
npm run build:win:x64
npm run build:win:arm64
npm run build:all
```

生产打包时需要通过 `RENMI_AUTH_API_URL` 指定部署好的 HTTPS 认证服务，例如：

```bash
RENMI_AUTH_API_URL=https://auth.example.com npm run build:mac
```

数据库凭据、Supabase service-role key、管理员凭据和邮件服务密钥只能保留在认证服务端。

## 代码结构

| 目录/文件 | 作用 |
| --- | --- |
| `src/main.js` | Electron 主进程组合入口，负责生命周期、IPC 和运行时接线 |
| `src/renderer.js` | 桌宠渲染、动画切换和眼球跟随 |
| `src/pet-window-runtime.js` | 桌宠显示/输入窗口、定位和交互 |
| `src/state.js`、`src/agent-runtime-main.js` | Agent session 状态机、多会话合并和状态更新 |
| `src/study-runtime.js` | 任务、子任务、番茄钟和积分运行时逻辑 |
| `src/study-window.js`、`src/study-dashboard.html` | Study Companion 窗口及 UI |
| `src/auth-runtime.js`、`src/auth-client.js`、`src/auth.html` | Electron 侧认证窗口、会话和 API 客户端 |
| `cloud/api/` | 本地/云端认证 API、邮件发送和数据仓库 |
| `src/settings-*.js` | Settings UI、校验、持久化和运行时效果 |
| `agents/`、`hooks/` | Agent 注册表、监控器和 hook/plugin 安装器 |
| `themes/` | 内置主题、素材和主题配置 |
| `test/` | Node.js 测试和运行时/契约 fixture |

## 开发约定

- 项目使用 CommonJS；资源路径统一通过 `path.join(__dirname, ...)` 构造。
- Settings 持久化链路是 `prefs.js` → `settings-controller.js` → `settings-store.js`，修改设置应通过 controller/actions。
- Study Companion 数据与 Agent session 数据是独立合约，修改任一合约时都要检查对应的 IPC、窗口和渲染层消费者。
- Agent 能力以 `agents/registry.js` 为准，不要在其他模块复制 Agent 名单。
- 编辑主题素材前，先复制到 `assets/source/`；不要直接修改来源不明的素材。
- 不要提交 `cloud/.env`、认证数据或本地 Electron 用户数据。

## 相关文档

- [Agent 运行时架构](docs/project/agent-runtime-architecture.md)
- [主题、状态与 Settings](docs/project/theme-state-ui.md)
- [主题创建指南](docs/guides/guide-theme-creation.md)
- [自定义 HTTP Agent 接入](docs/guides/custom-agent-http.md)
- [认证服务说明](cloud/README.md)

## 许可证

本项目使用 [AGPL-3.0-only](LICENSE) 许可证。
