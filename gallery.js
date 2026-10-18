/**
 * 图提取 · ImageGrab —— gallery.js
 * 画廊页交互：渲染缩略图网格、勾选、全选/反选、批量下载与进度反馈。
 *
 * 两种运行模式：
 *  1) 扩展模式：从 background 读取上一次提取结果，通过长连接让 background 完成 PNG 转换与下载；
 *  2) 演示模式：直接用浏览器打开本页（file:// 或 http 静态预览）时使用内置示例图，
 *     方便没有安装扩展时预览界面，也用于产品官网/截图展示。
 */
'use strict';

/** 内置示例商品图（演示模式使用） */
const DEMO_IMAGES = [
  { url: 'demo/samples/01.png', width: 900, height: 900 },
  { url: 'demo/samples/02.png', width: 900, height: 900 },
  { url: 'demo/samples/03.png', width: 900, height: 900 },
  { url: 'demo/samples/04.png', width: 900, height: 1200 },
  { url: 'demo/samples/05.png', width: 1200, height: 800 },
  { url: 'demo/samples/06.png', width: 900, height: 900 },
  { url: 'demo/samples/07.png', width: 900, height: 900 },
  { url: 'demo/samples/08.png', width: 900, height: 1200 },
  { url: 'demo/samples/09.png', width: 900, height: 900 },
  { url: 'demo/samples/10.png', width: 1200, height: 800 },
  { url: 'demo/samples/11.png', width: 900, height: 900 },
  { url: 'demo/samples/12.png', width: 900, height: 900 },
];

const state = {
  images: [],
  selected: new Set(),
  isExtension: false,
  downloading: false,
  meta: null,
};

const el = {
  grid: document.getElementById('grid'),
  meta: document.getElementById('page-meta'),
  selectedCount: document.getElementById('selected-count'),
  selectAll: document.getElementById('btn-select-all'),
  invert: document.getElementById('btn-invert'),
  download: document.getElementById('btn-download'),
  progressWrap: document.getElementById('progress-wrap'),
  progressBar: document.getElementById('progress-bar'),
  progressText: document.getElementById('progress-text'),
  demoBanner: document.getElementById('demo-banner'),
  empty: document.getElementById('empty-state'),
  toast: document.getElementById('toast'),
  footerTip: document.getElementById('footer-tip'),
};

const hasExtension = Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
const forceDemo = new URLSearchParams(location.search).get('demo') === '1';

/** ---------------------------- 小工具 ---------------------------- */
function toast(message, duration = 3200) {
  el.toast.textContent = message;
  el.toast.classList.add('is-show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.toast.classList.remove('is-show'), duration);
}

function formatSize(width, height) {
  if (!width || !height) return '读取中…';
  return `${width} × ${height}`;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** ---------------------------- 数据加载 ---------------------------- */
function loadFromExtension() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'grab:get' }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        resolve(null);
        return;
      }
      resolve(response.data);
    });
  });
}

async function init() {
  state.isExtension = hasExtension && !forceDemo;
  el.demoBanner.hidden = true;

  let data = null;
  if (state.isExtension) {
    data = await loadFromExtension();
  }

  if (data && Array.isArray(data.images) && data.images.length) {
    state.meta = data;
    state.images = data.images.map((item, index) => ({
      id: item.id ?? `img-${index}`,
      index: item.index ?? index,
      url: item.url,
      width: item.width,
      height: item.height,
      status: 'idle',
    }));
    el.meta.textContent = `${data.platform} · ${data.title} · 共 ${state.images.length} 张（${data.totalFound ?? state.images.length} 个候选，已过滤小图）`;
  } else if (state.isExtension) {
    // 扩展环境但没有数据：显示空状态
    el.meta.textContent = '还没有提取结果';
    el.empty.hidden = false;
    el.footerTip.textContent = '打开商品详情页，点击右下角「获取图片」';
  } else {
    // 演示模式
    el.demoBanner.hidden = false;
    state.meta = {
      platform: '演示数据',
      title: '示例商品详情页 · 图提取 ImageGrab',
    };
    state.images = DEMO_IMAGES.map((item, index) => ({
      id: `demo-${index}`,
      index,
      url: item.url,
      width: item.width,
      height: item.height,
      status: 'idle',
    }));
    el.meta.textContent = `演示数据 · 示例商品详情页 · 共 ${state.images.length} 张（真实使用时来自当前详情页）`;
  }

  render();
  updateSelectionUI();
}

