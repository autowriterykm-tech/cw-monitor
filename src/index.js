'use strict';

const express = require('express');
const { startMonitor } = require('./monitor');
const { handleWebhook } = require('./webhook');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ヘルスチェック（Renderが必要とする）
app.get('/', (req, res) => res.send('CW Monitor is running.'));

// LINE Messaging API Webhook
app.post('/webhook', handleWebhook);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
  // サーバー起動後に監視を開始
  startMonitor().catch(err => {
    console.error('[Monitor] Fatal error in startMonitor:', err);
    process.exit(1);
  });
});
