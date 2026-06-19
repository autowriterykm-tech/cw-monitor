'use strict';

const fs = require('fs');
const https = require('https');
const { getLoggedInPage, newPage } = require('./browser');
const { notifyLine } = require('./line');

const NOTIFIED_IDS_FILE = '/tmp/notified_ids.json';

function loadNotifiedIds() {
  try {
    if (fs.existsSync(NOTIFIED_IDS_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(NOTIFIED_IDS_FILE, 'utf8')));
    }
  } catch (_) {}
  return new Set();
}

function saveNotifiedIds(ids) {
  try {
    fs.writeFileSync(NOTIFIED_IDS_FILE, JSON.stringify([...ids]));
  } catch (_) {}
}

const notifiedIds = loadNotifiedIds();

const SEARCH_CONFIGS = [
  {
    label: 'AI案件',
    url: 'https://crowdworks.jp/public/jobs/search?order=new&category_id=228&search%5Bkeywords%5D=AI',
  },
  {
    label: 'ChatGPT案件',
    url: 'https://crowdworks.jp/public/jobs/search?order=new&category_id=228&search%5Bkeywords%5D=ChatGPT',
  },
];

const INTERVAL_MS = 15 * 60 * 1000;

async function evaluateJob(jobTitle, jobDetail) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: true, reason: 'API未設定のため通知' };

  // ▼ 追加：詳細テキストから応募状況を拾って倍率を計算
  const appliedM = jobDetail.match(/応募した人\s*(\d+)\s*人/);
  const recruitM = jobDetail.match(/募集人数\s*(\d+)\s*人/);
  const applied = appliedM ? Number(appliedM[1]) : null;
  const recruit = recruitM ? Number(recruitM[1]) : null;
  const ratio = applied && recruit ? Math.round(applied / recruit) : null;
  const ratioLine =
    ratio !== null
      ? `応募${applied}人 / 募集${recruit}人 = 約${ratio}倍`
      : '不明（ページから取得できず）';

  const prompt = `
以下のCrowdWorksの案件を評価してください。

【案件タイトル】
${jobTitle}

【応募倍率】
${ratioLine}

【案件詳細】
${jobDetail.slice(0, 3500)}

おすすめ条件（全部満たす場合のみok:true）：
- テキスト・Googleドキュメント納品のみ
- AI使用OK・未経験OK・初心者OK
- 年齢・性別制限なし
- クライアントの評価・発注実績がある
- 単価が文字1円以上または記事1000円以上
- 「AI使用可」「ChatGPT可」など明示的にAI使用が認められている
- 継続依頼あり・長期案件

NG条件（一つでも該当したらok:false）：
- 応募倍率が高すぎる（応募者数 ÷ 募集人数 が約50倍以上）。競争が激しすぎて契約される見込みが薄い
- WordPress入稿が必要
- 画像・動画編集が必要
- 年齢制限・性別限定がある（女性限定・男性限定・20代限定なども含む）
- クライアントの評価ゼロ・本人確認未提出
- 体験談・実体験・エピソード・経験談が必須（「あなたの経験」「実際に経験した」「学生時代」「リアルな」などの表現がある）
- 医療・法律・資格など専門知識必須
- SNS・脚本・シナリオ・動画台本作成
- インタビュー・取材が必要
- 占い・鑑定

回答形式（JSONのみ）:
{"ok": true または false, "reason": "理由を一言で"}
`.trim();

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
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
            resolve(parsed);
          } catch {
            resolve({ ok: false, reason: '判断エラーのためスキップ' });
          }
        });
      }
    );
    req.on('error', () => resolve({ ok: true, reason: 'API接続エラーのため通知' }));
    req.write(body);
    req.end();
  });
}

