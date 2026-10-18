/**
 * 图提取 ImageGrab —— 原生 CDP 端到端验收（不经过 Playwright，避免下载被拦截）
 *
 * 直接启动 Chrome for Testing（加载未打包扩展），通过 DevTools Protocol：
 *   1. 打开演示商品详情页 → 点击「获取图片」；
 *   2. 等待画廊页打开 → 全选 → 点击「下载选中」；
 *   3. 检查 qa/downloads 下是否真的写出了 12 个 PNG 文件（并按文件头校验 PNG 签名）。
 *
 * 运行：node tools/cdp-e2e.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = process.env.CHROME_PATH || 'E:/其他/企业实训/tmp/chrome136/chrome-win64/chrome.exe';
const PROFILE = path.join(ROOT, 'tmp', 'cdp-profile');
const DOWNLOADS = path.join(ROOT, 'qa', 'downloads');
const PORT = Number(process.env.PORT || 4180);
const DEBUG_PORT = 9333;

fs.rmSync(DOWNLOADS, { recursive: true, force: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${PROFILE}`,
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    '--host-resolver-rules=MAP item.taobao.com 127.0.0.1',
    '--no-proxy-server',
    `--remote-debugging-port=${DEBUG_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

/** 极简 CDP 客户端（Node 22+ 自带 WebSocket） */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let seq = 0;
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

const listTargets = async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();

async function waitForTarget(predicate, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const targets = await listTargets();
      const found = targets.find(predicate);
      if (found) return found;
    } catch {
      /* 调试端口还没起来 */
    }
    await sleep(300);
  }
  throw new Error('等待目标超时');
}

const report = [];
const log = (name, data = {}) => {
  report.push({ name, ...data });
  console.log(`[e2e] ${name}`, JSON.stringify(data));
};

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i += 1) {
    try {
      version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    } catch {
      await sleep(500);
    }
  }
  if (!version) throw new Error('调试端口未启动');
  log('chrome', { browser: version.Browser });

  // 浏览器级会话：把下载目录固定到 qa/downloads
  const browserCdp = cdp(version.webSocketDebuggerUrl);
  await browserCdp.ready;
  await browserCdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOADS,
    eventsEnabled: true,
  });

  // 1. 打开演示详情页并点击扩展按钮
  const pageTarget = await waitForTarget((t) => t.type === 'page');
  const page = cdp(pageTarget.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.navigate', { url: `http://item.taobao.com:${PORT}/item.htm?id=712345678901` });
  await sleep(4000);

  const btnClick = await page.send('Runtime.evaluate', {
    expression: `(() => { const b = document.querySelector('#image-grab-btn'); if (!b) return 'no-button'; b.click(); return 'clicked'; })()`,
    returnByValue: true,
  });
  log('click-extract', { value: btnClick.result.value });
  if (btnClick.result.value !== 'clicked') throw new Error('扩展按钮没有注入');

  // 2. 等画廊页并触发批量下载
  const galleryTarget = await waitForTarget((t) => (t.url || '').includes('gallery.html'), 30000);
  const gallery = cdp(galleryTarget.webSocketDebuggerUrl);
  await gallery.ready;
  await gallery.send('Runtime.enable');
  await sleep(3000);

  const info = await gallery.send('Runtime.evaluate', {
    expression: `(() => ({ cards: document.querySelectorAll('.card').length, meta: document.getElementById('page-meta').textContent }))()`,
    returnByValue: true,
  });
  log('gallery', info.result.value);

  await gallery.send('Runtime.evaluate', { expression: `document.getElementById('btn-select-all').click()` });
  await gallery.send('Runtime.evaluate', { expression: `document.getElementById('btn-download').click()` });

  // 3. 等下载流程结束
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    const text = await gallery.send('Runtime.evaluate', {
      expression: `document.getElementById('progress-text').textContent`,
      returnByValue: true,
    });
    if (/完成|失败/.test(text.result.value || '')) {
      log('progress', { text: text.result.value });
      break;
    }
  }
  await sleep(2500);

  const dl = await gallery.send('Runtime.evaluate', {
    expression: `chrome.downloads.search({}).then((items) => items.map((i) => ({ f: i.filename, s: i.state, e: i.error || null, b: i.bytesReceived })))`,
    awaitPromise: true,
    returnByValue: true,
  });
  log('download-list', { items: (dl.result.value || []).slice(0, 3), total: (dl.result.value || []).length });

  const files = fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith('.png'));
  const details = files.map((name) => {
    const buffer = fs.readFileSync(path.join(DOWNLOADS, name));
    return { name, kb: Math.round(buffer.length / 1024), png: buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG' };
  });
  log('downloaded', { count: details.length, allPng: details.every((d) => d.png), files: details.slice(0, 5) });
  log('result', { ok: details.length === 12 && details.every((d) => d.png) });
} catch (error) {
  log('error', { message: String(error).slice(0, 400) });
} finally {
  fs.writeFileSync(path.join(ROOT, 'qa', 'e2e-report.json'), JSON.stringify(report, null, 2));
  chrome.kill('SIGKILL');
  await sleep(500);
  process.exit(0);
}
