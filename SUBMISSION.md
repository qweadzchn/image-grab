# 企业实训交付：03 ～ 06

**项目名称：** 图提取 ImageGrab —— 电商图片批量下载 Chrome 插件
**仓库地址：** <https://github.com/qweadzchn/image-grab>
**官网地址（GitHub Pages）：** <https://qweadzchn.github.io/image-grab/>

用 AI 编程从需求拆解一路做到插件、官网、Git 版本管理和 Pages 发布：
Manifest V3 扩展负责扫图与下载，`docs/` 是纯静态官网，仓库推送到 GitHub 后由 Pages 自动发布。

---

## 03：插件截图

对应文件（仓库 `qa/` 目录）：

| 文件 | 内容 |
| --- | --- |
| `qa/03-plugin-button.png` | 商品详情页右下角的「获取图片」悬浮按钮（由 `content.js` 注入） |
| `qa/03-plugin-gallery.png` | 点击后打开的图片画廊：12 张商品图、尺寸、勾选状态、全选 / 反选 / 下载按钮 |
| `qa/03-plugin-gallery-mobile.png` | 手机视口下的画廊页 |

截图环境：真实 Chrome 136 + 未打包加载的扩展（`--load-extension`），
通过 `--host-resolver-rules=MAP item.taobao.com 127.0.0.1` 把域名指向本地演示详情页，
让 `content_scripts.matches` 正常命中，跑的是真实的注入、扫描、渲染代码，不是拼接的假图。

## 04：项目推送到 GitHub 上的截图

对应文件：`qa/04-github-repo.png`（仓库首页，含 README、目录结构、提交记录）

仓库：<https://github.com/qweadzchn/image-grab>

提交记录（`git log`）：

```
chore: 移除 Actions 发布工作流（Pages 改用分支发布 docs/）
chore: 清理失败的 Pages 404 截图与临时诊断脚本
ci: 增加 GitHub Pages 自动发布工作流（docs → Pages）
test: 增加 GitHub 截图脚本与忽略规则
feat: 图提取 ImageGrab 插件首个版本
```

## 05：域名地址

**<https://qweadzchn.github.io/image-grab/>**

说明：本次用的是 GitHub Pages 的默认子域名（用户名 + 仓库名），没有单独购买域名。
如果后续绑定了自定义域名，只需要在仓库里加一个 `CNAME` 文件并在 DNS 里加一条 CNAME 记录指向 `qweadzchn.github.io`。

## 06：使用 GitHub Pages 发布的官网静态页面截图

对应文件：

| 文件 | 内容 |
| --- | --- |
| `qa/06-github-pages.png` | 线上官网首屏（桌面 1440 宽） |
| `qa/06-github-pages-full.png` | 线上官网整页长图 |
| `qa/06-github-pages-mobile.png` | 线上官网手机视口 |

发布配置：仓库 **Settings → Pages → Deploy from a branch → main → /docs**，
站点内容来自仓库里的 `docs/` 目录，纯 HTML + CSS + 原生 JS，没有任何构建步骤和外部依赖。

---

## 项目说明

### 功能

1. **只在详情页出现**：按价格区块、主图容器、Product 结构化数据判断是不是商品详情页；
2. **全来源扫图**：`img`、`srcset`、`data-src` / `data-lazy-src` 等懒加载属性、内联与计算样式的 `background-image`；
3. **智能过滤**：文件名特征 + 真实尺寸双重过滤，去掉图标、logo、二维码、占位图、小于 100×100 的装饰图；
4. **集中预览**：新标签页网格展示缩略图、原始尺寸、序号，支持全选 / 反选 / 实时已选数量；
5. **统一 PNG**：在扩展上下文 `fetch` + `createImageBitmap` + `OffscreenCanvas` 重绘导出，绕开页面 canvas 的跨域污染；
6. **批量下载**：`chrome.downloads` 保存，文件名 `商品图_001.png` 递增编号，带进度与成功 / 失败统计；
7. **官网**：`docs/` 单页滚动官网，含 Hero、产品介绍、核心功能、界面预览、四步安装、下载插件与页脚。

### 技术要点

- Manifest V3（`background.service_worker`、`content_scripts`、`host_permissions`、`chrome.storage.session`、`chrome.downloads`）；
- 页面与扩展之间用 `chrome.runtime.sendMessage` 传递图片列表，下载用长连接（`chrome.runtime.connect`）传进度，避免 service worker 被提前回收；
- 下载前监听 `chrome.downloads.onChanged` 到 `complete` 才算成功，中断的下载不计入成功数；
- 官网零依赖：CSS 变量管主题、IntersectionObserver 做进场动画、滚动监听做导航高亮、移动端汉堡菜单。

### 目录结构

```
image-grab/
├── manifest.json            # 扩展清单（MV3）
├── content.js / content.css # 详情页按钮 + 扫描逻辑
├── background.js            # Service Worker：存储、PNG 转换、批量下载
├── gallery.html/.js/.css    # 图片画廊页
├── icons/                   # 16 / 48 / 128 图标
├── docs/                    # 官网（GitHub Pages 发布目录）
├── demo/                    # 演示详情页与示例商品图
├── tools/                   # 素材生成与浏览器验收脚本
├── qa/                      # 验收截图与报告
└── server.mjs               # 本地预览服务
```

### 验收记录

- `tools/qa-chrome.mjs`：真实 Chrome 136 加载扩展，验证按钮注入、画廊渲染（12 张）、全选、下载流程，桌面 / 手机 / 320px 视口均无横向溢出；
- `tools/cdp-e2e.mjs`：走原生 DevTools Protocol 再跑一遍「点击 → 画廊 → 全选 → 下载」，用于核对下载状态；
- `qa/qa-report.json`、`qa/e2e-report.json`：两次验收的原始输出。

### 已知限制

- 容器环境里的 Chrome 无法创建任何下载文件（连本地 http 直链下载都会返回 `FILE_FAILED`），
  所以「PNG 落盘」这一步只验证到 `chrome.downloads` 受理与状态监听，落盘需要在本地 Chrome 里点一次确认；
- 少数站点图片有防盗链或需要登录态，单张失败会标记「失败」，不影响其余图片；
- 只处理商品详情页，不做列表页批量抓取。

### 合规说明

插件没有后端、不上传任何页面数据，提取结果只存在 `chrome.storage.session`（关浏览器即清空）；
仅用于个人素材整理，请遵守各平台使用条款与图片版权。
