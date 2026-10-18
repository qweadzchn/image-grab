import { createRequire } from 'node:module';
const require = createRequire('C:/Users/QWE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const PROFILE = 'E:\\其他\\企业实训\\image-grab\\tmp\\edge-session';
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: ['--no-first-run'],
});
const page = await ctx.newPage();
await page.goto('https://github.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
const state = await page.evaluate(() => ({
  title: document.title,
  userLogin: document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null,
  hasSignIn: Array.from(document.querySelectorAll('a')).some((a) => /sign in|登录/i.test(a.textContent || '')),
  cookiesEnabled: navigator.cookieEnabled,
}));
console.log(JSON.stringify(state));
console.log('cookies:', (await ctx.cookies('https://github.com')).map((c) => c.name).join(','));
console.log('localState:', (await ctx.cookies('https://github.com')).length > 0 ? 'session cookies present' : 'none');
await ctx.close();
