# Renmi on Desk

Renmi 是一個基於 Electron 的桌面寵物與專注工作台。它常駐在桌面上，陪伴使用者進行 AI 程式設計和日常學習：桌寵會依照支援的 AI coding agent 狀態播放動畫，也會把番茄鐘專注階段與 Renmi 的視覺、聲音回饋串聯起來。

本儲存庫是在 Clawd on Desk 執行時基礎上開發的 Renmi 應用程式，現在的產品名稱、預設主題、驗證流程和使用者入口都以 Renmi 為準。

**語言版本：** [English](README.md) · [簡體中文](README.zh-CN.md) · [한국어](README.ko-KR.md) · [日本語](README.ja-JP.md) · [Español](README.es.md)

## 功能概覽

### 桌面寵物

- Renmi 預設主題包含 idle、thinking/working、notification、attention、sleeping 和 mini mode 等狀態素材。
- 支援透明懸浮視窗、滑鼠跟隨、拖曳定位、邊緣 mini mode 和跨顯示器位置記憶。
- 支援點擊互動、睡眠/喚醒、聲音提示和系統匣選單。
- 桌寵狀態可以由 AI coding agent 工作階段或 Study Companion 專注階段驅動；有活躍 coding agent 時，以 agent 狀態為優先。
- Settings → Theme 支援切換內建主題、主題自訂和匯入相容的 Codex Pet 動畫套件。目前內建主題為 Renmi、Clawd 和 Calico。

### AI coding agent 狀態感知

儲存庫保留多 Agent 狀態執行時，可以區分多個並行工作階段。目前包含以下 Agent 的適配能力：

Claude Code、Codex CLI、Copilot CLI、Gemini CLI、Antigravity CLI、Cursor Agent、CodeBuddy、WorkBuddy、Kiro CLI、Kimi Code CLI、Qwen Code、ZCode、CodeWhale、opencode、MiMo Code、Pi、OpenClaw、Hermes Agent、Qoder、QoderWork、QwenWork、Reasonix CLI 和 DeepSeek Harness。

不同 Agent 的能力各不相同：有些只回報狀態，有些還支援本機權限氣泡、工作階段檢視或終端機聚焦。實際的安裝狀態、啟用狀態和可用操作以 Settings → Agents 顯示的內容為準。Renmi profile 不會靜默改寫使用者電腦上的外部整合檔案。

### Study Companion 與番茄鐘

從桌寵右鍵選單或系統匣選單開啟 `Open Study Dashboard`，進入獨立的 Study Companion 工作視窗：

- 任務清單：任務標題、預估時長、截止日期、標籤/分類和四象限優先級。
- 子任務：將主任務拆分為步驟，顯示完成進度，並可將子任務關聯到專注時段。
- 任務整理：依建立時間、截止日期、預估時長或優先級排序，也可以依標籤或四象限分組。
- 番茄鐘：支援倒數計時和正計時，專注時長可選 15、25、30 或 45 分鐘，也可設定短休息時間。
- 長任務：較長的子任務可以拆分成多個專注週期，可選擇週期之間自動暫停或手動繼續。
- 專注模式：切換至全螢幕專注檢視後隱藏任務清單，減少其他資訊干擾。
- 完成聯動：專注週期完成會觸發 Renmi 的狀態、動畫和聲音回饋；任務完成後會自動勾選並移到底部。
- 資料持久化：任務、番茄鐘和積分資料儲存在 Electron 使用者資料目錄的 `study-data.json`，與 coding-agent 工作階段狀態分開管理。

### 登入與註冊

Renmi 使用獨立的驗證服務。開發啟動器會自動啟動本機驗證 API，並將 API 位址傳給 Electron。目前驗證介面面向已驗證的 `@ruc.edu.cn` 信箱，支援：

- 以信箱驗證註冊帳號。
- 信箱驗證碼登入或密碼登入。
- 忘記密碼與重設密碼。
- 變更綁定信箱時的信箱驗證。
- 管理員信箱登入與管理員控制台。

