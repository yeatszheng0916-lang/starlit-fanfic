/**
 * 星屑文库 · EdgeOne Pages 边缘函数
 * 路由：POST /articles  —— 把新文章（及可选新合集）写回 GitHub 仓库的 data/articles.json
 *
 * 请求体：{ article: {...}, series?: {...} }   （兼容旧调用：直接传 article 对象）
 *
 * 环境变量（EdgeOne Pages 控制台 → 项目 → 环境变量）：
 *   GITHUB_TOKEN    有 repo 权限的 GitHub Personal Access Token
 *   GITHUB_REPO     owner/repo，例如 yeatszheng0916-lang/starlit-fanfic
 *   GITHUB_PATH     data/articles.json（可省，默认此值）
 *   GITHUB_BRANCH   main（可省，默认 main）
 *
 * 写回 GitHub 会触发 EdgeOne Pages 自动重新部署，新文章随即上线。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function readEnv(env, key) {
  if (env && env[key] != null) return env[key];
  try { if (typeof globalThis[key] !== 'undefined') return globalThis[key]; } catch (e) {}
  return undefined;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function ghConf(env) {
  return {
    token: readEnv(env, 'GITHUB_TOKEN'),
    repo: readEnv(env, 'GITHUB_REPO'),
    path: readEnv(env, 'GITHUB_PATH') || 'data/articles.json',
    branch: readEnv(env, 'GITHUB_BRANCH') || 'main',
  };
}

async function githubGet(c) {
  if (!c.token || !c.repo) {
    throw new Error('缺少 GITHUB_TOKEN / GITHUB_REPO 环境变量，请在 EdgeOne Pages 项目设置里补全');
  }
  const r = await fetch(`https://api.github.com/repos/${c.repo}/contents/${c.path}?ref=${c.branch}`, {
    headers: { Authorization: `Bearer ${c.token}`, 'User-Agent': UA },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`GitHub 读取失败 (${r.status}) ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  return { sha: d.sha, data: JSON.parse(atob(d.content.replace(/\s/g, ''))) };
}

async function githubPut(c, sha, data) {
  return fetch(`https://api.github.com/repos/${c.repo}/contents/${c.path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${c.token}`, 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'add article via 星屑文库',
      branch: c.branch,
      sha,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
    }),
  });
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const c = ghConf(env);
    const body = await request.json();
    const art = body.article || body;          // 兼容只传 article 的旧调用
    const newSeries = body.series || null;
    let lastErr = '';

    // 并发写冲突（409）时重新拉取最新 sha 再写，最多重试 3 次
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { sha, data } = await githubGet(c);
        data.articles = data.articles || [];
        data.articles.push(art);
        if (newSeries && newSeries.id && !(data.series || []).some((s) => s.id === newSeries.id)) {
          data.series = data.series || [];
          data.series.push(newSeries);
        }
        const r = await githubPut(c, sha, data);
        if (r.ok) return json({ ok: true });
        if (r.status === 409) { lastErr = '文件并发冲突，正在重试…'; continue; }
        lastErr = `GitHub 写入失败 (${r.status})`;
        break;
      } catch (e) {
        lastErr = e.message;
      }
    }
    return json({ error: lastErr || '未知错误' }, 500);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
