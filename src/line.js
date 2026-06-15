'use strict';

const https = require('https');

/**
 * LINE Messaging API Push でメッセージ送信（通知用）
 */
async function notifyLine(message) {
  return pushLine(message);
}

/**
 * LINE Messaging API でメッセージ送信（reply token 使用）
 */
async function replyLine(replyToken, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が設定されていません');

  const body = JSON.stringify({
    replyToken,
    messages: [{ type: 'text', text }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.line.me',
        path: '/v2/bot/message/reply',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`LINE Reply error: ${res.statusCode} ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * LINE Push メッセージ（replyToken不要）
 */
async function pushLine(text) {
  const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

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
res.on('end', () => {
  if (res.statusCode === 200) {
    resolve(data);
  } else {
    console.error(`[LINE] Push error: ${res.statusCode} ${data}`);
    resolve(data);
  }
});
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { notifyLine, replyLine, pushLine };
