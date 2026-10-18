/** 下载能力探针：分别测试 data URL / 中文文件名 / http 直链 三种下载，输出状态。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = 'E:/其他/企业实训/tmp/chrome136/chrome-win64/chrome.exe';
const PROFILE = path.join(ROOT, 'tmp', 'probe-profile');
const DOWNLOADS = path.join(ROOT, 'qa', 'probe-downloads');
const DEBUG_PORT = 9377;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(DOWNLOADS, { recursive: true, force: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    `--user-data-dir=${PROFILE}`,
    `--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
    '--no-proxy-server', '--host-resolver-rules=MAP item.taobao.com 127.0.0.1',
    `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank',
  ],
  { stdio: 'ignore' }
);

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let seq = 0;
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  return {
    ready,
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
  };
}

let version = null;
for (let i = 0; i < 40 && !version; i += 1) {
  try {
    version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
  } catch {
    await sleep(400);
  }
}
const browser = cdp(version.webSocketDebuggerUrl);
await browser.ready;
await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true });

let target = null;
for (let i = 0; i < 30 && !target; i += 1) {
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  target = list.find((t) => t.type === 'page');
  if (!target) await sleep(300);
}

// 找一个扩展页面来调用 chrome.downloads
await browser.send('Target.createTarget', { url: `chrome://extensions` }).catch(() => {});
await sleep(1500);
const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
const extTarget = list.find((t) => (t.url || '').startsWith('chrome-extension://'));
const pageTarget = extTarget ?? list.find((t) => t.type === 'page');
const page = cdp(pageTarget.webSocketDebuggerUrl);
await page.ready;
await page.send('Runtime.enable');

const probe = `(async () => {
  const small = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const results = {};
  const tryDl = async (label, opts) => {
    try {
      const id = await chrome.downloads.download(opts);
      await new Promise((r) => setTimeout(r, 2500));
      const items = await chrome.downloads.search({ id });
      results[label] = items[0] ? { state: items[0].state, error: items[0].error || null, file: items[0].filename, bytes: items[0].bytesReceived } : null;
    } catch (e) { results[label] = 'ERR ' + e.message; }
  };
  await tryDl('ascii', { url: small, filename: 'probe-ascii.png' });
  await tryDl('chinese', { url: small, filename: '商品图_001.png' });
  await tryDl('http', { url: 'http://127.0.0.1:4180/demo/samples/01.png', filename: 'probe-http.png' });
  return results;
})()`;

try {
  const res = await page.send('Runtime.evaluate', { expression: probe, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(res.result.value, null, 2));
} catch (e) {
  console.log('probe error', String(e).slice(0, 300));
}
console.log('files:', fs.readdirSync(DOWNLOADS));
chrome.kill('SIGKILL');
await sleep(300);
process.exit(0);
