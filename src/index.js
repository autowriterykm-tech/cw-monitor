'use strict';
const express = require('express');
const https = require('https');
const { startMonitor } = require('./monitor');
const { handleWebhook } = require('./webhook');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ヘルスチェック（Renderが必要とする）
app.get('/', (req, res) => res.send('CW Monitor is running.'));

// Telegram Webhook
app.post('/webhook', handleWebhook);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);

  // Telegram に webhook URL を自動登録（起動時に1回）
  setTelegramWebhook().catch(e =>
    console.error('[Telegram] setWebhook error:', e.message)
  );

  // 監視ループ開始
  startMonitor().catch(err => {
    console.error('[Monitor] Fatal error in startMonitor:', err);
    process.exit(1);
  });
});

/**
 * Telegram の Webhook URL を登録する（起動時に1回）
 * Render が自動で渡す RENDER_EXTERNAL_URL を使う。
 * 自前のURLを使いたい場合は WEBHOOK_BASE_URL を環境変数に設定。
 */
function setTelegramWebhook() {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_BASE_URL;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

    if (!token || !baseUrl) {
      console.warn('[Telegram] Webhook 未設定: TELEGRAM_BOT_TOKEN か baseUrl が足りません。');
      return resolve();
    }

    const hookUrl = `${baseUrl.replace(/\/$/, '')}/webhook`;
    const params = new URLSearchParams({ url: hookUrl });
    if (secret) params.set('secret_token', secret);

    const path = `/bot${token}/setWebhook?${params.toString()}`;
    const req = https.request(
      { hostname: 'api.telegram.org', path, method: 'GET' },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          console.log(`[Telegram] setWebhook response: ${data}`);
          resolve();
        });
      }
    );
    req.on('error', e => {
      console.error('[Telegram] setWebhook request error:', e.message);
      resolve();
    });
    req.end();
  });
}
