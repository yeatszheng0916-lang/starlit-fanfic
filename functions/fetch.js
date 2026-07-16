/**
 * 星屑文库 · EdgeOne Pages 边缘函数
 * 路由：GET /fetch?url=...&cookie=...  —— 服务端抓取微博 / Lofter 正文（绕过浏览器跨域）
 *
 * 说明：cookie 参数可选，用于透传登录态提升抓取成功率。抓取为启发式提取，
 *       个别页面结构变化可能抓不全，必要时人工补录或用本地 scraper.js。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
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

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    const cookie = url.searchParams.get('cookie') || '';
    if (!target) return json({ error: '缺少 url 参数' }, 400);
    const data = await fetchArticle(target, cookie);
    return json(data);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