async function getJobDetail(jobUrl) {
  const page = await newPage();
  try {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // 詳細の動的描画を待つため少し長めに待機
    await new Promise(r => setTimeout(r, 3000));

    const detail = await page.evaluate(() => {
      // ① 案件本文が入っていそうなメインコンテナを優先的に探す
      const candidates = [
        '.job_offer_detail',
        '#job_offer_detail',
        '.cw-jobOfferDetail',
        '[class*="jobOffer"]',
        '[class*="job_offer"]',
        'main',
        '#main',
        '#content',
      ];

      let best = '';
      for (const sel of candidates) {
        document.querySelectorAll(sel).forEach(el => {
          // 改行・連続空白を1スペースに圧縮（スカスカ対策）
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length > best.length) best = t;
        });
      }

      // ② メインが取れなければ body 全体にフォールバック
      if (best.length < 200) {
        best = (document.body?.textContent || '').replace(/\s+/g, ' ').trim();
      }

      // ③ 取得量を 1500 → 5000 に拡大（報酬・本文・応募状況まで含める）
      return best.slice(0, 5000);
    });

    return detail;
  } catch (_) {
    return '';
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeJobs(url) {
  const page = await newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await new Promise(r => setTimeout(r, 3000));

    if (page.url().includes('/login')) {
      console.warn('[Scraper] Redirected to login. Re-authenticating...');
      await page.close();
      await getLoggedInPage();
      return scrapeJobs(url);
    }

    const jobs = await page.evaluate(() => {
      const items = [];
      const links = document.querySelectorAll('a[href*="/public/jobs/"]');

      links.forEach(link => {
        const href = link.getAttribute('href');
        const idMatch = href.match(/\/jobs\/(\d+)/);
        if (!idMatch) return;

        const title = link.textContent.trim();
        if (!title || title.length < 5) return;

        if (items.find(i => i.id === idMatch[1])) return;

        items.push({
          id: idMatch[1],
          title: title.slice(0, 100),
          url: `https://crowdworks.jp${href}`,
        });
      });

      return items.slice(0, 20);
    });

    console.log(`[Scraper] Found ${jobs.length} jobs at ${url}`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
  }
}

async function checkNewJobs() {
  console.log('[Monitor] Checking for new jobs...');
  await getLoggedInPage();

  const allJobs = new Map();

  for (const config of SEARCH_CONFIGS) {
    let jobs;
    try {
      jobs = await scrapeJobs(config.url);
    } catch (err) {
      console.error(`[Monitor] Scrape error for ${config.label}:`, err.message);
      continue;
    }

    for (const job of jobs) {
      if (!allJobs.has(job.id)) {
        allJobs.set(job.id, { ...job, label: config.label });
      }
    }
  }

  for (const [id, job] of allJobs) {
    if (notifiedIds.has(id)) continue;
    notifiedIds.add(id);
    saveNotifiedIds(notifiedIds);

    console.log(`[Monitor] Evaluating job ${id}: ${job.title}`);
    const detail = await getJobDetail(job.url);
    // ▼ 詳細がほぼ取れなかった場合はログに残す（セレクタ調整の手がかり）
    if (!detail || detail.length < 200) {
      console.warn(`[Monitor] Detail too short for job ${id} (len=${detail.length}). Check selectors.`);
    }
    const evaluation = await evaluateJob(job.title, detail);

    console.log(`[Monitor] Evaluation: ${JSON.stringify(evaluation)}`);

    if (!evaluation.ok) {
      console.log(`[Monitor] Skipped job ${id}: ${evaluation.reason}`);
      continue;
    }

    const message = [
      `⭐【おすすめ ${job.label}】`,
      `📌 ${job.title}`,
      `🔗 ${job.url}`,
      `✅ ${evaluation.reason}`,
      '',
      '応募する場合は「OK 案件ID」と返信してください。',
      `（案件ID: ${id}）`,
    ].join('\n');

    try {
      await notifyLine(message);
      console.log(`[Monitor] Notified job ${id}: ${job.title}`);
    } catch (err) {
      console.error(`[Monitor] notify error for job ${id}:`, err.message);
    }

    await sleep(1000);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startMonitor() {
  console.log('[Monitor] Starting monitor loop...');

  try {
    await getLoggedInPage();
    console.log('[Monitor] Initial login verified.');
  } catch (err) {
    console.error('[Monitor] Initial login failed:', err.message);
    throw err;
  }

  await checkNewJobs().catch(err =>
    console.error('[Monitor] First check error:', err.message)
  );

  setInterval(() => {
    checkNewJobs().catch(err =>
      console.error('[Monitor] Interval check error:', err.message)
    );
  }, INTERVAL_MS);
}

module.exports = { startMonitor, checkNewJobs };