本機開發的帳號與稽核資料預設儲存在 `~/.renmiao/auth-dev.json`。驗證碼透過 Resend 寄送，不會印在終端機。驗證密鑰應放在 `cloud/.env` 或部署平台的密鑰管理中，不要寫入渲染程序程式碼或客戶端封裝資源。

## 開發環境

### 環境需求

- Node.js `>= 22.12.0`
- npm
- 支援 Electron 的 Windows、macOS 或 Linux 環境
- 電子郵件驗證需要可用的 Resend API key 和已驗證的寄件地址

### 安裝與啟動

```bash
npm install
cp cloud/.env.example cloud/.env
```

本機驗證至少需要在 `cloud/.env` 中設定 `RENMI_ADMIN_PASSWORD_HASH`、`RESEND_API_KEY` 和已驗證的 `AUTH_EMAIL_FROM`。管理員密碼雜湊可以使用以下指令產生：

```bash
npm run cloud:hash-password
```

啟動桌面應用程式：

```bash
npm start
# 或
npm run dev
```

兩個指令使用同一個 `scripts/renmiao-dev.js` 啟動器。它會在 `8787–8791` 中選擇空閒連接埠，啟動本機驗證 API，等待健康檢查通過後再啟動 Electron，並自動傳入選定的 API 位址。只啟動驗證 API 可使用：

```bash
npm run cloud:dev
```

### 測試與建置

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

正式封裝時需要透過 `RENMI_AUTH_API_URL` 指定已部署的 HTTPS 驗證服務，例如：

```bash
RENMI_AUTH_API_URL=https://auth.example.com npm run build:mac
```

資料庫憑證、Supabase service-role key、管理員憑證和郵件服務密鑰只能保留在驗證服務端。

## 程式碼結構

| 目錄/檔案 | 作用 |
| --- | --- |
| `src/main.js` | Electron 主程序組合入口，負責生命週期、IPC 和執行時接線 |
| `src/renderer.js` | 桌寵渲染、動畫切換和眼球跟隨 |
| `src/pet-window-runtime.js` | 桌寵顯示/輸入視窗、定位和互動 |
| `src/state.js`、`src/agent-runtime-main.js` | Agent 工作階段狀態機、多工作階段合併和狀態更新 |
| `src/study-runtime.js` | 任務、子任務、番茄鐘和積分執行時邏輯 |
| `src/study-window.js`、`src/study-dashboard.html` | Study Companion 視窗與 UI |
| `src/auth-runtime.js`、`src/auth-client.js`、`src/auth.html` | Electron 端驗證視窗、工作階段和 API 用戶端 |
| `cloud/api/` | 本機/雲端驗證 API、郵件傳送和資料儲存庫 |
| `src/settings-*.js` | Settings UI、驗證、持久化和執行時效果 |
| `agents/`、`hooks/` | Agent 註冊表、監控器和 hook/plugin 安裝器 |
| `themes/` | 內建主題、素材和主題設定 |
| `test/` | Node.js 測試和執行時/契約 fixture |

## 開發約定

- 專案使用 CommonJS；資源路徑統一透過 `path.join(__dirname, ...)` 建立。
- Settings 持久化鏈路是 `prefs.js` → `settings-controller.js` → `settings-store.js`，修改設定應透過 controller/actions。
- Study Companion 資料與 Agent 工作階段資料是獨立契約，修改任一契約時都要檢查對應的 IPC、視窗和渲染層消費者。
- Agent 能力以 `agents/registry.js` 為準，不要在其他模組複製 Agent 名單。
- 編輯主題素材前，先複製到 `assets/source/`；不要直接修改來源不明的素材。
- 不要提交 `cloud/.env`、驗證資料或本機 Electron 使用者資料。

## 相關文件

- [Agent 執行時架構](docs/project/agent-runtime-architecture.md)
- [主題、狀態與 Settings](docs/project/theme-state-ui.md)
- [主題建立指南](docs/guides/guide-theme-creation.md)
- [自訂 HTTP Agent 接入](docs/guides/custom-agent-http.md)
- [驗證服務說明](cloud/README.md)

## 授權條款

本專案使用 [AGPL-3.0-only](LICENSE) 授權。
