'use strict';

const { getLoggedInPage, newPage } = require('./browser');
const { notifyLine } = require('./line');

const notifiedIds = new Set();

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

const INTERVAL_MS = 15 * 60 * 1000;

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

    // まずページ構造を確認
    const debugInfo = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a[href*="/public/jobs/"]'));
      return {
        jobLinks: allLinks.slice(0, 3).map(a => ({
          href: a.href,
          text: a.textContent.trim().slice(0, 50),
          parentClass: a.parentElement?.className?.slice(0, 100),
        })),
        totalLinks: allLinks.length,
      };
    });
    console.log('[Scraper] Debug:', JSON.stringify(debugInfo));

    const jobs = await page.evaluate(() => {
      const items = [];
      const links = document.querySelectorAll('a[href*="/public/jobs/"]');

      links.forEach(link => {
        const href = link.getAttribute('href');
        const idMatch = href.match(/\/jobs\/(\d+)/);
        if (!idMatch) return;

        const title = link.textContent.trim();
        if (!title || title.length < 5) return;

        // 重複除去
        if (items.find(i => i.id === idMatch[1])) return;

        items.push({
          id: idMatch[1],
          title: title.slice(0, 100),
          url: `https://crowdworks.jp${href}`,
          price: '価格は案件ページで確認',
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
        `🔗 ${job.url}`,
        '',
        '応募する場合は「OK 案件ID」と返信してください。',
        `（案件ID: ${job.id}）`,
      ].join('\n');

      try {
        await notifyLine(message);
        console.log(`[Monitor] Notified job ${job.id}: ${job.title}`);
      } catch (err) {
        console.error(`[Monitor] LINE notify error for job ${job.id}:`, err.message);
      }

      await sleep(1000);
    }
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
