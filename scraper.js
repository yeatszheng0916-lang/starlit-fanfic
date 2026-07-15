#!/usr/bin/env node
/**
 * 星屑文库 · 链接抓取脚本（零依赖，Node 18+）
 * 用途：把微博 / Lofter 文章链接抓取为正文 + 排版，输出标准 JSON。
 *
 * 用法：
 *   本地运行，输出 JSON 到控制台：
 *     node scraper.js "https://weibo.com/xxx" 
 *     node scraper.js "https://xxx.lofter.com/post/xxx"
 *
 *   直接合并进 data/articles.json（自动生成 id / 追加）：
 *     node scraper.js "链接" --append
 *
 *   传入登录态 cookie（部分内容需登录才完整）：
 *     node scraper.js "链接" --cookie "SUB=xxxx; ..."
 *
 * 说明：微博 / Lofter 结构会变化，本脚本用通用启发式提取正文，
 *       个别页面可能不完整；更复杂可改用 jsdom / 传入 cookie。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function pick(regex, html, idx = 1) {
  const m = html.match(regex);
  return m ? decode(m[idx]) : '';
}
// 简单 HTML 实体解码
function decode(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/<br\s*\/?>/gi, '\n').replace(/\s*\n\s*\n+/g, '\n').trim();
}
function strip(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '')
             .replace(/<style[\s\S]*?<\/style>/gi, '')
             .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
}
// 提取可见正文段落
function extractParagraphs(html) {
  const clean = strip(html)
    // 去掉常见非正文块
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');
  // 优先抓 <p> 与 <div> 文本块
  const blocks = clean.match(/<(p|div|section|article)[^>]*>([\s\S]*?)<\/\1>/gi) || [];
  let paras = blocks.map((b) => decode(b.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '')))
                    .filter((t) => t && t.length > 1 && !/^[\s\W]*$/.test(t));
  if (paras.length < 2) {
    // 退化方案：按 <br> / 换行拆
    paras = decode(clean).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  }
  return [...new Set(paras)].map((t) => `<p>${t.replace(/\n/g, '<br>')}</p>`).join('');
}
// 尝试识别“作者有话说”
function extractAuthorNote(html) {
  const m = html.match(/(作者有话说|有话说|碎碎念|小剧场|作者的话)[\s：:]*([\s\S]{0,400}?)(?=<\/|<br|$)/i);
  return m ? decode(m[2]).slice(0, 300) : '';
}

async function scrape(url, cookie) {
  const headers = { 'User-Agent': UA };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(url, { headers, redirect: 'follow' });
  const html = await res.text();
  const isLofter = /lofter\.com/.test(url);
  const isWeibo = /weibo\.|weibo\.cn/.test(url);

  let title = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, html)
           || pick(/<title>([\s\S]*?)<\/title>/i, html)
           || '未命名文章';
  let content = extractParagraphs(html);
  let authorNote = extractAuthorNote(html);

  // 微博长文：尝试从内嵌 JSON 取正文
  if (isWeibo) {
    const j = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (j) content = decode(j[1].replace(/\\n/g, '\n')).split(/\n+/).map((p) => `<p>${p}</p>`).join('');
  }
  return { title: title.trim(), content, authorNote, sourceType: isLofter ? 'lofter' : isWeibo ? 'weibo' : 'web', url };
}

function genId() { return 'a_' + Date.now().toString(36); }

(async () => {
  const args = process.argv.slice(2);
  const url = args.find((a) => /^https?:\/\//.test(a));
  const cookie = (args.find((a) => a.startsWith('--cookie=')) || '').replace('--cookie=', '');
  const append = args.includes('--append');
  if (!url) { console.error('用法: node scraper.js <链接> [--append] [--cookie="..."]'); process.exit(1); }

  try {
    const d = await scrape(url, cookie);
    const article = {
      id: genId(),
      title: d.title,
      seriesId: null, order: 0,
      fandom: '', cp: '', tags: [],
      authorNote: d.authorNote,
      cover: '✦',
      source: { type: d.sourceType, url: d.url },
      updatedAt: new Date().toISOString().slice(0, 10),
      content: d.content
    };
    if (append) {
      const file = path.join(__dirname, 'data', 'articles.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.articles.push(article);
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      console.log('已追加到 data/articles.json');
    } else {
      console.log(JSON.stringify(article, null, 2));
    }
  } catch (e) {
    console.error('抓取失败：', e.message);
    process.exit(1);
  }
})();
