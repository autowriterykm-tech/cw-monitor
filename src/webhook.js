'use strict';
const { applyToJob } = require('./apply');
const { pushTelegram } = require('./line');

/**
 * Telegram Webhook ハンドラ
 */
async function handleWebhook(req, res) {
  // 即時200応答
  res.sendStatus(200);

  // secret_token 検証（TELEGRAM_WEBHOOK_SECRET を設定している場合のみ）
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== secret) {
      console.warn('[Webhook] Secret token mismatch. Ignored.');
      return;
    }
  }

  const message = req.body?.message;
  if (!message || typeof message.text !== 'string') return;

  const text = message.text.trim();
  const chatId = message.chat?.id;

  // 自分以外のチャットからのメッセージは無視（安全のため）
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  if (allowedChatId && String(chatId) !== String(allowedChatId)) {
    console.warn(`[Webhook] Ignored message from unauthorized chat: ${chatId}`);
    return;
  }

  console.log(`[Webhook] Received message: "${text}"`);

  // 「OK 案件ID」または「OK」のみの形式に対応
  const okMatch = text.match(/^OK\s*[：:・]?\s*(\d+)?$/i);
  if (!okMatch) {
    // 無関係なメッセージは無視
    return;
  }

  const jobId = okMatch[1];
  if (!jobId) {
    await pushTelegram(
      '応募する案件IDを教えてください。\n例: OK 1234567'
    ).catch(console.error);
    return;
  }

  await pushTelegram(
    `案件ID: ${jobId} への応募を開始します...\nしばらくお待ちください。`
  ).catch(console.error);

  // 非同期で応募処理
  applyToJob(jobId)
    .then(async result => {
      const successMsg = result.success
        ? `✅ 案件 ${jobId} への応募が完了しました！\n\n📝 送信したメッセージ:\n${result.appliedMessage}`
        : `❌ 応募に失敗しました: ${result.error}`;
      await pushTelegram(successMsg).catch(console.error);
    })
    .catch(async err => {
      console.error('[Webhook] applyToJob error:', err);
      await pushTelegram(`❌ 応募処理中にエラーが発生しました: ${err.message}`)
        .catch(console.error);
    });
}

module.exports = { handleWebhook };
