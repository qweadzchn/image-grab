/**
 * 一次性脚本：用本机 Edge 已登录的 GitHub 会话，在仓库 Settings → Pages 里
 * 把发布源设置为「Deploy from a branch → main → /docs」。
 * 只读取页面结构、点击对应控件，不修改任何账号信息。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(
  'C:/Users/QWE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'
);
const { chromium } = require('playwright');

const PROFILE = 'E:\\其他\\企业实训\\image-grab\\tmp\\edge-session';
const OUT = 'E:\\其他\\企业实训\\image-grab\\qa';
const URL = 'https://github.com/qweadzchn/image-grab/settings/pages';

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  viewport: { width: 1440, height: 1000 },
  args: ['--no-first-run', '--disable-features=Translate'],
});

const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

console.log('URL:', page.url());
console.log('TITLE:', await page.title());

const info = await page.evaluate(() => {
  const describes = [];
  document.querySelectorAll('select, input, button, a[role="menuitem"]').forEach((el) => {
    const label = (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || '').trim().slice(0, 60);
    if (!label && el.tagName !== 'SELECT') return;
    describes.push({
      tag: el.tagName,
      id: el.id || null,
      name: el.getAttribute('name') || null,
      type: el.getAttribute('type') || null,
      label,
      value: el.value || null,
      options: el.tagName === 'SELECT' ? Array.from(el.options).map((o) => `${o.value}|${o.text.trim()}`) : null,
    });
  });
  return { describes, bodyText: document.body.innerText.slice(0, 800) };
});

console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: path.join(OUT, 'pages-settings-before.png'), fullPage: true });

fs.writeFileSync(path.join(OUT, 'pages-settings.json'), JSON.stringify(info, null, 2));

await page.waitForTimeout(500);
await ctx.close();
