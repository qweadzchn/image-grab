/**
 * 图提取 · ImageGrab —— content.js
 * 职责：在电商详情页右下角注入「获取图片」悬浮按钮，
 *       点击后扫描页面所有商品图（含懒加载、srcset、背景图），
 *       过滤掉图标/占位图/过小的图，去重后交给 background 打开画廊页。
 * 说明：本文件运行在页面隔离环境（isolated world），不会污染页面原有 JS。
 */
(() => {
  'use strict';

  // 防止重复注入（SPA 站内跳转、脚本被重复插入时会触发）
  if (window.__IMAGE_GRAB_LOADED__) return;
  window.__IMAGE_GRAB_LOADED__ = true;

  /** ---------------------------- 常量配置 ---------------------------- */
  const MIN_SIZE = 100;          // 小于 100×100 的图直接丢掉（图标、占位图）
  const MAX_IMAGES = 300;        // 单页最多提取 300 张，避免页面卡死
  const PROBE_TIMEOUT = 6000;    // 单张图片探测超时（毫秒）
  const PROBE_CONCURRENCY = 6;   // 并发探测数量
  const MAX_SCAN_ELEMENTS = 2500; // 背景图扫描的元素上限，防止极端页面卡死

  // 明显不是商品图的文件名特征：图标、logo、占位图、二维码、按钮切图等
  const SKIP_PATTERN =
    /(sprite|icon|logo|avatar|headimg|qrcode|qr_code|placeholder|lazyload|loading|blank|spacer|1x1|transparent|arrow|btn_|button|badge|tag_|watermark)/i;

  // 各平台常见的商品图属性，兼容懒加载写法
  const LAZY_ATTRS = [
    'src',
    'data-src',
    'data-lazy-src',
    'data-original',
    'data-ks-lazyload',
    'data-lazyload',
    'data-img',
    'data-image',
    'data-url',
    'data-echo',
  ];

  /** ---------------------------- 平台识别 ---------------------------- */
  function detectPlatform() {
    const host = location.hostname;
    if (/(^|\.)taobao\.com$/.test(host) || /(^|\.)tmall\.com$/.test(host)) return '淘宝 / 天猫';
    if (/(^|\.)jd\.com$/.test(host)) return '京东';
    if (/(^|\.)pinduoduo\.com$/.test(host) || /(^|\.)yangkeduo\.com$/.test(host)) return '拼多多商家版';
    return '电商页面';
  }

  /**
   * 判断当前页面是否像「商品详情页」。
   * 详情页特征：有价格区块、有商品主图容器、URL 里带 item/detail 且带数字 id。
   * 判断不通过时不显示按钮，符合「只在详情页注入」的需求。
   */
  function isProductPage() {
    const url = location.href;
    const priceSelectors = [
      '[class*="price"]',
      '[id*="price"]',
      '.tm-price',
      '.p-price',
      '.price',
      '[class*="Price"]',
    ];
    const hasPrice = priceSelectors.some((sel) => {
      try {
        return !!document.querySelector(sel);
      } catch {
        return false;
      }
    });

    const hasMainImage = !!document.querySelector(
      '#J_ImgBooth, #spec-img, [class*="main-img"], [class*="mainPic"], [class*="gallery"], [class*="thumb"]'
    );

    const urlLooksDetail = /\/(item|detail|product|goods|offer)s?\//i.test(url) && /\d{5,}/.test(url);
    const ldProduct = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some((s) =>
      /"@type"\s*:\s*"Product"/i.test(s.textContent || '')
    );

    // 强特征：价格 + 主图容器，或结构化数据声明为 Product
    if ((hasPrice && hasMainImage) || ldProduct) return true;
    // 弱特征：详情页 URL 且价格存在
    if (urlLooksDetail && hasPrice) return true;
    return false;
  }

  /** ---------------------------- 工具函数 ---------------------------- */
  /** 把相对路径补全为绝对地址，过滤掉不能用的协议 */
  function normalizeUrl(raw) {
    if (!raw) return null;
    const value = String(raw).trim().replace(/^['"]|['"]$/g, '');
    if (!value) return null;
    if (/^(data|blob|javascript|chrome-extension|about):/i.test(value)) return null;
    if (value.startsWith('//')) return `${location.protocol}${value}`;
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol)) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  /** 解析 srcset="a.jpg 1x, b.jpg 2x"，取其中最大的候选（最后一个通常最大） */
  function parseSrcset(value) {
    if (!value) return [];
    return String(value)
      .split(',')
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  /** 从 background-image: url("...") 中提取地址 */
  function parseBackgroundImage(value) {
    if (!value || value === 'none') return [];
    const found = [];
    const regex = /url\((['"]?)(.*?)\1\)/gi;
    let match;
    while ((match = regex.exec(value))) {
      if (match[2]) found.push(match[2]);
    }
    return found;
  }

  /**
   * 去重用的「指纹」：抹掉图片 CDN 的尺寸/质量后缀，
   * 例如 xxx.jpg_400x400q90.jpg、xxx_800x800.jpg 视为同一张图。
   */
  function fingerprint(url) {
    return url
      .split('?')[0]
      .replace(/\.(jpe?g|png|webp|gif|avif)(_\d+x\d+[^/]*)?$/i, '')
      .replace(/_(q\d+|sum|watermark|s\d+x\d+)$/i, '')
      .toLowerCase();
  }

  /** 限制并发执行，避免一次性请求几百张图 */
  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    });
    await Promise.all(runners);
    return results;
  }

  /** 用 Image 探针读取真实尺寸（懒加载图往往还没加载，读不到 naturalWidth） */
  function probeSize(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        img.onload = img.onerror = null;
        resolve(ok ? { ok: true, width: img.naturalWidth, height: img.naturalHeight } : { ok: false, width: 0, height: 0 });
      };
      const timer = setTimeout(() => finish(false), PROBE_TIMEOUT);
      img.onload = () => {
        clearTimeout(timer);
        finish(true);
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(false);
      };
      img.src = url;
    });
  }

  /** ---------------------------- 图片收集 ---------------------------- */
  /** 扫描页面，收集候选图片地址（尚未判断尺寸） */
  function collectCandidates() {
    const candidates = new Map(); // fingerprint -> url
    const add = (raw) => {
      const url = normalizeUrl(raw);
      if (!url) return;
      if (SKIP_PATTERN.test(url)) return;
      const key = fingerprint(url);
      if (!candidates.has(key)) candidates.set(key, url);
    };

    // 1) img 标签：src / 懒加载属性 / srcset
    document.querySelectorAll('img').forEach((img) => {
      LAZY_ATTRS.forEach((attr) => add(img.getAttribute(attr)));
      parseSrcset(img.getAttribute('srcset')).forEach(add);
      parseSrcset(img.getAttribute('data-srcset')).forEach(add);
    });

    // 2) picture > source[srcset]
    document.querySelectorAll('source[srcset], source[data-srcset]').forEach((source) => {
      parseSrcset(source.getAttribute('srcset')).forEach(add);
      parseSrcset(source.getAttribute('data-srcset')).forEach(add);
    });

    // 3) 内联 style 里的背景图（促销图、SKU 图常用这种方式）
    const styled = Array.from(document.querySelectorAll('[style*="background"]')).slice(0, MAX_SCAN_ELEMENTS);
    styled.forEach((el) => parseBackgroundImage(el.getAttribute('style')).forEach(add));

    // 4) 常见图片容器用 CSS 类设置背景图，需要读计算样式
    const containers = Array.from(
      document.querySelectorAll('[class*="img"], [class*="pic"], [class*="main"], [class*="banner"], [class*="detail"]')
    ).slice(0, MAX_SCAN_ELEMENTS);
    containers.forEach((el) => {
      try {
        parseBackgroundImage(getComputedStyle(el).backgroundImage).forEach(add);
      } catch {
        /* 忽略单个元素读取失败 */
      }
    });

    return Array.from(candidates.values());
  }

  /** 过滤：真实尺寸达标、非极端长宽比、非过小的占位图 */
  async function filterBySize(urls, onProgress) {
    let finished = 0;
    const results = await mapLimit(urls, PROBE_CONCURRENCY, async (url) => {
      const size = await probeSize(url);
      finished += 1;
      onProgress?.(finished, urls.length);
      if (!size.ok) return null;
      const { width, height } = size;
      if (width < MIN_SIZE || height < MIN_SIZE) return null;
      const ratio = width / height;
      if (ratio > 5 || ratio < 0.2) return null; // 细长条一般是分割线、装饰条
      return { url, width, height };
    });
    return results.filter(Boolean);
  }

  /** ---------------------------- 悬浮按钮 UI ---------------------------- */
  const ICON_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Z"/>
      <path fill="currentColor" d="M4 16a1 1 0 0 1 1 1v2h14v-2a1 1 0 1 1 2 0v2.5A1.5 1.5 0 0 1 19.5 21h-15A1.5 1.5 0 0 1 3 19.5V17a1 1 0 0 1 1-1Z"/>
    </svg>`;

  let button = null;
  let toastTimer = null;

  function createButton() {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = 'image-grab-btn';
    el.className = 'image-grab-btn';
    el.setAttribute('aria-label', '获取图片：扫描当前页面所有商品图');
    el.innerHTML = `<span class="image-grab-btn__icon">${ICON_SVG}</span><span class="image-grab-btn__text">获取图片</span><span class="image-grab-btn__spinner" aria-hidden="true"></span>`;
    el.addEventListener('click', runExtraction);
    return el;
  }

  function setButtonState(state, text) {
    if (!button) return;
    button.dataset.state = state; // idle | scanning | done | error
    button.querySelector('.image-grab-btn__text').textContent = text;
    button.disabled = state === 'scanning';
  }

  function toast(message, tone = 'ok') {
    let el = document.getElementById('image-grab-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'image-grab-toast';
      el.className = 'image-grab-toast';
      document.documentElement.appendChild(el);
    }
    el.dataset.tone = tone;
    el.textContent = message;
    el.classList.add('image-grab-toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('image-grab-toast--show'), 3600);
  }

  /** ---------------------------- 核心流程 ---------------------------- */
  async function runExtraction() {
    if (button?.dataset.state === 'scanning') return;
    try {
      setButtonState('scanning', '正在扫描…');
      const candidates = collectCandidates();
      if (!candidates.length) {
        setButtonState('idle', '获取图片');
        toast('没有找到可选图片，请等图片加载完再试', 'warn');
        return;
      }

      const images = await filterBySize(candidates, (done, total) => {
        // 每 5 张刷新一次文字，避免高频 DOM 更新
        if (done % 5 === 0 || done === total) setButtonState('scanning', `扫描 ${done}/${total}`);
      });

      if (!images.length) {
        setButtonState('idle', '获取图片');
        toast('图片都太小，已被过滤', 'warn');
        return;
      }

      // 按面积从大到小排序，主图排前面
      images.sort((a, b) => b.width * b.height - a.width * a.height);
      const sliced = images.slice(0, MAX_IMAGES);

      const payload = {
        title: document.title.replace(/\s+/g, ' ').trim().slice(0, 120) || '未命名商品页',
        pageUrl: location.href,
        platform: detectPlatform(),
        capturedAt: Date.now(),
        totalFound: candidates.length,
        images: sliced.map((item, index) => ({ id: `${Date.now()}-${index}`, index, ...item })),
      };

      chrome.runtime.sendMessage({ type: 'grab:save', payload }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          setButtonState('error', '打开失败');
          toast('无法打开画廊，请在扩展管理页检查是否已启用', 'error');
          setTimeout(() => setButtonState('idle', '获取图片'), 2600);
          return;
        }
        setButtonState('done', `已提取 ${sliced.length} 张`);
        toast(`已提取 ${sliced.length} 张图片，正在打开画廊…`);
        setTimeout(() => setButtonState('idle', '获取图片'), 4000);
      });
    } catch (error) {
      console.error('[图提取] 扫描失败', error);
      setButtonState('error', '扫描失败');
      toast('扫描出错了，请刷新页面后重试', 'error');
      setTimeout(() => setButtonState('idle', '获取图片'), 2600);
    }
  }

  /** ---------------------------- 入口 ---------------------------- */
  function mount() {
    if (button && document.documentElement.contains(button)) return;
    if (!isProductPage()) return;
    button = createButton();
    document.documentElement.appendChild(button);
  }

  // DOMContentLoaded 之后再挂载，图片更多、尺寸更准
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }

  // 兼容 SPA 站内跳转：URL 变化后重新判断是否详情页
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    setTimeout(mount, 1200);
  }, 1500);
})();
