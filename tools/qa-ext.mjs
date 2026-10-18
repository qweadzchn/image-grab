/**
 * 图提取 ImageGrab —— 真实浏览器验收脚本
 * 用 Playwright 启动 Edge（新无头模式，支持扩展），加载未打包的扩展，
 * 通过 hosts 映射把 item.taobao.com 指向本地服务，模拟真实详情页点击「获取图片」，
 * 走完 提取 → 画廊 → 批量下载 全流程，并输出截图。
 *
 * 运行：node tools/qa-ext.mjs
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
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const QA = path.join(ROOT, 'qa');
const PROFILE = path.join(ROOT, 'tmp', 'pw-profile');
const DOWNLOADS = path.join(QA, 'downloads');
const PORT = Number(process.env.PORT || 4180);

for (const dir of [QA, DOWNLOADS]) fs.mkdirSync(dir, { recursive: true });

// 预置下载目录偏好，避免污染系统默认下载文件夹
const prefDir = path.join(PROFILE, 'Default');
fs.mkdirSync(prefDir, { recursive: true });
const prefFile = path.join(prefDir, 'Preferences');
if (!fs.existsSync(prefFile)) {
  fs.writeFileSync(
    prefFile,
    JSON.stringify(
      {
        download: { default_directory: DOWNLOADS, prompt_for_download: false, directory_upgrade: true },
        savefile: { default_directory: DOWNLOADS },
        profile: { exit_type: 'Normal', exited_cleanly: true },
        credentials_enable_service: false,
        plugins: { always_open_pdf_externally: false },
      },
      null,
      2
    )
  );
}

const report = { steps: [], errors: [] };
const log = (name, data) => {
  report.steps.push({ name, ...data });
  console.log(`[qa] ${name}`, JSON.stringify(data));
};

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: EDGE,
  headless: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
  acceptDownloads: true,
  args: [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    '--host-resolver-rules=MAP item.taobao.com 127.0.0.1,EXCLUDE localhost',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,msEdgeSidebarV2',
  ],
});

try {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(`http://item.taobao.com:${PORT}/item.htm?id=712345678901`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const button = page.locator('#image-grab-btn');
  await button.waitFor({ state: 'visible', timeout: 15000 });
  log('button-visible', { text: (await button.innerText()).replace(/\s+/g, ' ').trim() });

  await page.screenshot({ path: path.join(QA, '03-plugin-button.png') });

  const beforePages = context.pages().length;
  await button.click();

  // 等画廊页打开
  let gallery = null;
  if (context.pages().length > beforePages) {
    gallery = context.pages()[context.pages().length - 1];
  } else {
    gallery = await context.waitForEvent('page', { timeout: 20000 });
  }
  await gallery.waitForLoadState('domcontentloaded');
  await gallery.waitForSelector('.card', { timeout: 20000 });
  await gallery.waitForTimeout(1500);

  const cardCount = await gallery.locator('.card').count();
  const metaText = (await gallery.locator('#page-meta').innerText()).trim();
  log('gallery-loaded', { cardCount, metaText });

  await gallery.screenshot({ path: path.join(QA, '03-plugin-gallery.png') });

  // 全选 → 下载选中，验证 PNG 转换与 chrome.downloads 落盘
  await gallery.locator('#btn-select-all').click();
  const selected = (await gallery.locator('#selected-count').innerText()).trim();
  log('selected', { selected });

  await gallery.locator('#btn-download').click();
  await gallery.waitForFunction(
    () => /完成|失败|连接中断/.test(document.getElementById('progress-text')?.textContent || ''),
    null,
    { timeout: 90000 }
  );
  const progressText = (await gallery.locator('#progress-text').innerText()).trim();
  log('download-finished', { progressText });

  await gallery.waitForTimeout(800);
  const files = fs
    .readdirSync(DOWNLOADS)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => ({ name: f, size: fs.statSync(path.join(DOWNLOADS, f)).size }));
  log('downloaded-files', { count: files.length, files: files.slice(0, 6) });

  // 画廊手机视口截图
  await gallery.setViewportSize({ width: 390, height: 844 });
  await gallery.waitForTimeout(600);
  await gallery.screenshot({ path: path.join(QA, '03-plugin-gallery-mobile.png') });

  log('page-console-errors', { consoleErrors });

  // 官网本地预览截图（桌面 + 手机）
  const site = await context.newPage();
  await site.goto(`http://127.0.0.1:${PORT}/docs/`, { waitUntil: 'load' });
  await site.waitForTimeout(1200);
  // 触发所有 reveal 元素进入视口，避免整页截图出现空白区
  await site.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
  });
  await site.waitForTimeout(900);
  await site.screenshot({ path: path.join(QA, '06-site-desktop.png'), fullPage: true });

  const overflowDesktop = await site.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log('site-desktop', { overflow: overflowDesktop });

  await site.setViewportSize({ width: 390, height: 844 });
  await site.waitForTimeout(600);
  await site.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await site.waitForTimeout(600);
  await site.screenshot({ path: path.join(QA, '06-site-mobile.png'), fullPage: true });
  log('site-mobile', { overflow: await site.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });

  // 320px 极窄屏检查
  await site.setViewportSize({ width: 320, height: 720 });
  await site.waitForTimeout(500);
  log('site-320', { overflow: await site.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });
} catch (error) {
  report.errors.push(String(error));
  console.error('[qa] 失败：', error);
} finally {
  await context.close();
  fs.writeFileSync(path.join(QA, 'qa-report.json'), JSON.stringify(report, null, 2));
  console.log('[qa] 报告已写入 qa/qa-report.json');
}
