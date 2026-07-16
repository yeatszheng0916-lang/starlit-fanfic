/**
 * 星屑文库 · EdgeOne Pages 边缘函数
 * 路由：
 *   POST /visit   —— 访问打点。请求体可选 { path, articleId }
 *   GET  /visit   —— 返回访问统计：总量 / 今日 / 近7天 / 热门文章
 *
 * 依赖 EdgeOne Pages KV：
 *   1) 控制台 → KV存储 → 开通账户 → 创建命名空间（如 starlit）
 *   2) 项目 → KV存储 → 绑定命名空间，运行时变量名填：STARLIT_KV
 *
 * 键结构：
 *   visit:total            累计访问总数
 *   visit:day:YYYY-MM-DD   某日访问数（按中国时区 UTC+8）
 *   visit:art:<id>         某篇文章的阅读数
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// 取 KV 绑定：优先全局注入（EdgeOne 文档写法），其次 env
function getKV(env) {
  try { if (typeof STARLIT_KV !== 'undefined') return STARLIT_KV; } catch (e) {}
  if (env && env.STARLIT_KV) return env.STARLIT_KV;
  return null;
}

// 中国时区（UTC+8）日期字符串 YYYY-MM-DD
function cnDate(offsetDays = 0) {
  const t = Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

async function incr(kv, key) {
  const cur = Number((await kv.get(key)) || 0);
  const next = cur + 1;
  await kv.put(key, String(next));
  return next;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const kv = getKV(env);
  if (!kv) {
    // KV 未绑定时不报错，返回空统计，避免前端异常
    return json({ ok: false, reason: 'KV 未绑定（STARLIT_KV）', total: 0, today: 0, week: [], topArticles: [] });
  }

  // 打点
  if (request.method === 'POST') {
    try {
      let articleId = '';
      try { const b = await request.json(); articleId = (b && b.articleId) || ''; } catch (e) {}
      await incr(kv, 'visit:total');
      await incr(kv, 'visit:day:' + cnDate(0));
      if (articleId) await incr(kv, 'visit:art:' + articleId);
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  // 统计查询
  try {
    const total = Number((await kv.get('visit:total')) || 0);
    const today = Number((await kv.get('visit:day:' + cnDate(0))) || 0);

    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = cnDate(-i);
      const v = Number((await kv.get('visit:day:' + d)) || 0);
      week.push({ date: d, count: v });
    }

    // 热门文章（遍历 visit:art:* 前缀）
    const topArticles = [];
    try {
      const res = await kv.list({ prefix: 'visit:art:', limit: 256 });
      const keys = (res && res.keys) || [];
      for (const k of keys) {
        const id = k.key.replace('visit:art:', '');
        const v = Number((await kv.get(k.key)) || 0);
        topArticles.push({ id, count: v });
      }
      topArticles.sort((a, b) => b.count - a.count);
    } catch (e) {}

    return json({ ok: true, total, today, week, topArticles: topArticles.slice(0, 10) });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
