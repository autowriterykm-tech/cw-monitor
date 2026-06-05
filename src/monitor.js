'use strict';

const { getLoggedInPage, newPage } = require('./browser');
const { notifyLine } = require('./line');

// 通知済み案件IDを保持（再起動でリセット。永続化したければDBを使う）
const notifiedIds = new Set();

// 監視対象クエリ設定
const SEARCH_CONFIGS = [
  {
    label: 'AI案件',
    url: 'https://crowdworks.jp/public/jobs/search?order=new&category_id=2&keyword=AI',
  },
  {
    label: 'ChatGPT案件',
    url: 'https://crowdworks.jp/public/jobs/search?order=new&category_id=2&keyword=ChatGPT',
  },
];

const INTERVAL_MS = 15 * 60 * 1000; // 15分ごと

/**
 * 検索結果ページから案件リストをスクレイピング
 */
async function scrapeJobs(url) {
  // ログイン済みセッションを持つページで検索URLに移動
  // （新規ページを開くとクッキーが引き継がれる）
  const page = await newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });

    // ログインしていない場合はリダイレクトされる
    if (page.url().includes('/login')) {
      console.warn('[Scraper] Redirected to login. Re-authenticating...');
      await page.close();
      // セッションをリセットして再ログイン
      const { _loginPage } = require('./browser');
      // getLoggedInPage() 内でリセット処理済みのため再呼び出しするだけ
      await getLoggedInPage();
      return scrapeJobs(url); // 1回だけリトライ
    }

    // 案件リストを取得
    const jobs = await page.evaluate(() => {
      const items = [];
      // CrowdWorksの案件カード（クラス名は変更される可能性あり）
      const cards = document.querySelectorAll(
        '.job_offer__item, .offers_list_item, [class*="job_offer"]'
      );

      cards.forEach(card => {
        const linkEl = card.querySelector('a[href*="/public/jobs/"]');
        const titleEl = card.querySelector(
          '.job_offer__title, .offer_title, [class*="offer_title"], h3, h4'
        );
        const priceEl = card.querySelector(
          '.job_offer__price, .price, [class*="price"]'
        );
        const clientEl = card.querySelector(
          '.client_info, [class*="client"]'
        );

        if (!linkEl || !titleEl) return;

        const href = linkEl.getAttribute('href');
        const idMatch = href.match(/\/jobs\/(\d+)/);
        if (!idMatch) return;

        items.push({
          id: idMatch[1],
          title: titleEl.textContent.trim(),
          url: `https://crowdworks.jp${href}`,
          price: priceEl ? priceEl.textContent.trim() : '価格不明',
          client: clientEl ? clientEl.textContent.trim() : '',
        });
      });

      return items;
    });

    console.log(`[Scraper] Found ${jobs.length} jobs at ${url}`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 新着チェックを実行し、未通知のものをLINE通知
 */
async function checkNewJobs() {
  console.log('[Monitor] Checking for new jobs...');

  // まずログインセッションを確立
  await getLoggedInPage();

  for (const config of SEARCH_CONFIGS) {
    let jobs;
    try {
      jobs = await scrapeJobs(config.url);
    } catch (err) {
      console.error(`[Monitor] Scrape error for ${config.label}:`, err.message);
      continue;
    }

    for (const job of jobs) {
      if (notifiedIds.has(job.id)) continue;

      notifiedIds.add(job.id);

      const message = [
        `【新着 ${config.label}】`,
        `📌 ${job.title}`,
        `💰 ${job.price}`,
        `🔗 ${job.url}`,
        '',
        '応募する場合は「OK」と返信してください。',
        `（案件ID: ${job.id}）`,
      ].join('\n');

      try {
        await notifyLine(message, job.id);
        console.log(`[Monitor] Notified job ${job.id}: ${job.title}`);
      } catch (err) {
        console.error(`[Monitor] LINE notify error for job ${job.id}:`, err.message);
      }

      // レート制限対策
      await sleep(1000);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 監視ループ開始
 */
async function startMonitor() {
  console.log('[Monitor] Starting monitor loop...');

  // 初回ログインを確認してから開始
  try {
    await getLoggedInPage();
    console.log('[Monitor] Initial login verified.');
  } catch (err) {
    console.error('[Monitor] Initial login failed:', err.message);
    throw err; // index.js でキャッチしてプロセス終了
  }

  // 初回チェック
  await checkNewJobs().catch(err =>
    console.error('[Monitor] First check error:', err.message)
  );

  // 定期チェック
  setInterval(() => {
    checkNewJobs().catch(err =>
      console.error('[Monitor] Interval check error:', err.message)
    );
  }, INTERVAL_MS);
}

module.exports = { startMonitor, checkNewJobs };