/** ---------------------------- 渲染 ---------------------------- */
function render() {
  el.grid.innerHTML = '';
  const fragment = document.createDocumentFragment();

  state.images.forEach((image, index) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = image.id;

    const thumb = document.createElement('div');
    thumb.className = 'card__thumb';

    const img = document.createElement('img');
    img.src = image.url;
    img.alt = `图片 ${index + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => {
      // 演示模式下图片未预先给出尺寸，加载后补上真实尺寸
      if (!image.width || !image.height) {
        image.width = img.naturalWidth;
        image.height = img.naturalHeight;
        const sizeNode = card.querySelector('.card__size');
        if (sizeNode) sizeNode.textContent = formatSize(image.width, image.height);
      }
    });
    img.addEventListener('error', () => {
      card.querySelector('.card__size').textContent = '加载失败';
    });
    thumb.appendChild(img);

    const indexBadge = document.createElement('span');
    indexBadge.className = 'card__index';
    indexBadge.textContent = `#${String(index + 1).padStart(3, '0')}`;
    thumb.appendChild(indexBadge);

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'card__check';
    check.setAttribute('aria-label', `选择第 ${index + 1} 张图片`);
    check.setAttribute('aria-pressed', 'false');
    thumb.appendChild(check);

    const meta = document.createElement('div');
    meta.className = 'card__meta';
    const size = document.createElement('span');
    size.className = 'card__size';
    size.textContent = formatSize(image.width, image.height);
    const status = document.createElement('span');
    status.className = 'card__status';
    status.dataset.state = 'idle';
    status.textContent = '待下载';
    meta.append(size, status);

    card.append(thumb, meta);

    // 点卡片任意位置都能切换勾选
    card.addEventListener('click', () => toggle(image.id, card, check));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle(image.id, card, check);
      }
    });
    card.tabIndex = 0;

    fragment.appendChild(card);
  });

  el.grid.appendChild(fragment);
}

