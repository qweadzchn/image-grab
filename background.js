/**
 * 图提取 · ImageGrab —— background.js（MV3 Service Worker）
 * 职责：
 *  1. 接收 content.js 传来的图片列表，暂存到 chrome.storage.session，并打开画廊页；
 *  2. 接收画廊页的下载请求，在扩展上下文里直接用 host_permissions 抓取图片字节，
 *     用 OffscreenCanvas 统一转成 PNG，再交给 chrome.downloads 保存。
 * 为什么在 background 里转换：
 *   页面上的 canvas 直接画跨域图片会被「污染」，无法导出；在扩展里 fetch 有 host 权限，
 *   拿到的是干净的字节流，createImageBitmap + OffscreenCanvas 转换不会跨域失败。
 */
'use strict';

const STORAGE_KEY = 'grab:last';
const GALLERY_PAGE = 'gallery.html';
const MAX_IMAGE_BYTES = 30 * 1024 * 1024; // 单张 30MB 上限，防止极端大图拖垮内存

/** ---------------------------- 存储 ---------------------------- */
/** 优先用 session 存储（关掉浏览器自动清空，不占用户磁盘），不支持时退回 local */
function storageArea() {
  return chrome.storage.session ?? chrome.storage.local;
}

async function saveResult(payload) {
  await storageArea().set({ [STORAGE_KEY]: payload });
}

async function readResult() {
  const data = await storageArea().get(STORAGE_KEY);
  return data?.[STORAGE_KEY] ?? null;
}

/** ---------------------------- 打开画廊 ---------------------------- */
async function openGallery() {
  const data = await readResult();
  const url = `${chrome.runtime.getURL(GALLERY_PAGE)}?t=${Date.now()}`;
  if (!data) {
    // 没有数据时也打开页面，画廊会显示空状态引导用户去详情页点按钮
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.create({ url });
}

/** 扩展图标被点击时：直接打开上一次的提取结果 */
chrome.action.onClicked.addListener(() => {
  openGallery().catch((error) => console.error('[图提取] 打开画廊失败', error));
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.info('[图提取] 安装成功：打开任意商品详情页，右下角会出现「获取图片」按钮');
  }
});

/** ---------------------------- 消息处理 ---------------------------- */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'grab:save') {
    saveResult(message.payload)
      .then(() => openGallery())
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error('[图提取] 保存失败', error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true; // 异步响应
  }

  if (message?.type === 'grab:get') {
    readResult()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

/** 画廊页用长连接发起下载，service worker 在连接存活期间不会被回收 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'grab-download') return;

  port.onMessage.addListener(async (message) => {
    if (message?.type !== 'grab:start') return;
    const items = Array.isArray(message.items) ? message.items : [];
    await downloadAll(items, port);
  });
});

/** ---------------------------- 下载实现 ---------------------------- */
/** Blob 转 data URL：data URL 是 service worker 里唯一能交给 downloads API 的稳定形式 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
      reader.readAsDataURL(blob);
      return;
    }
    // 兜底：手写 base64 编码（部分 service worker 环境没有 FileReader）
    blob
      .arrayBuffer()
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        resolve(`data:${blob.type || 'image/png'};base64,${btoa(binary)}`);
      })
      .catch(reject);
  });
}

/** 抓取图片并统一转成 PNG 的 data URL */
async function fetchAsPng(url) {
  const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const blob = await response.blob();
  if (!blob.size) throw new Error('图片为空');
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('图片过大');

  // 原图已经是 PNG 且不需要改尺寸时，直接复用原始字节，避免二次编码损失
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布');
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(pngBlob);
}

/** 统一文件名：商品图_001.png，序号补零 */
function makeFilename(index) {
  return `商品图_${String(index + 1).padStart(3, '0')}.png`;
}

/**
 * 等一次下载真正落盘：downloads API 的回调只代表「已受理」，
 * 必须监听 onChanged 到 complete 才算成功，否则会把中断当成成功。
 */
function waitForDownloadSettled(downloadId, timeout = 30000) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = (state, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
      resolve({ state, error: error ?? null });
    };

    const listener = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      const state = delta.state.current;
      if (state === 'complete' || state === 'interrupted') finish(state, delta.error?.current);
    };

    chrome.downloads.onChanged.addListener(listener);

    // 兜底：极端情况下 onChanged 没触发，超时后直接查一次状态
    timer = setTimeout(() => {
      chrome.downloads.search({ id: downloadId }, (items) => {
        const item = items?.[0];
        if (item && (item.state === 'complete' || item.state === 'interrupted')) finish(item.state, item.error);
        else finish('timeout', 'TIMEOUT');
      });
    }, timeout);
  });
}

async function downloadOne(item) {
  const dataUrl = await fetchAsPng(item.url);
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: makeFilename(item.index ?? 0),
    conflictAction: 'uniquify',
    saveAs: false,
  });
  const settled = await waitForDownloadSettled(downloadId);
  if (settled.state !== 'complete') {
    throw new Error(`下载未完成（${settled.state}${settled.error ? `: ${settled.error}` : ''}）`);
  }
  return downloadId;
}

async function downloadAll(items, port) {
  const total = items.length;
  let success = 0;
  const failed = [];

  port.postMessage({ type: 'grab:progress', done: 0, total, index: -1, status: 'start' });

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    port.postMessage({ type: 'grab:progress', done: success, total, index: i, status: 'working' });
    try {
      await downloadOne(item);
      success += 1;
      port.postMessage({ type: 'grab:progress', done: success, total, index: i, status: 'ok' });
    } catch (error) {
      // 跨域被拦截、图片 404、单张超限都走这里，不中断其余图片
      failed.push({ index: i, message: error?.message ?? '未知错误' });
      port.postMessage({ type: 'grab:progress', done: success, total, index: i, status: 'fail', error: error?.message });
    }
  }

  port.postMessage({ type: 'grab:done', total, success, failed });
}
