'use strict';

const { newPage, getLoggedInPage } = require('./browser');

async function generateApplyMessage(jobTitle, jobDescription) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return generateTemplateMessage(jobTitle);
  }

  const https = require('https');
  const prompt = `
以下のCrowdWorksの案件に対して、採用されやすい自然な日本語の応募メッセージを作成してください。
- 長さは200〜300文字程度
- AIやライティングの経験があることをアピール
- 丁寧かつ熱意が伝わる文体
- 定型文っぽくならないよう自然に

【案件タイトル】
${jobTitle}

【案件詳細】
${jobDescription.slice(0, 500)}

応募メッセージのみを出力してください（前置きや説明は不要）。
`.trim();

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
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
            const text = json.content?.[0]?.text;
            resolve(text ? text.trim() : generateTemplateMessage(jobTitle));
          } catch {
            resolve(generateTemplateMessage(jobTitle));
          }
        });
      }
    );
    req.on('error', () => resolve(generateTemplateMessage(jobTitle)));
    req.write(body);
    req.end();
  });
}

function generateTemplateMessage(jobTitle) {
  return `はじめまして。AIライティングの案件「${jobTitle}」に応募させていただきます。
ChatGPTやClaudeなどの生成AIを活用したコンテンツ制作の経験があり、SEOを意識した読みやすい記事作成が得意です。
ご要望に沿った高品質な成果物をお届けできるよう尽力いたします。ぜひご検討いただければ幸いです。`;
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
      const description = document.querySelector('body')?.textContent?.trim().slice(0, 500) ?? '';
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
    const applyMessage = await generateApplyMessage(detail.title, detail.description);
    console.log(`[Apply] Generated message: ${applyMessage.slice(0, 50)}...`);

    // 応募ページへ直接移動
    const applyUrl = `https://crowdworks.jp/proposals/new?job_offer_id=${jobId}`;
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await new Promise(r => setTimeout(r, 3000));
    console.log(`[Apply] Now on page: ${page.url()}`);

    // テキストエリアに入力
    await page.waitForSelector('textarea', { timeout: 15_000 });
    await page.click('textarea');
    await page.keyboard.type(applyMessage, { delay: 30 });
    console.log(`[Apply] Message filled. Submitting...`);

    const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
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
