/* =========================================================
   星屑文库 · 前端逻辑
   - 纯静态站（GitHub Pages 可托管）
   - 密码门：Demo 阶段用 SHA-256 前端校验（密码不在源码明文）
   - 后端接入点见下方 CONFIG，接上 Cloudflare Worker 后启用
     真实「服务端密码校验 + 链接抓取 + 文章持久化」
   ========================================================= */
const CONFIG = {
  // 后端模式：部署到 EdgeOne Pages（函数与前端同域）后设为 true，
  // 前端用相对路径调用 /verify、/fetch、/articles、/visit —— 不被墙、无跨域。
  // 设为 false 则回退 Demo 模式：前端哈希校验 + 手动粘贴 + 内存追加。
  BACKEND: true,
  // API 基址。同域部署留空即可（"" + "/verify" = "/verify"）。
  // 若前后端分离部署，可填完整域名，例如 https://your-site.edgeone.app
  API_BASE: "",
  DATA_URL: "data/articles.json"
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let DATA = { site: {}, series: [], articles: [] };
const state = { filter: { fandom: null, cp: null, tag: null } };

/* ---------- 工具 ---------- */
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2600);
}
function seriesById(id) { return DATA.series.find((s) => s.id === id) || null; }
function articlesOfSeries(id) { return DATA.articles.filter((a) => a.seriesId === id).sort((a, b) => a.order - b.order); }
function fmtContent(raw) {
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw; // 已含 HTML 标签
  return raw.split(/\n{1,}/).map((p) => `<p>${esc(p)}</p>`).join("");
}
/* 访问打点：静默上报，失败不影响页面。articleId 可选（阅读文章时带上） */
function pingVisit(articleId) {
  if (!CONFIG.BACKEND) return;
  try {
    fetch(CONFIG.API_BASE + "/visit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId: articleId || "", path: location.hash || "/" }),
      keepalive: true
    }).catch(() => {});
  } catch (e) {}
}

/* ---------- 数据加载 ---------- */
async function loadData() {
  try {
    const r = await fetch(CONFIG.DATA_URL, { cache: "no-store" });
    DATA = await r.json();
  } catch (e) {
    console.error(e);
    toast("数据加载失败，请检查 data/articles.json");
  }
  $("#owner-name").textContent = DATA.site.owner || "一位收藏者";
}

/* ---------- 密码门 ---------- */
function setupGate() {
  if (sessionStorage.getItem("gate") === "open") { openApp(); return; }
  $("#gate").classList.remove("hidden");
  $("#gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nick = $("#nick").value.trim();
    const pwd = $("#pwd").value;
    if (!nick) { $("#gate-hint").textContent = "先留个昵称吧～"; return; }
    if (!pwd) { $("#gate-hint").textContent = "需要输入密码哦"; return; }

    let ok = false;
    if (CONFIG.BACKEND) {
      // 真实后端校验（更强保护）
      try {
        const r = await fetch(CONFIG.API_BASE + "/verify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pwd })
        });
        ok = (await r.json()).ok === true;
      } catch { ok = false; }
    } else {
      // Demo：前端 SHA-256 比对
      ok = (await sha256(pwd)) === DATA.site.passwordHash;
    }
    if (!ok) { $("#gate-hint").textContent = "密码不对，再试试？"; return; }

    localStorage.setItem("nick", nick);
    sessionStorage.setItem("gate", "open");
    openApp();
  });
}
function openApp() {
  $("#gate").classList.add("hidden");
  $("#app").classList.remove("hidden");
  const nick = localStorage.getItem("nick");
  $("#nick-display").textContent = nick ? `欢迎，${nick}` : "";
  pingVisit();
  route();
}
$("#logout")?.addEventListener("click", () => {
  sessionStorage.removeItem("gate");
  location.reload();
});

/* ---------- 路由 ---------- */
function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [page, param] = hash.split("/");
  if (page === "series") return param ? renderSeries(param) : renderSeriesList();
  if (page === "article") return renderArticle(param);
  if (page === "add") return renderAdd();
  return renderHome();
}
addEventListener("hashchange", route);
$$("[data-go]").forEach((el) => el.addEventListener("click", () => {
  const go = el.dataset.go;
  location.hash = go === "home" ? "" : go;
}));

