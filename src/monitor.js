'use strict';

const fs = require('fs');
const path = require('path');
const { getLoggedInPage, newPage } = require('./browser');
const { notifyLine } = require('./line');

// 通知済みIDをファイルで永続化
const NOTIFIED_IDS_FILE = '/tmp/notified_ids.json';

function loadNotifiedIds() {
  try {
    if (fs.existsSync(NOTIFIED_IDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(NOTIFIED_IDS_FILE, 'utf8'));
      return new Set(data);
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

  // 全検索結果をまとめて重複除去
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

  // 未通知のもののみ通知
  for (const [id, job] of allJobs) {
    if (notifiedIds.has(id)) continue;
    notifiedIds.add(id);
    saveNotifiedIds(notifiedIds);

    const message = [
      `【新着 ${job.label}】`,
      `📌 ${job.title}`,
      `🔗 ${job.url}`,
      '',
      '応募する場合は「OK 案件ID」と返信してください。',
      `（案件ID: ${id}）`,
    ].join('\n');

    try {
      await notifyLine(message);
      console.log(`[Monitor] Notified job ${id}: ${job.title}`);
    } catch (err) {
      console.error(`[Monitor] LINE notify error for job ${id}:`, err.message);
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
