/**
 * 图提取 ImageGrab —— 本地预览服务（仅开发/演示用，不参与扩展运行）
 *
 * 用法：
 *   node server.mjs                 默认 4180 端口，服务整个项目目录
 *   node server.mjs --port 4181     指定端口
 *
 * 访问：
 *   http://127.0.0.1:4180/docs/            官网首页
 *   http://127.0.0.1:4180/gallery.html    画廊页（演示数据）
 *   http://127.0.0.1:4180/item.htm?id=1   演示商品详情页（需配合 hosts 映射才能触发插件按钮）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const PORT = Number(portIndex >= 0 ? args[portIndex + 1] : 4180) || 4180;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  // 演示详情页：模拟电商详情页地址
  if (pathname === '/' || pathname === '/item.htm') {
    pathname = '/demo/product.html';
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buffer);
  });
});

server.listen(PORT, () => {
  console.log(`图提取本地预览：http://127.0.0.1:${PORT}/docs/`);
  console.log(`演示详情页：http://item.taobao.com:${PORT}/item.htm?id=712345678901`);
});