/* ---------- 首页 ---------- */
function renderHome() {
  setActive("home");
  const f = state.filter;
  const list = DATA.articles.filter((a) =>
    (!f.fandom || a.fandom === f.fandom) &&
    (!f.cp || a.cp === f.cp) &&
    (!f.tag || (a.tags || []).includes(f.tag))
  );

  const fandoms = [...new Set(DATA.articles.map((a) => a.fandom))];
  const cps = [...new Set(DATA.articles.map((a) => a.cp))];
  const tags = [...new Set(DATA.articles.flatMap((a) => a.tags || []))];

  const html = `
    <div class="section-head">
      <h2>全部收藏</h2>
      <p>${esc(DATA.site.subtitle || "")}</p>
    </div>
    ${DATA.series.length ? `
    <div class="filter-label" style="margin-bottom:10px">合集</div>
    <div class="grid">
      ${DATA.series.map((s) => `
        <div class="series-card" data-route="series/${s.id}">
          <div class="series-orb">✦</div>
          <div class="series-info">
            <h3>${esc(s.name)}</h3>
            <div class="sub">${esc(s.fandom || "")} · ${esc(s.cp || "")}</div>
            <div class="desc">${esc(s.desc || "")}</div>
          </div>
          <div class="series-count">${articlesOfSeries(s.id).length} 章 →</div>
        </div>`).join("")}
    </div>` : ""}
    <div class="filter-group" style="margin-top:30px">
      <div class="filter-label">按作品筛选</div>
      <div class="filters" id="f-fandom">
        <span class="chip ${!f.fandom ? "active" : ""}" data-f="fandom" data-v="">全部</span>
        ${fandoms.map((x) => `<span class="chip ${f.fandom === x ? "active" : ""}" data-f="fandom" data-v="${esc(x)}">${esc(x)}</span>`).join("")}
      </div>
      <div class="filter-label">按 CP 筛选</div>
      <div class="filters" id="f-cp">
        <span class="chip ${!f.cp ? "active" : ""}" data-f="cp" data-v="">全部</span>
        ${cps.map((x) => `<span class="chip ${f.cp === x ? "active" : ""}" data-f="cp" data-v="${esc(x)}">${esc(x)}</span>`).join("")}
      </div>
      <div class="filter-label">按标签筛选</div>
      <div class="filters" id="f-tag">
        <span class="chip ${!f.tag ? "active" : ""}" data-f="tag" data-v="">全部</span>
        ${tags.map((x) => `<span class="chip ${f.tag === x ? "active" : ""}" data-f="tag" data-v="${esc(x)}">${esc(x)}</span>`).join("")}
      </div>
    </div>
    <div class="grid" id="cards" style="margin-top:10px">
      ${list.map(cardHTML).join("") || `<p style="color:var(--ink-faint)">没有符合条件的文章。</p>`}
    </div>`;
  $("#view").innerHTML = html;
  bindFilters();
}
function cardHTML(a) {
  const s = seriesById(a.seriesId);
  return `
    <div class="card" data-route="article/${a.id}">
      ${s ? `<div class="card-series">${esc(s.name)}</div>` : ""}
      <div class="card-cover">${esc(a.cover || "✦")}</div>
      <div class="card-title">${esc(a.title)}</div>
      <div class="card-meta"><span>${esc(a.fandom || "")}</span><span>·</span><span>${esc(a.cp || "")}</span></div>
      <div class="card-tags">${(a.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    </div>`;
}
function bindFilters() {
  $$(".chip[data-f]").forEach((c) => c.addEventListener("click", () => {
    state.filter[c.dataset.f] = c.dataset.v || null;
    renderHome();
  }));
}

