/**
 * 星屑文库 · Cloudflare Worker（后端）
 * 实现三件事，让站点具备「强密码 + 链接直抓 + 文章持久化」：
 *   1) POST /verify       密码校验（服务端，不暴露前端）
 *   2) GET  /fetch?url=   服务端抓取微博 / Lofter 正文（绕过浏览器跨域）
 *   3) POST /articles     把新文章写回 GitHub 仓库的 data/articles.json
 *
 * 部署：
 *   - 在 Cloudflare 建一个 Worker，把本文件作为入口。
 *   - 在 Worker 的「变量与机密」里设置：
 *       PASSWORD_HASH   你密码的 SHA-256（本地算：printf '密码' | sha256sum）
 *       GITHUB_TOKEN    有 repo 权限的 GitHub Personal Access Token
 *       GITHUB_REPO     owner/repo
 *       GITHUB_PATH     data/articles.json
 *       GITHUB_BRANCH   main
 *   - 部署后把 Worker 地址填入前端 assets/app.js 的 CONFIG.API_BASE。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function decode(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/<br\s*\/?>/gi, '\n').replace(/\s*\n\s*\n+/g, '\n').trim();
}
function strip(h) {
  return h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<noscript[\s\S]*?<\/noscript>/gi, '').replace(/<header[\s\S]*?<\/header>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '');
}
function extractParagraphs(h) {
  const blocks = strip(h).match(/<(p|div|section|article)[^>]*>([\s\S]*?)<\/\1>/gi) || [];
  let p = blocks.map((b) => decode(b.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '')))
                .filter((t) => t && t.length > 1 && !/^[\s\W]*$/.test(t));
  if (p.length < 2) p = decode(h).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(p)].map((t) => `<p>${t.replace(/\n/g, '<br>')}</p>`).join('');
}

async function fetchArticle(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const html = await res.text();
  const title = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
              || html.match(/<title>([\s\S]*?)<\/title>/i) || [, '未命名文章'])[1];
  let content = extractParagraphs(html);
  if (/weibo/.test(url)) {
    const j = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (j) content = decode(j[1].replace(/\\n/g, '\n')).split(/\n+/).map((p) => `<p>${p}</p>`).join('');
  }
  return { title: title.trim(), content, fandom: '', cp: '', tags: [], authorNote: '' };
}

async function githubGet() {
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, 'User-Agent': UA }
  });
  const d = await r.json();
  return { sha: d.sha, data: JSON.parse(atob(d.content.replace(/\s/g, ''))) };
}
async function githubPut(sha, data) {
  await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'add article via 星屑文库',
      branch: GH_BRANCH,
      sha,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))))
    })
  });
}

export default {
  async fetch(req, env, ctx) {
    const { GH_TOKEN, GH_REPO, GH_PATH = 'data/articles.json', GH_BRANCH = 'main', PASSWORD_HASH } = env;
    const url = new URL(req.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // 1) 密码校验
    if (url.pathname === '/verify' && req.method === 'POST') {
      const { password } = await req.json();
      const ok = (await sha256(password)) === PASSWORD_HASH;
      return new Response(JSON.stringify({ ok }), { headers: { 'Content-Type': 'application/json', ...cors } });
    }
    // 2) 抓取
    if (url.pathname === '/fetch' && req.method === 'GET') {
      try {
        const d = await fetchArticle(url.searchParams.get('url'));
        return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }
    // 3) 持久化
    if (url.pathname === '/articles' && req.method === 'POST') {
      try {
        const art = await req.json();
        const { sha, data } = await githubGet();
        data.articles.push(art);
        await githubPut(sha, data);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }
    return new Response('星屑文库 API', { headers: cors });
  }
};
