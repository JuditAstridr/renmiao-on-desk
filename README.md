# Renmi on Desk

Renmi is an Electron desktop pet and focus workspace. It stays on your desktop while you code or study, reflects supported AI coding-agent activity through animation, and connects Pomodoro focus sessions with Renmi's visual and sound feedback.

This repository develops the Renmi product on top of the existing Clawd on Desk runtime. The product name, default theme, authentication flow, and user-facing entry points are Renmi-specific.

**Languages:** [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [한국어](README.ko-KR.md) · [日本語](README.ja-JP.md) · [Español](README.es.md)

## Features

### Desktop pet

- Renmi's default theme includes idle, thinking/working, notification, attention, sleeping, and mini-mode visuals.
- Transparent floating windows, cursor tracking, drag positioning, edge mini mode, and multi-display position memory.
- Click reactions, sleep/wake behavior, sound cues, and a system-tray menu.
- The pet can be driven by an AI coding-agent session or by a Study Companion focus phase. An active coding-agent session remains the visual authority.
- Settings → Theme supports built-in themes, per-theme customization, and compatible Codex Pet animation-package imports. The current built-in themes are Renmi, Clawd, and Calico.

### AI coding-agent status

The repository contains a multi-agent runtime that can distinguish multiple sessions. Its adapters cover:

Claude Code, Codex CLI, Copilot CLI, Gemini CLI, Antigravity CLI, Cursor Agent, CodeBuddy, WorkBuddy, Kiro CLI, Kimi Code CLI, Qwen Code, ZCode, CodeWhale, opencode, MiMo Code, Pi, OpenClaw, Hermes Agent, Qoder, QoderWork, QwenWork, Reasonix CLI, and DeepSeek Harness.

Capabilities vary by agent: some report state only, while others also support local permission bubbles, session views, or terminal focus. Installation state, enablement, and available actions are shown in Settings → Agents. The Renmi profile does not silently rewrite external integration files on the user's machine.

### Study Companion and Pomodoro

Open `Open Study Dashboard` from the pet's context menu or the system tray to enter the separate Study Companion window:

- Task list with title, estimated duration, deadline, tags/categories, and four-quadrant priority.
- Subtasks with completion progress and focus-session association.
- Sorting by creation time, deadline, estimated duration, or priority; grouping by tag or quadrant.
- Count-down and count-up timers, with 15, 25, 30, and 45-minute focus options and configurable short breaks.
- Long subtasks can be split into multiple focus cycles, with optional automatic or manual continuation between cycles.
- Full-screen focus mode hides the task list and reduces distractions.
- Completed focus cycles trigger Renmi state, animation, and sound feedback. Finished tasks are checked automatically and moved to the bottom.
- Tasks, Pomodoro state, and points are persisted in `study-data.json` inside the Electron user-data directory and remain separate from coding-agent session state.

### Account and authentication

Renmi uses a separate authentication service. The development launcher starts a local authentication API and passes its address to Electron automatically. The current UI is intended for verified `@ruc.edu.cn` email accounts and supports:

- Account registration with email verification.
- Password login or email-code login.
- Password reset and email-change verification.
- Administrator email login and an administrator console.

Local development account and audit data are stored by default at `~/.renmiao/auth-dev.json`. Verification codes are delivered through Resend and are never printed to the terminal. Keep authentication secrets in `cloud/.env` or in the deployment platform's secret manager; never place them in renderer code or packaged client assets.

## Development

### Requirements

- Node.js `>= 22.12.0`
- npm
- Windows, macOS, or Linux with Electron support
- A Resend API key and verified sender address for email verification

### Install and run

```bash
npm install
cp cloud/.env.example cloud/.env
```

For local authentication, configure at least `RENMI_ADMIN_PASSWORD_HASH`, `RESEND_API_KEY`, and a verified `AUTH_EMAIL_FROM` in `cloud/.env`. Generate the administrator password hash with:

```bash
npm run cloud:hash-password
```

Start the desktop app with either command:

```bash
npm start
# or
npm run dev
```

Both commands use `scripts/renmiao-dev.js`. It selects an available port from `8787–8791`, starts the local authentication API, waits for its health check, and then launches Electron with the selected API URL. To run only the authentication API:

```bash
npm run cloud:dev
```

### Test and build

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

Production packaging requires a deployed HTTPS authentication endpoint, supplied through `RENMI_AUTH_API_URL`:

```bash
RENMI_AUTH_API_URL=https://auth.example.com npm run build:mac
```

Database credentials, Supabase service-role keys, administrator credentials, and mail-service secrets belong only on the authentication server.

## Project structure

| Directory/file | Responsibility |
| --- | --- |
| `src/main.js` | Electron main-process composition, lifecycle, IPC, and runtime wiring |
| `src/renderer.js` | Pet rendering, animation switching, and eye tracking |
| `src/pet-window-runtime.js` | Pet display/input windows, positioning, and interaction |
| `src/state.js`, `src/agent-runtime-main.js` | Agent session state machine, multi-session merging, and updates |
| `src/study-runtime.js` | Tasks, subtasks, Pomodoro, and points runtime logic |
| `src/study-window.js`, `src/study-dashboard.html` | Study Companion window and UI |
| `src/auth-runtime.js`, `src/auth-client.js`, `src/auth.html` | Electron-side authentication window, session, and API client |
| `cloud/api/` | Local/cloud authentication API, mail delivery, and repositories |
| `src/settings-*.js` | Settings UI, validation, persistence, and runtime effects |
| `agents/`, `hooks/` | Agent registry, monitors, and hook/plugin installers |
| `themes/` | Built-in themes, assets, and theme configuration |
| `test/` | Node.js tests and runtime/contract fixtures |

## Development conventions

- The project uses CommonJS. Build resource paths with `path.join(__dirname, ...)`.
- Settings persistence follows `prefs.js` → `settings-controller.js` → `settings-store.js`; changes should go through the controller/actions.
- Study Companion data and agent-session data are separate contracts. Changes to either contract should be checked across its IPC, window, and renderer consumers.
- Agent capabilities are authoritative in `agents/registry.js`; do not duplicate the agent list in another module.
- Copy source assets into `assets/source/` before editing them. Do not directly modify assets whose provenance is unclear.
- Do not commit `cloud/.env`, authentication data, or local Electron user data.

## Documentation

- [Agent runtime architecture](docs/project/agent-runtime-architecture.md)
- [Theme, state, and Settings](docs/project/theme-state-ui.md)
- [Theme creation guide](docs/guides/guide-theme-creation.md)
- [Custom HTTP Agent guide](docs/guides/custom-agent-http.md)
- [Authentication service guide](cloud/README.md)

## License

This project is licensed under [AGPL-3.0-only](LICENSE).
