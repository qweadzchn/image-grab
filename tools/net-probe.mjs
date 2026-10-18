import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('C:/Users/QWE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const ROOT = 'E:\\其他\\企业实训\\image-grab';
const CHROME = 'E:/其他/企业实训/tmp/chrome136/chrome-win64/chrome.exe';

async function attempt(label, extraArgs) {
  const ctx = await chromium.launchPersistentContext(path.join(ROOT, 'tmp', 'net-' + label), {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: ['--no-first-run', '--hide-scrollbars', ...extraArgs],
  });
  const page = await ctx.newPage();
  const t = Date.now();
  try {
    const res = await page.goto('https://github.com/qweadzchn/image-grab', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(label, 'status', res?.status(), 'in', Date.now() - t, 'ms', 'title:', await page.title());
  } catch (e) {
    console.log(label, 'ERR', String(e).slice(0, 160), 'after', Date.now() - t, 'ms');
  }
  await ctx.close();
}

await attempt('direct', ['--no-proxy-server']);
await attempt('system', []);
await attempt('doh', ['--no-proxy-server', '--enable-features=DnsOverHttps', '--dns-over-https-mode=secure', '--dns-over-https-servers=https://1.1.1.1/dns-query']);
