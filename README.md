# CW Monitor v2

CrowdWorksの案件を自動監視し、LINEで通知・承認後に自動応募するシステム。

## アーキテクチャ

```
[Render Docker] ─── Puppeteer ──→ CrowdWorks（ログイン済み）
      │                              └─ 案件スクレイピング（15分ごと）
      │                              └─ 応募フォーム送信
      │
      ├── LINE Notify ──→ あなたのLINE（新着通知）
      │
      └── Express Webhook ←── LINE Messaging API（「OK 案件ID」受信）
```

## セットアップ手順

### 1. LINE の準備

**LINE Notify（通知用）**
1. https://notify-bot.line.me/my/ にアクセス
2. 「トークンを発行する」→ 通知先を「1:1でLINE Notifyから通知を受け取る」に設定
3. 発行されたトークンを `LINE_NOTIFY_TOKEN` に設定

**LINE Messaging API（承認受信用）**
1. https://developers.line.biz/ で新規チャンネル作成（Messaging API）
2. 「Channel access token」を `LINE_CHANNEL_ACCESS_TOKEN` に設定
3. 「Channel secret」を `LINE_CHANNEL_SECRET` に設定
4. Botに「hello」と送信し、Renderのログで `LINE_USER_ID` を確認して設定

### 2. GitHubにpush

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/cw-monitor.git
git push -u origin main
```

### 3. Render にデプロイ

1. https://render.com → 「New +」→「Web Service」
2. GitHubリポジトリを接続
3. **Environment** タブで以下を設定：
   - `CW_EMAIL` / `CW_PASSWORD`
   - `LINE_NOTIFY_TOKEN`
   - `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `LINE_USER_ID`
   - `ANTHROPIC_API_KEY`（任意）
4. デプロイ完了後、URLをコピー（例: `https://cw-monitor.onrender.com`）

### 4. LINE Webhook URL を設定

1. LINE Developers Console → Messaging API チャンネル
2. Webhook URL に `https://cw-monitor.onrender.com/webhook` を設定
3. 「Verify」で200が返ることを確認

## 使い方

1. 自動的にCrowdWorksを監視し、新着案件をLINEで通知
2. 応募したい案件が来たら `OK 1234567`（案件ID付き）または `OK` と返信
3. AIが応募メッセージを生成して自動送信、結果をLINEで通知

## ローカル開発

```bash
cp .env.example .env
# .env を編集して各種トークンを設定
npm install
node src/index.js
```

## 注意事項

- Renderの無料インスタンスは**15分間アクセスがないとスリープ**します
  → UptimeRobot等で `/` エンドポイントを定期pingすると常時起動になります
- CrowdWorksの利用規約を遵守してください
- 応募前に必ず `apply.js` の動作をローカルでテストしてください