function toggle(id, card, check) {
  if (state.downloading) return;
  if (state.selected.has(id)) {
    state.selected.delete(id);
    card.classList.remove('is-selected');
    check?.setAttribute('aria-pressed', 'false');
  } else {
    state.selected.add(id);
    card.classList.add('is-selected');
    check?.setAttribute('aria-pressed', 'true');
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selected.size;
  el.selectedCount.textContent = `已选 ${count} 张`;
  el.download.disabled = count === 0 || state.downloading;
  el.selectAll.disabled = state.downloading || state.images.length === 0;
  el.invert.disabled = state.downloading || state.images.length === 0;
}

/** ---------------------------- 下载 ---------------------------- */
function setCardStatus(index, status, text) {
  const card = el.grid.children[index];
  if (!card) return;
  const node = card.querySelector('.card__status');
  node.dataset.state = status;
  node.textContent = text;
}

async function downloadSelected() {
  if (state.downloading) return;
  const picked = state.images
    .filter((image) => state.selected.has(image.id))
    .sort((a, b) => a.index - b.index);

  if (!picked.length) {
    toast('请先勾选要下载的图片');
    return;
  }

  state.downloading = true;
  updateSelectionUI();
  el.progressWrap.hidden = false;
  el.progressBar.style.width = '0%';
  el.progressText.textContent = `准备下载 ${picked.length} 张…`;

  if (state.isExtension) {
    downloadWithExtension(picked);
  } else {
    downloadInDemoMode(picked);
  }
}

/** 扩展模式：长连接交给 background 处理 PNG 转换和保存 */
function downloadWithExtension(picked) {
  const port = chrome.runtime.connect({ name: 'grab-download' });
  let finished = false;

  port.onMessage.addListener((message) => {
    if (message.type === 'grab:progress') {
      const { done, total, index, status, error } = message;
      if (status === 'ok') {
        setCardStatus(index, 'ok', '已保存');
      } else if (status === 'fail') {
        setCardStatus(index, 'fail', '失败');
        console.warn('[图提取] 第', index + 1, '张下载失败：', error);
      } else if (status === 'working') {
        setCardStatus(index, 'idle', '转换中');
      }
      if (total) {
        el.progressBar.style.width = `${Math.round((done / total) * 100)}%`;
        el.progressText.textContent = `正在下载 ${Math.min(done + 1, total)} / ${total} 张…`;
      }
    }

    if (message.type === 'grab:done') {
      finished = true;
      state.downloading = false;
      updateSelectionUI();
      el.progressBar.style.width = '100%';
      const { success, total, failed } = message;
      el.progressText.textContent = failed.length
        ? `完成：成功 ${success} 张，失败 ${failed.length} 张。失败多半是图片防盗链，可稍后重试。`
        : `完成：${success} 张图片已保存为 PNG`;
      toast(failed.length ? `已保存 ${success} 张，${failed.length} 张失败` : `已保存 ${success} 张 PNG 图片`);
      port.disconnect();
      setTimeout(() => {
        el.progressWrap.hidden = true;
      }, 6000);
    }
  });

  port.onDisconnect.addListener(() => {
    if (finished) return;
    state.downloading = false;
    updateSelectionUI();
    el.progressText.textContent = '连接中断，请重试';
  });

  port.postMessage({
    type: 'grab:start',
    items: picked.map((image) => ({ id: image.id, index: image.index, url: image.url })),
  });
}

/** 演示模式：用 a[download] 直接保存示例图片，同时模拟进度 */
async function downloadInDemoMode(picked) {
  for (let i = 0; i < picked.length; i += 1) {
    const image = picked[i];
    const a = document.createElement('a');
    a.href = image.url;
    a.download = `商品图_${String(image.index + 1).padStart(3, '0')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setCardStatus(image.index, 'ok', '已保存');
    el.progressBar.style.width = `${Math.round(((i + 1) / picked.length) * 100)}%`;
    el.progressText.textContent = `正在保存 ${i + 1} / ${picked.length} 张…`;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  state.downloading = false;
  updateSelectionUI();
  el.progressText.textContent = `完成：${picked.length} 张示例图片已保存（演示模式）`;
  toast(`演示模式：已保存 ${picked.length} 张示例图片`);
  setTimeout(() => {
    el.progressWrap.hidden = true;
  }, 6000);
}

/** ---------------------------- 事件绑定 ---------------------------- */
el.selectAll.addEventListener('click', () => {
  if (state.downloading) return;
  state.images.forEach((image, index) => {
    state.selected.add(image.id);
    el.grid.children[index]?.classList.add('is-selected');
  });
  updateSelectionUI();
});

el.invert.addEventListener('click', () => {
  if (state.downloading) return;
  state.images.forEach((image, index) => {
    const card = el.grid.children[index];
    if (state.selected.has(image.id)) {
      state.selected.delete(image.id);
      card?.classList.remove('is-selected');
    } else {
      state.selected.add(image.id);
      card?.classList.add('is-selected');
    }
  });
  updateSelectionUI();
});

el.download.addEventListener('click', downloadSelected);

init().catch((error) => {
  console.error('[图提取] 画廊初始化失败', error);
  el.meta.textContent = '初始化失败';
  toast('画廊初始化失败，请刷新重试');
});
