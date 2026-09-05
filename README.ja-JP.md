# Renmi on Desk

Renmi は Electron で作られたデスクトップペット兼フォーカスワークスペースです。デスクトップに常駐し、AI コーディングや学習に寄り添いながら、対応する AI コーディングエージェントの状態をアニメーションで表示し、ポモドーロの集中セッションを Renmi の視覚・サウンドフィードバックと連動させます。

このリポジトリでは、既存の Clawd on Desk ランタイムを基盤に Renmi 製品を開発しています。製品名、デフォルトテーマ、認証フロー、ユーザー向けの入口は Renmi を基準にしています。

**言語:** [English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [한국어](README.ko-KR.md) · [Español](README.es.md)

## 機能

### デスクトップペット

- Renmi のデフォルトテーマには idle、thinking/working、notification、attention、sleeping、mini mode の状態アニメーションがあります。
- 透明なフローティングウィンドウ、カーソル追跡、ドラッグ位置指定、画面端の mini mode、マルチディスプレイ位置記憶に対応しています。
- クリック反応、睡眠/ウェイクアップ、サウンド通知、システムトレイメニューを提供します。
- AI コーディングエージェントのセッション、または Study Companion の集中フェーズでペットの状態を動かせます。アクティブなコーディングエージェントセッションがある場合は、その状態が優先されます。
- Settings → Theme で組み込みテーマの切り替え、テーマごとのカスタマイズ、互換性のある Codex Pet アニメーションパッケージのインポートができます。現在の組み込みテーマは Renmi、Clawd、Calico です。

### AI コーディングエージェントの状態認識

複数セッションを区別できるマルチエージェントランタイムを搭載しています。次の Agent アダプターに対応しています。

Claude Code、Codex CLI、Copilot CLI、Gemini CLI、Antigravity CLI、Cursor Agent、CodeBuddy、WorkBuddy、Kiro CLI、Kimi Code CLI、Qwen Code、ZCode、CodeWhale、opencode、MiMo Code、Pi、OpenClaw、Hermes Agent、Qoder、QoderWork、QwenWork、Reasonix CLI、DeepSeek Harness。

Agent ごとに対応機能は異なります。状態報告のみのものもあれば、ローカル権限バブル、セッション表示、ターミナルフォーカスに対応するものもあります。インストール状態、有効化状態、利用できる操作は Settings → Agents で確認してください。Renmi profile がユーザーのマシン上の外部連携ファイルを勝手に書き換えることはありません。

### Study Companion とポモドーロ

ペットのコンテキストメニューまたはシステムトレイから `Open Study Dashboard` を開くと、独立した Study Companion ウィンドウに移動します。

- タイトル、見積もり時間、締切、タグ/カテゴリ、四象限の優先度を持つタスク一覧。
- 完了進捗を表示でき、集中セッションと関連付けられるサブタスク。
- 作成日時、締切、見積もり時間、優先度で並べ替え、タグまたは四象限でグループ化。
- カウントダウンとカウントアップ、15・25・30・45 分の集中時間、設定可能な短い休憩。
- 長いサブタスクを複数の集中サイクルに分割し、サイクル間の自動一時停止または手動継続を選択。
- タスク一覧を隠して気を散らしにくくする全画面フォーカスモード。
- 集中サイクルの完了時に Renmi の状態、アニメーション、サウンドを連動。完了したタスクは自動的にチェックされ、一覧の下へ移動します。
- タスク、ポモドーロ状態、ポイントは Electron のユーザーデータディレクトリにある `study-data.json` に保存され、コーディングエージェントのセッション状態とは分離されています。

### アカウントと認証

Renmi は独立した認証サービスを使用します。開発ランチャーがローカル認証 API を起動し、そのアドレスを Electron に自動で渡します。現在の UI は認証済みの `@ruc.edu.cn` メールアカウントを対象としており、次に対応しています。

- メール認証付きアカウント登録。
- パスワードログインまたはメールコードログイン。
- パスワードリセットとメールアドレス変更の認証。
- 管理者メールログインと管理者コンソール。

ローカル開発のアカウント・監査データは、デフォルトで `~/.renmiao/auth-dev.json` に保存されます。認証コードは Resend 経由で送信され、ターミナルには表示されません。認証シークレットは `cloud/.env` またはデプロイ先のシークレット管理に保存し、レンダラーコードやパッケージ済みクライアントのアセットに入れないでください。

## 開発環境

### 必要環境

- Node.js `>= 22.12.0`
- npm
- Electron を実行できる Windows、macOS、または Linux
- メール認証用の Resend API key と検証済みの送信元アドレス

### インストールと起動

```bash
npm install
cp cloud/.env.example cloud/.env
```

ローカル認証では、`cloud/.env` に少なくとも `RENMI_ADMIN_PASSWORD_HASH`、`RESEND_API_KEY`、検証済みの `AUTH_EMAIL_FROM` を設定します。管理者パスワードのハッシュは次のコマンドで生成できます。

```bash
npm run cloud:hash-password
```

デスクトップアプリを起動します。

```bash
npm start
# または
npm run dev
```

どちらも `scripts/renmiao-dev.js` を使用します。`8787–8791` から空いているポートを選び、ローカル認証 API を起動してヘルスチェックを待ってから Electron を起動し、選択した API アドレスを自動的に渡します。認証 API だけを起動する場合は次を実行します。

```bash
npm run cloud:dev
```

### テストとビルド

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

本番パッケージでは、`RENMI_AUTH_API_URL` にデプロイ済み HTTPS 認証エンドポイントを指定します。

```bash
RENMI_AUTH_API_URL=https://auth.example.com npm run build:mac
```

データベース認証情報、Supabase service-role key、管理者資格情報、メールサービスのシークレットは認証サーバーだけに置いてください。

## プロジェクト構成

| ディレクトリ/ファイル | 役割 |
| --- | --- |
| `src/main.js` | Electron メインプロセスの構成、ライフサイクル、IPC、ランタイム接続 |
| `src/renderer.js` | ペットの描画、アニメーション切り替え、目の追跡 |
| `src/pet-window-runtime.js` | ペットの表示/入力ウィンドウ、位置、操作 |
| `src/state.js`、`src/agent-runtime-main.js` | Agent セッション状態機械、複数セッションの統合、更新 |
| `src/study-runtime.js` | タスク、サブタスク、ポモドーロ、ポイントのランタイム処理 |
| `src/study-window.js`、`src/study-dashboard.html` | Study Companion のウィンドウと UI |
| `src/auth-runtime.js`、`src/auth-client.js`、`src/auth.html` | Electron 側の認証ウィンドウ、セッション、API クライアント |
| `cloud/api/` | ローカル/クラウド認証 API、メール配信、リポジトリ |
| `src/settings-*.js` | Settings UI、検証、永続化、ランタイム効果 |
| `agents/`、`hooks/` | Agent レジストリ、モニター、hook/plugin インストーラー |
| `themes/` | 組み込みテーマ、アセット、テーマ設定 |
| `test/` | Node.js テストとランタイム/契約 fixture |

## 開発規約

- CommonJS を使用します。リソースパスは `path.join(__dirname, ...)` で構築してください。
- Settings の永続化経路は `prefs.js` → `settings-controller.js` → `settings-store.js` です。設定変更は controller/actions を経由してください。
- Study Companion のデータと Agent セッションデータは別の契約です。どちらかを変更する場合は、対応する IPC、ウィンドウ、レンダラーの利用箇所も確認してください。
- Agent の機能定義は `agents/registry.js` が正とします。他のモジュールに Agent 一覧を複製しないでください。
- テーマアセットを編集する前に `assets/source/` へコピーしてください。出所の不明な素材を直接変更しないでください。
- `cloud/.env`、認証データ、ローカル Electron ユーザーデータをコミットしないでください。

## ドキュメント

- [Agent ランタイムアーキテクチャ](docs/project/agent-runtime-architecture.md)
- [テーマ、状態、Settings](docs/project/theme-state-ui.md)
- [テーマ作成ガイド](docs/guides/guide-theme-creation.md)
- [カスタム HTTP Agent ガイド](docs/guides/custom-agent-http.md)
- [認証サービスの説明](cloud/README.md)

## ライセンス

このプロジェクトは [AGPL-3.0-only](LICENSE) ライセンスで提供されます。
