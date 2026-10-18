# 图提取 · ImageGrab

一键提取电商商品详情页的所有图片，新标签页集中预览，勾选后批量下载为 PNG 的 Chrome 浏览器扩展（Manifest V3）。

支持淘宝 / 天猫、京东、拼多多商家版商品详情页。

- 官网（GitHub Pages）：<https://qweadzchn.github.io/image-grab/>
- 插件源码：仓库根目录（`manifest.json` 所在目录）

## 功能

| 能力 | 说明 |
| --- | --- |
| 一键提取 | 扫描 `<img>`、`srcset`、`data-src` / `data-lazy-src` 等懒加载属性、内联与计算样式里的 `background-image` |
| 智能过滤 | 过滤图标、logo、二维码、占位图、1×1 像素图，以及小于 100×100 的装饰图；按真实尺寸二次校验 |
| 集中预览 | 新标签页网格展示，含序号、原始尺寸、勾选状态 |
| 自由勾选 | 全选 / 反选 / 实时已选数量 |
| 统一 PNG | 在扩展上下文用 `fetch` + `createImageBitmap` + `OffscreenCanvas` 重绘导出 PNG，避开页面 canvas 跨域污染 |
| 批量下载 | `chrome.downloads` 保存到默认下载目录，文件名 `商品图_001.png` 递增编号，带进度与成功/失败统计 |

## 目录结构

```
image-grab/
├── manifest.json          # 扩展清单（MV3）
├── content.js             # 注入「获取图片」按钮 + 扫描页面图片
├── content.css            # 按钮与轻提示样式
├── background.js          # Service Worker：存储结果、PNG 转换、批量下载
├── gallery.html/.js/.css  # 图片画廊页（网格、勾选、下载进度）
├── icons/                 # 16 / 48 / 128 图标
├── docs/                  # 官方宣传网站（GitHub Pages 发布目录）
│   ├── index.html
│   ├── css/style.css
│   ├── js/main.js
│   └── assets/
├── demo/                  # 本地演示页与示例商品图（不参与扩展运行）
├── tools/                 # 开发脚本：素材生成、浏览器验收
├── qa/                    # 验收截图与报告
└── server.mjs             # 本地预览服务
```

## 安装

1. 下载 `docs/assets/image-grab-v1.0.0.zip` 并解压到一个固定文件夹；
2. 打开 Chrome，地址栏输入 `chrome://extensions`；
3. 打开右上角「开发者模式」；
4. 点击「加载已解压的扩展程序」，选择解压后的文件夹（包含 `manifest.json` 的那一层）。

也可以直接把本仓库克隆下来，选择仓库根目录加载。

## 使用

1. 打开淘宝 / 天猫 / 京东 / 拼多多商家版的商品详情页；
2. 页面右下角出现「获取图片」按钮，点击后自动扫描；
3. 浏览器新标签页打开画廊，勾选需要的图片；
4. 点击「下载选中」，图片以 `商品图_001.png`、`商品图_002.png`……保存到默认下载目录。

> 仅在识别为商品详情页（存在价格区块 / 主图容器 / Product 结构化数据）时注入按钮，列表页与首页不会出现。

## 本地开发与验收

```bash
# 本地预览（官网 + 画廊演示页 + 演示商品详情页）
node server.mjs            # http://127.0.0.1:4180/docs/

# 生成图标与示例商品图
python tools/gen_assets.py

# 浏览器验收（Playwright + Edge/Chrome），输出截图到 qa/
node tools/qa-chrome.mjs
```

演示商品详情页通过 `--host-resolver-rules=MAP item.taobao.com 127.0.0.1` 把域名指向本地服务，
这样扩展的 `content_scripts.matches` 会正常命中，可以完整跑通「按钮 → 扫描 → 画廊 → 下载」。

## 隐私

扩展没有后端服务器，不上传任何页面数据；提取结果只暂存在 `chrome.storage.session`，浏览器关闭即清空。
所有图片处理都在本地浏览器内完成。

## 已知限制

- 少数站点对图片做了防盗链或需要登录态，`fetch` 可能失败，此时单张图片会标记「失败」，不影响其余图片。
- 页面通过 `blob:` / `data:` 动态生成的图片不会被提取。
- 仅支持商品详情页，不支持列表页批量抓取（避免对站点造成压力）。

## 许可

MIT License。仅用于个人素材整理，请遵守各平台使用条款与图片版权。
