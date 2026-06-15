'use strict';

const https = require('https');
const { newPage, getLoggedInPage } = require('./browser');

async function generateApplyMessage(jobTitle, jobDescription) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const myName = process.env.MY_NAME || '';
  const myAge = process.env.MY_AGE || '';

  if (!apiKey) {
    return { message: generateTemplateMessage(jobTitle), price: '50000' };
  }

  const prompt = `
以下のCrowdWorksの案件に応募するメッセージと契約金額を生成してください。

【応募者情報】
氏名: ${myName}
年齢: ${myAge}歳

【案件タイトル】
${jobTitle}

【案件詳細】
${jobDescription.slice(0, 1000)}

JSONのみで回答してください：
{
  "message": "応募メッセージ（200〜300文字、案件の必須記載事項を必ず含める）",
  "price": "契約金額の数字のみ（案件の目安最小値、例: 50000）"
}
`.trim();

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const text = json.content?.[0]?.text?.trim();
            const clean = text.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(clean);
            resolve({
              message: parsed.message || generateTemplateMessage(jobTitle),
              price: parsed.price || '50000',
            });
          } catch {
            resolve({ message: generateTemplateMessage(jobTitle), price: '50000' });
          }
        });
      }
    );
    req.on('error', () => resolve({ message: generateTemplateMessage(jobTitle), price: '50000' }));
    req.write(body);
    req.end();
  });
}

function generateTemplateMessage(jobTitle) {
  const name = process.env.MY_NAME || '';
  const age = process.env.MY_AGE || '';
  return `はじめまして。${name}と申します（${age}歳）。「${jobTitle}」に応募させていただきます。ChatGPTやClaudeなどの生成AIを活用したコンテンツ制作の経験があり、SEOを意識した読みやすい記事作成が得意です。ご要望に沿った高品質な成果物をお届けできるよう尽力いたします。ぜひご検討いただければ幸いです。`;
}

async function getJobDetail(jobUrl) {
  await getLoggedInPage();
  const page = await newPage();

  try {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await new Promise(r => setTimeout(r, 3000));

    if (page.url().includes('/login')) {
      throw new Error('ログインセッションが切れています');
    }

    const detail = await page.evaluate(() => {
      const title = document.querySelector('h1')?.textContent?.trim() ?? 'タイトル不明';
      const description = document.querySelector('body')?.textContent?.trim().slice(0, 1000) ?? '';
      return { title, description };
    });

    return { ...detail, page };
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
}

async function applyToJob(jobId) {
  const jobUrl = `https://crowdworks.jp/public/jobs/${jobId}`;
  console.log(`[Apply] Starting application for job ${jobId}...`);

  let page;
  try {
    const detail = await getJobDetail(jobUrl);
    page = detail.page;

    console.log(`[Apply] Generating message for: ${detail.title}`);
    const { message: applyMessage, price: applyPrice } = await generateApplyMessage(detail.title, detail.description);
    console.log(`[Apply] Price: ${applyPrice}, Message: ${applyMessage.slice(0, 50)}...`);

    // 応募ページへ直接移動
    const applyUrl = `https://crowdworks.jp/proposals/new?job_offer_id=${jobId}`;
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await new Promise(r => setTimeout(r, 3000));
    console.log(`[Apply] Now on page: ${page.url()}`);

    // 契約金額を入力
    const priceInput = await page.$('input[type="number"], input[name*="price"], input[name*="amount"]');
    if (priceInput) {
      await priceInput.click({ clickCount: 3 });
      await priceInput.type(applyPrice, { delay: 30 });
      console.log(`[Apply] Price filled: ${applyPrice}`);
    }

    // テキストエリアに入力
    await page.waitForSelector('textarea', { timeout: 15_000, visible: true });
    await page.focus('textarea');
    await page.keyboard.type(applyMessage, { delay: 30 });
    console.log(`[Apply] Message filled. Submitting...`);

    // 応募するボタンをクリック
    const submitBtn = await page.$('input[value="応募する"], button.cw-button--primary, button[type="submit"]');
    if (!submitBtn) {
      throw new Error('送信ボタンが見つかりませんでした');
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
      submitBtn.click(),
    ]);

    const afterUrl = page.url();
    const isSuccess = !afterUrl.includes('/proposals/new');
    console.log(`[Apply] After submit URL: ${afterUrl}`);

    return {
      success: isSuccess,
      appliedMessage: applyMessage,
      jobId,
      jobTitle: detail.title,
    };

  } catch (err) {
    console.error(`[Apply] Error for job ${jobId}:`, err.message);
    return { success: false, error: err.message, jobId };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { applyToJob };
