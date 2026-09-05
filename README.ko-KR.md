# Renmi on Desk

Renmi는 Electron으로 만든 데스크톱 펫이자 집중 작업 공간입니다. 데스크톱에 상주하면서 AI 코딩과 학습을 함께하고, 지원되는 AI 코딩 에이전트의 상태를 애니메이션으로 보여 주며, 뽀모도로 집중 세션을 Renmi의 시각 및 사운드 피드백과 연결합니다.

이 저장소는 기존 Clawd on Desk 런타임을 기반으로 Renmi 제품을 개발합니다. 제품명, 기본 테마, 인증 흐름과 사용자 진입점은 Renmi를 기준으로 합니다.

**언어:** [English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja-JP.md) · [Español](README.es.md)

## 기능

### 데스크톱 펫

- Renmi 기본 테마에는 idle, thinking/working, notification, attention, sleeping, mini mode 상태 애니메이션이 포함되어 있습니다.
- 투명 플로팅 창, 커서 추적, 드래그 위치 지정, 화면 가장자리 mini mode, 다중 모니터 위치 기억을 지원합니다.
- 클릭 반응, 수면/깨우기, 사운드 알림과 시스템 트레이 메뉴를 제공합니다.
- AI 코딩 에이전트 세션 또는 Study Companion 집중 단계가 펫 상태를 구동할 수 있습니다. 활성 코딩 에이전트 세션이 있으면 해당 상태가 우선합니다.
- Settings → Theme에서 기본 테마 전환, 테마별 커스터마이즈, 호환되는 Codex Pet 애니메이션 패키지 가져오기를 지원합니다. 현재 기본 테마는 Renmi, Clawd, Calico입니다.

### AI 코딩 에이전트 상태 감지

저장소에는 여러 세션을 구분할 수 있는 멀티 에이전트 런타임이 포함되어 있습니다. 다음 Agent용 어댑터를 제공합니다.

Claude Code, Codex CLI, Copilot CLI, Gemini CLI, Antigravity CLI, Cursor Agent, CodeBuddy, WorkBuddy, Kiro CLI, Kimi Code CLI, Qwen Code, ZCode, CodeWhale, opencode, MiMo Code, Pi, OpenClaw, Hermes Agent, Qoder, QoderWork, QwenWork, Reasonix CLI, DeepSeek Harness.

에이전트마다 기능은 다릅니다. 상태만 보고하는 에이전트도 있고, 로컬 권한 말풍선, 세션 보기 또는 터미널 포커스를 지원하는 에이전트도 있습니다. 설치 상태, 활성화 상태와 사용 가능한 작업은 Settings → Agents에서 확인하세요. Renmi profile은 사용자의 컴퓨터에 있는 외부 통합 파일을 몰래 수정하지 않습니다.

### Study Companion과 뽀모도로

펫 컨텍스트 메뉴 또는 시스템 트레이에서 `Open Study Dashboard`를 열면 별도의 Study Companion 창으로 이동합니다.

- 작업 목록: 제목, 예상 소요 시간, 마감일, 태그/카테고리, 4분면 우선순위.
- 하위 작업: 완료 진행률 표시와 집중 세션 연결.
- 생성 시간, 마감일, 예상 시간 또는 우선순위로 정렬하고 태그나 4분면별로 그룹화.
- 카운트다운/카운트업 타이머, 15·25·30·45분 집중 시간과 설정 가능한 짧은 휴식.
- 긴 하위 작업을 여러 집중 사이클로 나누고, 사이클 사이 자동 일시정지 또는 수동 계속을 선택.
- 전체 화면 집중 모드로 작업 목록을 숨겨 방해를 줄임.
- 집중 사이클이 끝나면 Renmi 상태, 애니메이션과 사운드 피드백이 실행됩니다. 완료된 작업은 자동으로 체크되고 목록 아래로 이동합니다.
- 작업, 뽀모도로 상태와 포인트는 Electron 사용자 데이터 디렉터리의 `study-data.json`에 저장되며 코딩 에이전트 세션 상태와 분리됩니다.

### 계정과 인증

Renmi는 별도의 인증 서비스를 사용합니다. 개발 런처가 로컬 인증 API를 시작하고 주소를 Electron에 자동으로 전달합니다. 현재 UI는 인증된 `@ruc.edu.cn` 이메일 계정을 대상으로 하며 다음을 지원합니다.

- 이메일 인증을 통한 계정 등록.
- 비밀번호 로그인 또는 이메일 코드 로그인.
- 비밀번호 재설정과 이메일 변경 인증.
- 관리자 이메일 로그인과 관리자 콘솔.

