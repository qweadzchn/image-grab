/**
 * 图提取 ImageGrab —— 官网交互脚本
 * 1. 移动端汉堡菜单展开 / 收起；
 * 2. 滚动时导航栏吸顶加阴影；
 * 3. 滚动监听高亮当前区块对应的导航项；
 * 4. IntersectionObserver 实现进入视口淡入上移。
 * 全部使用原生 API，不依赖任何框架或 CDN。
 */
(() => {
  'use strict';

  const nav = document.getElementById('nav');
  const toggle = document.getElementById('nav-toggle');
  const menu = document.getElementById('nav-menu');
  const navLinks = menu ? Array.from(menu.querySelectorAll('a')) : [];

  /** ---------------------------- 移动端菜单 ---------------------------- */
  function setMenu(open) {
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
    menu.classList.toggle('is-open', open);
  }

  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
    });

    navLinks.forEach((link) => link.addEventListener('click', () => setMenu(false)));

    // 点击菜单外部收起
    document.addEventListener('click', (event) => {
      if (!menu.classList.contains('is-open')) return;
      if (menu.contains(event.target) || toggle.contains(event.target)) return;
      setMenu(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setMenu(false);
    });

    // 视口变宽后清理移动端状态，避免桌面端残留
    window.addEventListener('resize', () => {
      if (window.innerWidth > 767) setMenu(false);
    });
  }

  /** ---------------------------- 吸顶阴影 ---------------------------- */
  let lastScrolled = false;
  function syncNavShadow() {
    const scrolled = window.scrollY > 8;
    if (scrolled === lastScrolled) return;
    lastScrolled = scrolled;
    nav?.classList.toggle('is-scrolled', scrolled);
  }

  syncNavShadow();
  window.addEventListener('scroll', syncNavShadow, { passive: true });

  /** ---------------------------- 滚动高亮 ---------------------------- */
  const sections = navLinks
    .map((link) => {
      const id = link.getAttribute('href') || '';
      if (!id.startsWith('#') || id === '#download') return null;
      const section = document.querySelector(id);
      return section ? { link, section } : null;
    })
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const current = sections.find((item) => item.section === entry.target);
          if (!current) return;
          navLinks.forEach((link) => link.classList.remove('is-active'));
          current.link.classList.add('is-active');
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    sections.forEach((item) => spy.observe(item.section));
  }

  /** ---------------------------- 淡入动画 ---------------------------- */
  const revealItems = Array.from(document.querySelectorAll('.reveal'));

  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
    );
    revealItems.forEach((item, index) => {
      // 同组元素错开一点时间，视觉上更自然
      item.style.transitionDelay = `${Math.min(index % 6, 5) * 60}ms`;
      revealObserver.observe(item);
    });
  }
})();
