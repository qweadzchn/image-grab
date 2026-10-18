/**
 * 图提取 ImageGrab —— GitHub 仓库页与 GitHub Pages 线上截图
 *
 * 用法：node tools/github-shots.mjs
 * 输出：qa/04-github-repo.png、qa/06-github-pages.png（桌面）、qa/06-github-pages-mobile.png
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
const QA = path.join(ROOT, 'qa');
const CHROME = process.env.CHROME_PATH || 'E:/其他/企业实训/tmp/chrome136/chrome-win64/chrome.exe';
const REPO_URL = process.env.REPO_URL || 'https://github.com/qweadzchn/image-grab';
const PAGES_URL = process.env.PAGES_URL || 'https://qweadzchn.github.io/image-grab/';

fs.mkdirSync(QA, { recursive: true });

const context = await chromium.launchPersistentContext(path.join(ROOT, 'tmp', 'shots-profile'), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 1.5,
  args: ['--no-first-run', '--disable-features=Translate', '--hide-scrollbars'],
});

try {
  // 1. GitHub 仓库页（README、文件列表、About 等）
  const repo = await context.newPage();
  await repo.goto(REPO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await repo.waitForTimeout(4500);
  await repo.screenshot({ path: path.join(QA, '04-github-repo.png') });
  console.log('[shots] repo:', await repo.title());

  // 2. GitHub Pages 线上官网
  const pages = await context.newPage();
  const response = await pages.goto(PAGES_URL, { waitUntil: 'networkidle', timeout: 90000 });
  console.log('[shots] pages status:', response?.status());
  await pages.waitForTimeout(2000);
  await pages.evaluate(async () => {
    const step = window.innerHeight * 0.75;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
    await new Promise((r) => setTimeout(r, 400));
  });
  await pages.waitForTimeout(800);
  await pages.screenshot({ path: path.join(QA, '06-github-pages.png') });
  await pages.screenshot({ path: path.join(QA, '06-github-pages-full.png'), fullPage: true });

  await pages.setViewportSize({ width: 390, height: 844 });
  await pages.waitForTimeout(700);
  await pages.screenshot({ path: path.join(QA, '06-github-pages-mobile.png') });
  console.log('[shots] pages title:', await pages.title());
} catch (error) {
  console.error('[shots] 失败：', String(error).slice(0, 400));
} finally {
  await context.close();
}
