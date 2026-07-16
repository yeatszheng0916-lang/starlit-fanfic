/**
 * 星屑文库 · Cloudflare Worker（后端，已修复）
 * 实现三件事，让站点具备「强密码 + 链接直抓 + 文章持久化」：
 *   1) POST /verify       密码校验（服务端，不暴露前端）
 *   2) GET  /fetch?url=   服务端抓取微博 / Lofter 正文（绕过浏览器跨域）
 *   3) POST /articles     把新文章（及可选的新合集）写回 GitHub 仓库的 data/articles.json
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
 *
 * 相比旧版修复：
 *   - GH_* 环境变量原在 fetch 内解构，却被子函数引用导致 undefined（写回 GitHub 永远失败）。
 *     现改为把 env 显式传给 githubGet / githubPut。
 *   - /articles 支持同时持久化「新增合集」，合集不再丢失。
 *   - githubPut 校验 GitHub 返回状态，409 并发冲突自动重试（最多 3 次）。
 *   - /fetch 支持可选 ?cookie= 透传登录态，提升微博 / Lofter 抓取成功率。
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

async function fetchArticle(url, cookie) {
  const headers = { 'User-Agent': UA };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(url, { headers, redirect: 'follow' });
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

// 注意：env 必须显式传入，Cloudflare Workers ESM 不会把环境变量注入为全局变量
async function githubGet(env) {
  const { GH_TOKEN, GH_REPO, GH_PATH, GH_BRANCH } = env;
  if (!GH_TOKEN || !GH_REPO) {
    throw new Error('Worker 缺少 GITHUB_TOKEN / GITHUB_REPO 环境变量，请在 Worker 设置里补全');
  }
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}?ref=${GH_BRANCH}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, 'User-Agent': UA }
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`GitHub 读取失败 (${r.status}) ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  return { sha: d.sha, data: JSON.parse(atob(d.content.replace(/\s/g, ''))) };
}
async function githubPut(env, sha, data) {
  const { GH_TOKEN, GH_REPO, GH_PATH, GH_BRANCH } = env;
  return fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`, {
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
      const ok = PASSWORD_HASH ? (await sha256(password)) === PASSWORD_HASH : false;
      return new Response(JSON.stringify({ ok }), { headers: { 'Content-Type': 'application/json', ...cors } });
    }
    // 2) 抓取
    if (url.pathname === '/fetch' && req.method === 'GET') {
      try {
        const target = url.searchParams.get('url');
        const cookie = url.searchParams.get('cookie') || '';
        if (!target) {
          return new Response(JSON.stringify({ error: '缺少 url 参数' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
        }
        const d = await fetchArticle(target, cookie);
        return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }
    // 3) 持久化（文章 + 可选新增合集）
    if (url.pathname === '/articles' && req.method === 'POST') {
      try {
        const body = await req.json();
        const art = body.article || body;            // 兼容「只传 article」的旧调用
        const newSeries = body.series || null;
        let lastErr = '';
        // 读写冲突（409）时重新拉取最新 sha 再写，最多重试 3 次
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const { sha, data } = await githubGet(env);
            data.articles = data.articles || [];
            data.articles.push(art);
            if (newSeries && newSeries.id && !(data.series || []).some((s) => s.id === newSeries.id)) {
              data.series = data.series || [];
              data.series.push(newSeries);
            }
            const r = await githubPut(env, sha, data);
            if (r.ok) {
              return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...cors } });
            }
            if (r.status === 409) { lastErr = '文件并发冲突，正在重试…'; continue; }
            lastErr = `GitHub 写入失败 (${r.status})`;
            break;
          } catch (e) {
            lastErr = e.message;
          }
        }
        return new Response(JSON.stringify({ error: lastErr || '未知错误' }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }
    return new Response('星屑文库 API', { headers: cors });
  }
};
