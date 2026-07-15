# 星屑文库

一个温柔的、只属于你的同人文收藏地。黑色银河主题，支持密码门、昵称、作品/CP/标签筛选、系列合集、上一章/下一章、作者有话说、以及微博 / Lofter 链接抓取。

## 特性

- **视觉**：深空黑底 + 淡灰蓝点缀，Canvas 星空与毛玻璃卡片。
- **密码门**：访问前需输入密码与昵称。Demo 阶段为前端 SHA-256 校验；接入后端后升级为服务端校验。
- **标签筛选**：按作品、按 CP、按标签筛选文章。
- **合集**：系列作品可组成合集，合集内章节按序号排序。
- **上一章 / 下一章**：系列文章页自动显示相邻章节导航。
- **作者有话说**：每篇文章顶部可展示作者寄语。
- **添加文章**：支持粘贴微博 / Lofter 链接，后端抓取正文与排版（后端需部署 Cloudflare Worker）。
- **外部链接**：每篇文章保留原文链接，可跳转微博 / Lofter。

## 项目结构

```
fanfic-site/
├── index.html              # 入口页面（SPA）
├── preview.html            # 自动过门预览页（仅用于本地截图，可删）
├── assets/
│   ├── style.css           # 银河主题样式
│   ├── starfield.js        # Canvas 星空背景
│   └── app.js              # 路由、渲染、密码、抓取接口
├── data/
│   └── articles.json       # 文章数据与站点配置
├── scraper.js              # Node 抓取脚本（本地 / 云端跑）
├── worker.js                 # Cloudflare Worker 后端示例
└── README.md
```

## 默认演示密码

Demo 站点默认密码：

```
starlight
```

如需修改，把 `data/articles.json` 里的 `passwordHash` 替换为你的密码的 SHA-256 值：

```bash
printf '你的密码' | sha256sum
```

然后填进：

```json
"passwordHash": "你的-sha256-值"
```

> 更强保护请接入 Cloudflare Worker（见下文），密码哈希只留在服务端。

## 本地预览

```bash
cd fanfic-site
python3 -m http.server 8080
# 打开 http://localhost:8080
```

密码：`starlight`。

## 部署到 GitHub Pages

1. 在 GitHub 新建一个空仓库（例如 `my-fanfic`）。
2. 把本目录推到仓库主分支：

```bash
git init
git add .
git commit -m "init: 星屑文库"
git branch -M main
git remote add origin https://github.com/你的用户名/my-fanfic.git
git push -u origin main
```

3. 仓库 → **Settings → Pages → Branch** 选择 `main` / `root`，保存。
4. 几分钟后访问 `https://你的用户名.github.io/my-fanfic/`。

> 如果你希望由 AI 直接推送，请提供一个 GitHub Personal Access Token（`repo` 权限），我可以帮你完成仓库创建和推送。

## 接入后端：Cloudflare Worker

因为浏览器无法直接跨域抓取微博 / Lofter，**真正的「输入链接自动抓取」需要后端**。这里用 Cloudflare Worker（免费）做代理，同时实现服务端密码校验和文章持久化。

部署步骤：

1. 在 Cloudflare 创建一个新的 Worker，把 `worker.js` 内容粘贴进去。
2. 在 Worker → **Variables and Secrets** 添加：
   - `PASSWORD_HASH`：你的密码的 SHA-256 值（同上文算法）。
   - `GITHUB_TOKEN`：有 `repo` 权限的 GitHub Personal Access Token。
   - `GITHUB_REPO`：`你的用户名/仓库名`。
   - `GITHUB_PATH`：`data/articles.json`（默认）。
   - `GITHUB_BRANCH`：`main`（默认）。
3. 保存并部署，复制 Worker 地址（如 `https://api-xxx.你的子域名.workers.dev`）。
4. 打开 `assets/app.js`，把 `CONFIG.API_BASE` 改为你的 Worker 地址：

```js
const CONFIG = {
  API_BASE: "https://api-xxx.你的子域名.workers.dev",
  DATA_URL: "data/articles.json"
};
```

5. 重新提交推送，站点即可：
   - 服务端校验密码（不再依赖前端哈希）。
   - 在添加文章页粘贴微博 / Lofter 链接，点击「从链接抓取」自动获取正文。
   - 提交文章后自动写回 `data/articles.json` 并重新部署 Pages。

## 使用抓取脚本（Node）

如果你不想用 Worker，也可以本地运行抓取脚本，把微博 / Lofter 转成文章 JSON：

```bash
# 查看抓取结果
node scraper.js "https://weibo.com/xxxxx"

# 直接追加到 data/articles.json
node scraper.js "https://weibo.com/xxxxx" --append
```

> 微博 / Lofter 页面结构可能变化，且部分页面需要登录 Cookie 才能看到完整正文。抓取脚本用通用启发式提取，复杂页面可传入 `--cookie` 或进一步手动修正。

## 关于安全

- Demo 模式：密码做 SHA-256 前端比对，适合小范围熟人分享；哈希在源码里可见，理论上可被暴力尝试。
- 生产模式：务必接入 Cloudflare Worker，由服务端校验密码，真正实现「不暴露在前端」。
- 不要把 GitHub Token 和 Cloudflare 密钥写进代码仓库，应通过 Worker 环境变量管理。

## 示例数据

当前仓库内置 5 篇示例文章、2 个合集，可在确认效果后逐步删除或替换为你的真文。

---

星屑文库 · 愿你收藏的故事，都被温柔以待。
