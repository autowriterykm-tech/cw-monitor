'use strict';
const puppeteer = require('puppeteer');
let _browser = null;
let _loginPage = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  console.log('[Browser] Launching Puppeteer...');
  _browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
  args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--crash-dumps-dir=/tmp',
      '--user-data-dir=/tmp/chrome-data',
    ],
  });
  _browser.on('disconnected', () => {
    console.warn('[Browser] Browser disconnected.');
    _browser = null;
    _loginPage = null;
  });
  return _browser;
}
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
async function getLoggedInPage() {
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
  const email = process.env.CW_EMAIL;
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
 console.log('[Auth] Page URL after navigation:', page.url());
  console.log('[Auth] Page title:', await page.title());
// ページのHTMLを確認
  const html = await page.content();
  console.log('[Auth] Form HTML:', html.substring(0, 2000));
  await page.waitForSelector('input[type="email"], input[name="session[email]"], input[id="email"]', { timeout: 15_000 });
  const emailInput = await page.$('input[type="email"], input[name="session[email]"], input[id="email"]');
  const passwordInput = await page.$('input[type="password"]');
  await emailInput.type(email, { delay: 50 });
  await passwordInput.type(password, { delay: 50 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60_000 }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    throw new Error(`ログイン失敗 (URL: ${currentUrl})`);
  }
  console.log('[Auth] Login successful.');
  _loginPage = page;
  return _loginPage;
}
module.exports = { getBrowser, newPage, getLoggedInPage };
