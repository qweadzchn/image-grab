/**
 * 图提取 ImageGrab —— 真实浏览器端到端验收（加载未打包扩展）
 *
 * 用 Chrome for Testing 136（最后一个仍支持 --load-extension 的版本）启动真实浏览器，
 * 加载本目录下的未打包扩展，通过 hosts 映射把 item.taobao.com 指向本地演示详情页，
 * 完整跑一遍：注入按钮 → 扫描图片 → 打开画廊 → 全选 → 下载 PNG → 落盘校验，
 * 同时输出截图到 qa/。
 *
 * 运行：node tools/qa-chrome.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  'C:/Users/QWE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'
);
const { chromium } = require('playwright');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = process.env.CHROME_PATH || 'E:/其他/企业实训/tmp/chrome136/chrome-win64/chrome.exe';
const QA = path.join(ROOT, 'qa');
const PROFILE = path.join(ROOT, 'tmp', 'pw-chrome-profile');
const DOWNLOADS = path.join(QA, 'downloads');
const PORT = Number(process.env.PORT || 4180);

for (const dir of [QA, DOWNLOADS]) fs.mkdirSync(dir, { recursive: true });
fs.rmSync(DOWNLOADS, { recursive: true, force: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });

// 预置下载目录偏好（避免污染系统默认下载文件夹）
const prefDir = path.join(PROFILE, 'Default');
fs.mkdirSync(prefDir, { recursive: true });
fs.writeFileSync(
  path.join(prefDir, 'Preferences'),
  JSON.stringify({ download: { default_directory: DOWNLOADS, prompt_for_download: false }, savefile: { default_directory: DOWNLOADS } })
);

const report = { steps: [], errors: [] };
const log = (name, data = {}) => {
  report.steps.push({ name, ...data });
  console.log(`[qa] ${name}`, JSON.stringify(data));
};

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
  acceptDownloads: true,
  downloadsPath: DOWNLOADS,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    '--host-resolver-rules=MAP item.taobao.com 127.0.0.1,EXCLUDE localhost',
    '--no-proxy-server',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
  ],
});

try {
  log('browser-version', { version: context.browser()?.version?.() });

  // 关掉 Playwright 对下载的接管，让 chrome.downloads 真正写盘到 qa/downloads
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOADS,
      eventsEnabled: true,
    });
    log('download-behavior', { ok: true, dir: DOWNLOADS });
  } catch (error) {
    log('download-behavior', { ok: false, error: String(error).slice(0, 160) });
  }

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(msg.text().slice(0, 200)));
  page.on('pageerror', (err) => consoleErrors.push(String(err).slice(0, 200)));

  await page.goto(`http://item.taobao.com:${PORT}/item.htm?id=712345678901`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const button = page.locator('#image-grab-btn');
  await button.waitFor({ state: 'visible', timeout: 20000 });
  log('button-injected', { text: (await button.innerText()).replace(/\s+/g, ' ').trim() });

  await page.screenshot({ path: path.join(QA, '03-plugin-button.png') });

  const before = context.pages().length;
  await button.click();

  let gallery = null;
  if (context.pages().length > before) gallery = context.pages()[context.pages().length - 1];
  else gallery = await context.waitForEvent('page', { timeout: 25000 });

  await gallery.waitForLoadState('domcontentloaded');
  await gallery.waitForSelector('.card', { timeout: 25000 });
  await gallery.waitForTimeout(1600);

  // chrome.downloads 触发的下载会被 Playwright 接管，需要显式保存下来做校验
  gallery.on('download', async (download) => {
    const name = download.suggestedFilename();
    try {
      await download.saveAs(path.join(DOWNLOADS, name));
    } catch (error) {
      console.warn('[qa] 保存下载失败', name, String(error).slice(0, 120));
    }
  });

  const cardCount = await gallery.locator('.card').count();
  log('gallery-loaded', { cardCount, meta: (await gallery.locator('#page-meta').innerText()).trim() });

  // 等所有缩略图真正解码完成，避免截图出现空白卡片
  await gallery
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 30000 })
    .catch(() => log('thumbnail-wait', { timeout: true }));
  await gallery.waitForTimeout(500);

  await gallery.screenshot({ path: path.join(QA, '03-plugin-gallery.png') });

  // 手机视口截图放在下载之前，保证卡片是「待下载」状态
  const desktopViewport = gallery.viewportSize();
  await gallery.setViewportSize({ width: 390, height: 844 });
  await gallery.waitForTimeout(700);
  await gallery.screenshot({ path: path.join(QA, '03-plugin-gallery-mobile.png') });
  await gallery.setViewportSize(desktopViewport);
  await gallery.waitForTimeout(400);

  await gallery.locator('#btn-select-all').click();
  log('select-all', { text: (await gallery.locator('#selected-count').innerText()).trim() });

  await gallery.locator('#btn-download').click();
  await gallery.waitForFunction(
    () => /完成|失败|连接中断/.test(document.getElementById('progress-text')?.textContent || ''),
    null,
    { timeout: 120000 }
  );
  log('download-finished', { text: (await gallery.locator('#progress-text').innerText()).trim() });

  // 等下载真正落盘
  let files = [];
  for (let i = 0; i < 40; i += 1) {
    files = fs.readdirSync(DOWNLOADS).filter((f) => f.toLowerCase().endsWith('.png'));
    if (files.length >= cardCount) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  log('downloaded', {
    count: files.length,
    sample: files.slice(0, 4).map((f) => ({ name: f, kb: Math.round(fs.statSync(path.join(DOWNLOADS, f)).size / 1024) })),
  });

  const firstPng = files[0] ? fs.readFileSync(path.join(DOWNLOADS, files[0])) : null;
  log('png-signature-ok', { ok: Boolean(firstPng && firstPng[0] === 0x89 && firstPng.toString('ascii', 1, 4) === 'PNG') });

  await gallery.waitForTimeout(600);
  await gallery.screenshot({ path: path.join(QA, '03-plugin-gallery-done.png') });

  log('console-errors', { consoleErrors });

  // 官网本地预览截图
  const site = await context.newPage();
  await site.goto(`http://127.0.0.1:${PORT}/docs/`, { waitUntil: 'load' });
  await site.waitForTimeout(1000);
  await site.evaluate(async () => {
    const step = window.innerHeight * 0.75;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
    // 整页截图前强制显示所有淡入元素，避免出现空白区块
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
    await new Promise((r) => setTimeout(r, 400));
  });
  await site.waitForTimeout(700);
  await site.screenshot({ path: path.join(QA, '06-site-desktop.png'), fullPage: true });
  log('site-desktop', { overflow: await site.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });

  await site.setViewportSize({ width: 390, height: 844 });
  await site.waitForTimeout(700);
  await site.evaluate(async () => {
    const step = window.innerHeight * 0.75;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await site.waitForTimeout(700);
  await site.screenshot({ path: path.join(QA, '06-site-mobile.png'), fullPage: true });
  log('site-mobile', { overflow: await site.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });

  await site.setViewportSize({ width: 320, height: 720 });
  await site.waitForTimeout(500);
  log('site-320', { overflow: await site.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });
} catch (error) {
  report.errors.push(String(error).slice(0, 800));
  console.error('[qa] 失败：', String(error).slice(0, 800));
} finally {
  await context.close();
  fs.writeFileSync(path.join(QA, 'qa-report.json'), JSON.stringify(report, null, 2));
  console.log('[qa] 完成，报告：qa/qa-report.json');
}
