/**
 * 星屑文库 · EdgeOne Pages 边缘函数
 * 路由：POST /verify   —— 服务端密码校验（不在前端暴露真实哈希逻辑）
 *
 * 环境变量（在 EdgeOne Pages 控制台 → 项目 → 环境变量 中设置）：
 *   PASSWORD_HASH   你密码的 SHA-256（本地算：printf '密码' | sha256sum）
 *
 * 说明：EdgeOne Pages 的函数与前端同域，前端用相对路径 /verify 调用，
 *       不需要 workers.dev 之类的独立域名，因此不会被墙、也无需跨域。
 */

// 读取环境变量：优先 env 对象，其次全局注入（兼容不同运行时）
function readEnv(env, key) {
  if (env && env[key] != null) return env[key];
  try { if (typeof globalThis[key] !== 'undefined') return globalThis[key]; } catch (e) {}
  return undefined;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const PASSWORD_HASH = readEnv(env, 'PASSWORD_HASH');
    const { password } = await request.json();
    const ok = PASSWORD_HASH ? (await sha256(password || '')) === PASSWORD_HASH : false;
    return json({ ok });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
