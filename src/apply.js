'use strict';

const { newPage, getLoggedInPage } = require('./browser');

/**
 * Claude API で応募メッセージを自動生成
 */
async function generateApplyMessage(jobTitle, jobDescription) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // フォールバック：テンプレートメッセージ
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

  return new Promise((resolve, reject) => {
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
            if (text) {
              resolve(text.trim());
            } else {
              resolve(generateTemplateMessage(jobTitle));
            }
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

/**
 * 案件詳細ページから情報を取得
 */
async function getJobDetail(jobUrl) {
  // ログイン済みセッションを保持するブラウザで新規ページを開く
  await getLoggedInPage(); // セッション確認
  const page = await newPage();

  try {
    await page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 60_000 });

    // ログインリダイレクト確認
    if (page.url().includes('/login')) {
      throw new Error('ログインセッションが切れています');
    }

    const detail = await page.evaluate(() => {
      const title = document.querySelector('h1, .job_offer_detail__title, [class*="job_title"]')
        ?.textContent?.trim() ?? 'タイトル不明';
      const description = document.querySelector(
        '.job_offer_detail__body, .description, [class*="job_description"], .offer_body'
      )?.textContent?.trim() ?? '';

      // 応募フォームのセレクタを探す
      const applyBtn = document.querySelector(
        'a[href*="/entry"], button[class*="apply"], .apply_button, [class*="entry_btn"]'
      );
      const applyHref = applyBtn?.getAttribute('href') ?? null;

      return { title, description, applyHref };
    });

    return { ...detail, page };
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
}

/**
 * 案件への自動応募
 */
async function applyToJob(jobId) {
  const jobUrl = `https://crowdworks.jp/public/jobs/${jobId}`;
  console.log(`[Apply] Starting application for job ${jobId}...`);

  let page;
  try {
    // 案件詳細取得
    const detail = await getJobDetail(jobUrl);
    page = detail.page;

    // AIで応募メッセージ生成
    console.log(`[Apply] Generating message for: ${detail.title}`);
    const applyMessage = await generateApplyMessage(detail.title, detail.description);
    console.log(`[Apply] Generated message: ${applyMessage.slice(0, 50)}...`);

    // 応募ページへ遷移
    let applyUrl;
    if (detail.applyHref) {
      applyUrl = detail.applyHref.startsWith('http')
        ? detail.applyHref
        : `https://crowdworks.jp${detail.applyHref}`;
    } else {
      // 直接応募ボタンをクリック
      const applyBtn = await page.$(
        'a[href*="/entry"], .apply_button, [class*="apply_btn"], [class*="entry"]'
      );
      if (!applyBtn) {
        throw new Error('応募ボタンが見つかりませんでした（すでに応募済みか、案件が終了している可能性）');
      }
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }),
        applyBtn.click(),
      ]);
      applyUrl = page.url();
    }

    if (applyUrl && applyUrl !== page.url()) {
      await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    }

    // メッセージフォームを探して入力
    await page.waitForSelector(
      'textarea[name*="message"], textarea[name*="body"], textarea[class*="message"], textarea',
      { timeout: 15_000 }
    );

    // 最初に見つかった textarea に入力
    await page.evaluate(
      (msg) => {
        const ta = document.querySelector(
          'textarea[name*="message"], textarea[name*="body"], textarea[class*="message"], textarea'
        );
        if (ta) {
          ta.value = msg;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      applyMessage
    );

    // --- ここが重要：実際に送信する前にログで確認 ---
    console.log(`[Apply] Message filled. Submitting...`);

    // 送信ボタンをクリック
    const submitBtn = await page.$(
      'input[type="submit"][value*="応募"], button[type="submit"], input[type="submit"]'
    );
    if (!submitBtn) {
      throw new Error('送信ボタンが見つかりませんでした');
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }),
      submitBtn.click(),
    ]);

    // 成功確認
    const afterUrl = page.url();
    const isSuccess = !afterUrl.includes('/entry') || afterUrl.includes('/thanks');
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
