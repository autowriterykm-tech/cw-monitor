'use strict';
const https = require('https');

/**
 * Slack と Telegram に通知（LINEは卒業）
 * ※ monitor.js が notifyLine を呼んでいるため、関数名は維持
 */
async function notifyLine(message) {
  await Promise.allSettled([
    pushSlack(message),
    pushTelegram(message),
  ]);
}

/**
 * Telegram にメッセージ送信
 */
async function pushTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const body = JSON.stringify({ chat_id: chatId, text });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('[Telegram] Message sent successfully');
          } else {
            console.error(`[Telegram] Push error: ${res.statusCode} ${data}`);
          }
          resolve(data);
        });
      }
    );
    req.on('error', (e) => {
      console.error('[Telegram] Request error:', e.message);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

/**
 * Slack にメッセージ送信（既存のまま）
 */
async function pushSlack(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID || '#general';
  if (!token) return;

  const body = JSON.stringify({ channel, text });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'slack.com',
        path: '/api/chat.postMessage',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.ok) console.log('[Slack] Message sent successfully');
            else console.error('[Slack] Error:', json.error);
          } catch (_) {}
          resolve(data);
        });
      }
    );
    req.on('error', (e) => {
      console.error('[Slack] Request error:', e.message);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

module.exports = { notifyLine, pushTelegram, pushSlack };
