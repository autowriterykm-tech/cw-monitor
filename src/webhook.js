'use strict';

const crypto = require('crypto');
const { replyLine } = require('./line');
const { applyToJob } = require('./apply');

/**
 * LINE Webhook のシグネチャ検証
 */
function verifySignature(body, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return true; // 開発中は検証スキップ（本番では必ず設定すること）

  const hash = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
  return hash === signature;
}

/**
 * Webhook ハンドラ
 */
async function handleWebhook(req, res) {
  // Renderへの即時200応答（LINEは5秒以内の応答を要求）
  res.sendStatus(200);

  const signature = req.headers['x-line-signature'];
  const rawBody = JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    console.warn('[Webhook] Signature verification failed');
    return;
  }

  const events = req.body?.events ?? [];

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const text = event.message.text.trim();
    const replyToken = event.replyToken;

    console.log(`[Webhook] Received message: "${text}"`);

    // 「OK 案件ID」または「OK」のみの形式に対応
    const okMatch = text.match(/^OK\s*[：:・]?\s*(\d+)?$/i);
    if (!okMatch) {
      // 無関係なメッセージは無視
      continue;
    }

    const jobId = okMatch[1];

    if (!jobId) {
      await replyLine(replyToken,
        '応募する案件IDを教えてください。\n例: OK 1234567'
      ).catch(console.error);
      continue;
    }

    await replyLine(replyToken,
      `案件ID: ${jobId} への応募を開始します...\nしばらくお待ちください。`
    ).catch(console.error);

    // 非同期で応募処理
    applyToJob(jobId)
      .then(async result => {
        const successMsg = result.success
          ? `✅ 案件 ${jobId} への応募が完了しました！\n\n📝 送信したメッセージ:\n${result.appliedMessage}`
          : `❌ 応募に失敗しました: ${result.error}`;

        // push メッセージで結果を通知（reply tokenは既に使用済みのため）
        await pushLine(successMsg).catch(console.error);
      })
      .catch(async err => {
        console.error('[Webhook] applyToJob error:', err);
        await pushLine(`❌ 応募処理中にエラーが発生しました: ${err.message}`)
          .catch(console.error);
      });
  }
}

/**
 * LINE Push メッセージ（replyToken不要）
 */
const https = require('https');
async function pushLine(text) {
  const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID; // 通知先ユーザーID

  if (!channelToken || !userId) return;

  const body = JSON.stringify({
    to: userId,
    messages: [{ type: 'text', text }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.line.me',
        path: '/v2/bot/message/push',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${channelToken}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { handleWebhook };
