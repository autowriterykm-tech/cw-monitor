'use strict';

const https = require('https');

/**
 * LINE Notify でメッセージ送信
 */
async function notifyLine(message, jobId) {
  const token = process.env.LINE_NOTIFY_TOKEN;
  if (!token) throw new Error('LINE_NOTIFY_TOKEN が設定されていません');

  const body = new URLSearchParams({ message }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'notify-api.line.me',
        path: '/api/notify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
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
            reject(new Error(`LINE Notify error: ${res.statusCode} ${data}`));
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

module.exports = { notifyLine, replyLine };