/* ---------- 合集列表 / 合集详情 ---------- */
function renderSeriesList() {
  setActive("series");
  $("#view").innerHTML = `
    <div class="section-head"><h2>合集</h2><p>把同一个故事的不同章节，收进同一片星轨。</p></div>
    <div class="grid">
      ${DATA.series.map((s) => `
        <div class="series-card" data-route="series/${s.id}">
          <div class="series-orb">✦</div>
          <div class="series-info">
            <h3>${esc(s.name)}</h3>
            <div class="sub">${esc(s.fandom || "")} · ${esc(s.cp || "")}</div>
            <div class="desc">${esc(s.desc || "")}</div>
          </div>
          <div class="series-count">${articlesOfSeries(s.id).length} 章 →</div>
        </div>`).join("")}
    </div>`;
}
function renderSeries(id) {
  const s = seriesById(id);
  if (!s) return renderSeriesList();
  const list = articlesOfSeries(id);
  $("#view").innerHTML = `
    <div class="section-head">
      <h2>${esc(s.name)}</h2>
      <p>${esc(s.fandom || "")} · ${esc(s.cp || "")} ｜ ${esc(s.desc || "")}</p>
    </div>
    <div class="grid">
      ${list.map((a) => `
        <div class="card" data-route="article/${a.id}">
          <div class="card-cover">${esc(a.cover || "✦")}</div>
          <div class="card-title">${esc(a.title)}</div>
          <div class="card-meta"><span>第 ${a.order} 章</span></div>
          <div class="card-tags">${(a.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        </div>`).join("")}
    </div>`;
}

/* ---------- 文章页 ---------- */
function renderArticle(id) {
  const a = DATA.articles.find((x) => x.id === id);
  if (!a) return renderHome();
  pingVisit(id);
  const s = seriesById(a.seriesId);
  let prev = null, next = null;
  if (s) {
    const list = articlesOfSeries(s.id);
    const i = list.findIndex((x) => x.id === id);
    prev = i > 0 ? list[i - 1] : null;
    next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  }
  const crumbs = s
    ? `<a data-route="series/${s.id}">${esc(s.name)}</a> / 第 ${a.order} 章`
    : `<a data-go="home">全部</a> / 独立短篇`;
  $("#view").innerHTML = `
    <article class="article">
      <div class="article-head">
        <div class="crumbs">${crumbs}</div>
        <h1 class="article-title">${esc(a.title)}</h1>
        <div class="article-sub">
          <span>作品：${esc(a.fandom || "—")}</span><span>·</span><span>CP：${esc(a.cp || "—")}</span>
          ${a.source ? `<span>·</span><a href="${esc(a.source.url)}" target="_blank" rel="noopener" style="color:var(--blue)">原文↗</a>` : ""}
        </div>
      </div>
      ${a.authorNote ? `<div class="author-note"><div class="an-title">✦ 作者有话说</div>${esc(a.authorNote)}</div>` : ""}
      <div class="divider"></div>
      <div class="content">${fmtContent(a.content || "")}</div>
      <div class="pager">
        ${prev ? `<a class="prev" data-route="article/${prev.id}"><span class="dir">← 上一章</span><span class="pt">${esc(prev.title)}</span></a>` : `<span></span>`}
        ${next ? `<a class="next" data-route="article/${next.id}"><span class="dir">下一章 →</span><span class="pt">${esc(next.title)}</span></a>` : `<span></span>`}
      </div>
    </article>`;
}

/* ---------- 添加文章 ---------- */
function renderAdd() {
  setActive("add");
  $("#view").innerHTML = `
    <div class="form-wrap">
      <div class="section-head"><h2>添加文章</h2><p>粘贴微博 / Lofter 链接，或从下方手动填写。</p></div>
      <div class="note-box" id="add-note">${CONFIG.BACKEND
        ? "已连接后端：可自动抓取链接内容并持久化保存。"
        : "当前为 Demo 模式：抓取与保存需后端支持。可手动填写正文，提交后会在本次浏览中显示（刷新不保留）。部署到 EdgeOne Pages 后即支持真实抓取与持久化。"}</div>
      <div class="field">
        <label>原文链接（微博 / Lofter）</label>
        <div class="fetch-bar">
          <input id="f-url" type="url" placeholder="https://weibo.com/... 或 https://*.lofter.com/..." />
          <button class="btn-ghost" id="f-fetch" type="button">从链接抓取</button>
        </div>
        <div class="hint-line">抓取由后端服务完成（绕过浏览器跨域限制）。未连接后端时请手动填写下方内容。</div>
      </div>
      <div class="field">
        <label>标题</label>
        <input id="f-title" placeholder="章节标题" />
      </div>
      <div class="row">
        <div class="field">
          <label>所属合集</label>
          <select id="f-series">
            <option value="">（独立短篇，不属于合集）</option>
            ${DATA.series.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}
            <option value="__new__">＋ 新建合集…</option>
          </select>
        </div>
        <div class="field" id="f-newseries-wrap" style="display:none">
          <label>新合集名称</label>
          <input id="f-newseries" placeholder="新合集名" />
        </div>
        <div class="field">
          <label>章节序号</label>
          <input id="f-order" type="number" value="1" min="0" />
        </div>
      </div>
      <div class="row">
        <div class="field"><label>作品标注</label><input id="f-fandom" placeholder="如：原创宇宙" /></div>
        <div class="field"><label>CP</label><input id="f-cp" placeholder="如：A × B" /></div>
      </div>
      <div class="field"><label>标签（逗号分隔）</label><input id="f-tags" placeholder="温柔, 治愈, 慢热" /></div>
      <div class="field"><label>作者有话说</label><textarea id="f-note" style="min-height:90px" placeholder="想对读者说的话…"></textarea></div>
      <div class="field"><label>正文（支持粘贴带排版的文本 / HTML）</label><textarea id="f-content" placeholder="在这里粘贴正文…"></textarea></div>
      <button class="btn-primary" id="f-submit" type="button">收进文库</button>
    </div>`;

  $("#f-series").addEventListener("change", (e) => {
    $("#f-newseries-wrap").style.display = e.target.value === "__new__" ? "block" : "none";
  });
  $("#f-fetch").addEventListener("click", onFetch);
  $("#f-submit").addEventListener("click", onSubmit);
}
async function onFetch() {
  const url = $("#f-url").value.trim();
  if (!url) { toast("请先填写链接"); return; }
  const btn = $("#f-fetch"); btn.disabled = true; btn.textContent = "抓取中…";
  try {
    if (!CONFIG.BACKEND) throw new Error("no-api");
    const r = await fetch(CONFIG.API_BASE + "/fetch?url=" + encodeURIComponent(url));
    const d = await r.json();
    $("#f-title").value = d.title || "";
    $("#f-content").value = d.content || "";
    $("#f-note").value = d.authorNote || "";
    if (d.fandom) $("#f-fandom").value = d.fandom;
    if (d.cp) $("#f-cp").value = d.cp;
    if (d.tags) $("#f-tags").value = (d.tags || []).join(", ");
    toast("抓取成功，请检查后提交");
  } catch {
    toast("后端未连接，请手动填写内容");
  } finally {
    btn.disabled = false; btn.textContent = "从链接抓取";
  }
}
async function onSubmit() {
  const title = $("#f-title").value.trim();
  const content = $("#f-content").value.trim();
  if (!title || !content) { toast("标题和正文都不能空"); return; }
  let seriesId = $("#f-series").value;
  let newSeries = null;
  if (seriesId === "__new__") {
    const name = $("#f-newseries").value.trim();
    if (!name) { toast("请填写新合集名称"); return; }
    seriesId = "s_" + Date.now();
    newSeries = { id: seriesId, name, fandom: $("#f-fandom").value.trim(), cp: $("#f-cp").value.trim(), desc: "" };
    DATA.series.push(newSeries);
  }
  const art = {
    id: "a_" + Date.now(),
    title, seriesId: seriesId || null,
    order: parseInt($("#f-order").value || "0", 10),
    fandom: $("#f-fandom").value.trim(),
    cp: $("#f-cp").value.trim(),
    tags: $("#f-tags").value.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    authorNote: $("#f-note").value.trim(),
    cover: "✦",
    source: { type: "manual", url: $("#f-url").value.trim() || "" },
    updatedAt: new Date().toISOString().slice(0, 10),
    content: fmtContent(content)
  };
  try {
    if (CONFIG.BACKEND) {
      await fetch(CONFIG.API_BASE + "/articles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article: art, series: newSeries })
      });
      DATA.articles.push(art);
      toast("已保存并发布");
    } else {
      DATA.articles.push(art);
      toast("已加入本次浏览（Demo 模式，刷新不保留）");
    }
  } catch {
    DATA.articles.push(art);
    toast("已加入（本地），后端保存失败");
  }
  location.hash = "";
}

/* ---------- 导航高亮 ---------- */
function setActive(page) {
  $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.go === page));
}

/* ---------- 启动 ---------- */
(async function init() {
  await loadData();
  setupGate();
  if (sessionStorage.getItem("gate") === "open") openApp();
})();