로컬 개발 계정과 감사 데이터는 기본적으로 `~/.renmiao/auth-dev.json`에 저장됩니다. 인증 코드는 Resend를 통해 전송되며 터미널에 출력되지 않습니다. 인증 비밀값은 `cloud/.env` 또는 배포 플랫폼의 비밀값 관리자에 보관하고, 렌더러 코드나 패키징된 클라이언트 리소스에 넣지 마세요.

## 개발 환경

### 요구 사항

- Node.js `>= 22.12.0`
- npm
- Electron을 실행할 수 있는 Windows, macOS 또는 Linux
- 이메일 인증을 위한 Resend API key와 인증된 발신 주소

### 설치 및 실행

```bash
npm install
cp cloud/.env.example cloud/.env
```

로컬 인증을 위해 `cloud/.env`에 최소한 `RENMI_ADMIN_PASSWORD_HASH`, `RESEND_API_KEY`, 인증된 `AUTH_EMAIL_FROM`을 설정하세요. 관리자 비밀번호 해시는 다음 명령으로 생성할 수 있습니다.

```bash
npm run cloud:hash-password
```

데스크톱 앱 실행:

```bash
npm start
# 또는
npm run dev
```

두 명령은 `scripts/renmiao-dev.js`를 함께 사용합니다. `8787–8791` 중 사용 가능한 포트를 선택하고, 로컬 인증 API를 시작한 뒤 상태 확인을 마치면 Electron을 실행하며 선택된 API 주소를 자동으로 전달합니다. 인증 API만 실행하려면 다음을 사용하세요.

```bash
npm run cloud:dev
```

### 테스트 및 빌드

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

프로덕션 패키징에는 `RENMI_AUTH_API_URL`로 배포된 HTTPS 인증 엔드포인트를 지정해야 합니다.

```bash
RENMI_AUTH_API_URL=https://auth.example.com npm run build:mac
```

데이터베이스 인증 정보, Supabase service-role key, 관리자 인증 정보와 메일 서비스 비밀값은 인증 서버에만 보관해야 합니다.

## 프로젝트 구조

| 디렉터리/파일 | 역할 |
| --- | --- |
| `src/main.js` | Electron 메인 프로세스 구성, 생명주기, IPC와 런타임 연결 |
| `src/renderer.js` | 펫 렌더링, 애니메이션 전환과 눈동자 추적 |
| `src/pet-window-runtime.js` | 펫 표시/입력 창, 위치 지정과 상호작용 |
| `src/state.js`, `src/agent-runtime-main.js` | 에이전트 세션 상태 머신, 멀티 세션 병합과 업데이트 |
| `src/study-runtime.js` | 작업, 하위 작업, 뽀모도로와 포인트 런타임 로직 |
| `src/study-window.js`, `src/study-dashboard.html` | Study Companion 창과 UI |
| `src/auth-runtime.js`, `src/auth-client.js`, `src/auth.html` | Electron 측 인증 창, 세션과 API 클라이언트 |
| `cloud/api/` | 로컬/클라우드 인증 API, 메일 전송과 저장소 |
| `src/settings-*.js` | Settings UI, 검증, 저장과 런타임 효과 |
| `agents/`, `hooks/` | Agent 레지스트리, 모니터와 hook/plugin 설치기 |
| `themes/` | 기본 테마, 리소스와 테마 설정 |
| `test/` | Node.js 테스트와 런타임/계약 fixture |

## 개발 규칙

- 프로젝트는 CommonJS를 사용합니다. 리소스 경로는 `path.join(__dirname, ...)`으로 구성하세요.
- Settings 저장 흐름은 `prefs.js` → `settings-controller.js` → `settings-store.js`입니다. 설정 변경은 controller/actions를 거쳐야 합니다.
- Study Companion 데이터와 에이전트 세션 데이터는 별도 계약입니다. 어느 한 계약을 변경할 때 해당 IPC, 창과 렌더러 소비자를 함께 확인하세요.
- Agent 기능의 기준은 `agents/registry.js`입니다. 다른 모듈에 Agent 목록을 복제하지 마세요.
- 테마 리소스를 편집하기 전에 `assets/source/`로 복사하세요. 출처가 불명확한 작업 리소스를 직접 수정하지 마세요.
- `cloud/.env`, 인증 데이터와 로컬 Electron 사용자 데이터를 커밋하지 마세요.

## 문서

- [Agent 런타임 아키텍처](docs/project/agent-runtime-architecture.md)
- [테마, 상태와 Settings](docs/project/theme-state-ui.md)
- [테마 생성 가이드](docs/guides/guide-theme-creation.md)
- [사용자 지정 HTTP Agent 가이드](docs/guides/custom-agent-http.md)
- [인증 서비스 안내](cloud/README.md)

## 라이선스

이 프로젝트는 [AGPL-3.0-only](LICENSE) 라이선스로 배포됩니다.
