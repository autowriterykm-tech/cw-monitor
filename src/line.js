'use strict';
const https = require('https');

/**
 * Slack と LINE 両方に通知
 */
async function notifyLine(message) {
  await Promise.allSettled([
    pushSlack(message),
    pushLine(message),
  ]);
}

/**
 * Slack にメッセージ送信
 */
async function pushSlack(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID || '#general';
  if (!token) return;

  const body = JSON.stringify({
    channel,
    text,
  });

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
          const json = JSON.parse(data);
          if (json.ok) {
            console.log('[Slack] Message sent successfully');
          } else {
            console.error('[Slack] Error:', json.error);
          }
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

/**
 * LINE Push メッセージ
 */
async function pushLine(text) {
  const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;
  if (!channelToken || !userId) return;

  const body = JSON.stringify({
    to: userId,
    messages: [{ type: 'text', text }],
  });

  return new Promise((resolve) => {
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
            console.log('[LINE] Message sent successfully');
          } else {
            console.error(`[LINE] Push error: ${res.statusCode} ${data}`);
          }
          resolve(data);
        });
      }
    );
    req.on('error', (e) => {
      console.error('[LINE] Request error:', e.message);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

async function replyLine(replyToken, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;

  const body = JSON.stringify({
    replyToken,
    messages: [{ type: 'text', text }],
  });

  return new Promise((resolve) => {
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
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', resolve);
    req.write(body);
    req.end();
  });
}

module.exports = { notifyLine, replyLine, pushSlack, pushLine };
