'use strict';

const puppeteer = require('puppeteer');

let _browser = null;
let _loginPage = null; // ログイン済みセッションを保持するページ

/**
 * ブラウザのシングルトンを返す。
 * 死んでいたら再起動する。
 */
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;

  console.log('[Browser] Launching Puppeteer...');
  _browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',          // Renderの低メモリ対策
      '--no-zygote',
    ],
  });

  _browser.on('disconnected', () => {
    console.warn('[Browser] Browser disconnected. Will relaunch on next call.');
    _browser = null;
    _loginPage = null;
  });

  return _browser;
}

/**
 * 新しいページを開いて返す（ブラウザを再利用）。
 */
async function newPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 800 });
  return page;
}

/**
 * CrowdWorksにログインし、セッションを保持したページを返す。
 * すでにログイン済みなら再利用する。
 */
async function getLoggedInPage() {
  // 既存ページの生死確認
  if (_loginPage) {
    try {
      await _loginPage.evaluate(() => document.title);
      console.log('[Auth] Reusing existing session.');
      return _loginPage;
    } catch (_) {
      console.warn('[Auth] Session page was dead. Re-logging in.');
      _loginPage = null;
    }
  }

  const email    = process.env.CW_EMAIL;
  const password = process.env.CW_PASSWORD;
  if (!email || !password) {
    throw new Error('CW_EMAIL / CW_PASSWORD が環境変数に設定されていません');
  }

  const page = await newPage();
  console.log('[Auth] Navigating to login page...');

  await page.goto('https://crowdworks.jp/login', {
    waitUntil: 'networkidle2',
    timeout: 60_000,
  });

  // ログインフォームの入力
  await page.waitForSelector('input[name="session[email]"]', { timeout: 15_000 });
  await page.type('input[name="session[email]"]', email, { delay: 50 });
  await page.type('input[name="session[password]"]', password, { delay: 50 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60_000 }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);

  // ログイン失敗チェック
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    const errorText = await page.$eval(
      '.error_message, .alert, [class*="error"]',
      el => el.textContent.trim()
    ).catch(() => '不明なエラー');
    throw new Error(`ログイン失敗: ${errorText} (URL: ${currentUrl})`);
  }

  console.log('[Auth] Login successful. Session page ready.');
  _loginPage = page;
  return _loginPage;
}

module.exports = { getBrowser, newPage, getLoggedInPage };
