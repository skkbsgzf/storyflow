#!/usr/bin/env node
// 把 data/ 下的咔咔猩快照渲染成单文件 browse.html（数据内嵌，双击即可离线浏览）
// 用法：node build-viewer.mjs   （抓取脚本刷新数据后重跑一次即可）

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dirname;
const DATA = join(DIR, 'data');

const readJsonl = (f) => readFileSync(join(DATA, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const scripts = readJsonl('scriptrawstone.jsonl');
const comments = readJsonl('scriptcomment.jsonl');
const films = readJsonl('shortfilm.jsonl');
const writers = readJsonl('scriptwriter.jsonl');
const taxonomy = JSON.parse(readFileSync(join(DATA, 'queryConditions.json'), 'utf8'));
let news = [];
try { news = JSON.parse(readFileSync(join(DATA, 'news.json'), 'utf8')); } catch { /* 可选 */ }

// 瘦身：丢掉噪音字段与 null
const SLIM_SCRIPT = ({ requestId, scriptRawstoneChatId, businessStatus, memberId, purchaseTime,
  scriptRawstoneQuotaOrderNo, topSummary, scriptTheme, scriptProduct, isCollected, purchaseType,
  scriptOutlineTokennumber, scriptWorldSettingTokennumber, dialogueRatio, scriptRawstoneId: id, ...keep }) =>
  Object.fromEntries(Object.entries({ id, ...keep }).filter(([, v]) => v !== null && v !== '' && v !== undefined));
const slimScripts = scripts.map(SLIM_SCRIPT);

const genres = (taxonomy.scriptGenres ?? []).map((g) => g.name);
const hotNum = (s) => { const m = /^([\d.]+)([w亿万kK]?)$/.exec(String(s ?? '').trim()); if (!m) return 0;
  const n = parseFloat(m[1]); const u = m[2]; return n * (u === '亿' ? 1e8 : u === 'w' || u === '万' ? 1e4 : u.toLowerCase() === 'k' ? 1e3 : 1); };
const pointsNum = (s) => parseInt(String(s ?? '').replace(/[^0-9]/g, ''), 10) || 0;

// 平台会隔几天把同名剧换新 ID 重新上架（评分/字数微调的新版本）。
// 数据层保留全部上架记录（JSONL 忠实快照），展示层按 剧名+市场 折叠，只保留最新版。
const latest = new Map();
for (const s of slimScripts) {
  const k = `${s.scriptName}|${s.regionType}`;
  const prev = latest.get(k);
  const newer = !prev || (s.createTime || '') > (prev.createTime || '')
    || (s.createTime === prev.createTime && Number(s.id) > Number(prev.id));
  if (newer) latest.set(k, s);
}
const dedupedScripts = [...latest.values()];
const relistedCount = slimScripts.length - dedupedScripts.length;
console.log(`剧本 ${slimScripts.length} 条，折叠重复上架 ${relistedCount} 条，展示 ${dedupedScripts.length} 部`);

const DB = { scripts: dedupedScripts, comments, films, writers, news, genres };
const dbJson = JSON.stringify(DB).replace(/</g, '\\u003c');

const CSS = `
:root{--bg:#0f1115;--panel:#171a21;--card:#1c2029;--line:#2a2f3a;--txt:#e8eaf0;--sub:#9aa3b2;--acc:#7c9cff;--gold:#e8b34b;--green:#5ec269;--red:#e06c6c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}
header{padding:18px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:9}
h1{font-size:18px;margin:0 0 4px}.muted{color:var(--sub);font-size:12px}
.stats{display:flex;gap:18px;margin-top:8px;flex-wrap:wrap;font-size:12px;color:var(--sub)}
.stats b{color:var(--txt);font-size:15px;margin-right:3px}
.tabs{display:flex;gap:6px;margin:12px 0 0;flex-wrap:wrap}
.tabs button{background:var(--panel);color:var(--sub);border:1px solid var(--line);padding:6px 16px;border-radius:8px;cursor:pointer;font-size:13px}
.tabs button.on{background:var(--acc);color:#fff;border-color:var(--acc)}
main{padding:16px 24px 60px}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.bar input[type=text]{flex:1;min-width:200px;background:var(--panel);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:7px 12px}
.bar select{background:var(--panel);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:7px 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;cursor:pointer;transition:transform .12s,border-color .12s}
.card:hover{transform:translateY(-2px);border-color:var(--acc)}
.cover{position:relative;aspect-ratio:3/4;background:#22262f}
img{opacity:0;transition:opacity .25s}
img.ok{opacity:1}
.cover img{width:100%;height:100%;object-fit:cover}
.badges{position:absolute;top:8px;left:8px;display:flex;gap:6px}
.bd{font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(15,17,21,.82);border:1px solid var(--line)}
.bd.gold{color:var(--gold);border-color:var(--gold);font-weight:600}
.cb{position:absolute;bottom:8px;right:8px;background:rgba(15,17,21,.82);border-radius:8px;padding:2px 8px;font-size:12px;color:var(--gold)}
.cb2{position:absolute;bottom:8px;left:8px;background:rgba(15,17,21,.82);border-radius:8px;padding:2px 8px;font-size:12px;color:var(--red)}
.cbody{padding:10px 12px 12px}
.ttl{font-weight:600;font-size:14px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.en{font-size:11px;color:var(--sub);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:4px}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
.tag{font-size:11px;color:var(--acc);background:rgba(124,156,255,.12);border-radius:4px;padding:1px 6px}
.log{color:var(--sub);font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px}
.meta{display:flex;gap:10px;font-size:11px;color:var(--sub);margin-top:8px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--sub);font-weight:500;font-size:12px;position:sticky;top:0;background:var(--panel)}
tr:hover td{background:rgba(124,156,255,.06)}
.pager{display:flex;gap:8px;align-items:center;justify-content:center;margin:20px 0 0}
.pager button{background:var(--panel);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:6px 14px;cursor:pointer}
.pager button:disabled{opacity:.4;cursor:default}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;z-index:50;overflow:auto;padding:40px 16px}
.sheet{max-width:860px;margin:0 auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.sheet .hd{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)}
.sheet .hd h2{margin:0;font-size:16px}
.sheet .x{background:none;border:none;color:var(--sub);font-size:20px;cursor:pointer}
.sheet .bd2{display:flex;gap:18px;padding:18px;flex-wrap:wrap}
.sheet .bd2 img{width:180px;border-radius:10px;align-self:flex-start}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px;flex:1;min-width:260px}
.kv span:nth-child(odd){color:var(--sub)}
.plan{padding:0 18px 20px}
.plan h3{font-size:14px;color:var(--gold);margin:0 0 8px}
.plan .blk{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:8px;white-space:pre-wrap;font-size:13px}
.plan .blk b{color:var(--acc)}
.empty{text-align:center;color:var(--sub);padding:60px 0}
a{color:var(--acc)}
.thumb{width:44px;height:60px;object-fit:cover;border-radius:6px;display:block}
`;

const PAGE_JS = `
const DB = JSON.parse(document.getElementById('DB').textContent);
const $ = (s) => document.querySelector(s);
// 图片加载完成后淡入（捕获阶段，覆盖动态插入的 img），加载失败隐藏
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); }, true);
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.style.display = 'none'; }, true);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const REGION = { CN: '国内', NA: '北美' }, CHAR = { live: '真人', animation: 'AIGC' }, CAT = { F: '女频', M: '男频' };
const hotN = (s) => { const m = /^([\\d.]+)([w亿万kK]?)$/.exec(String(s ?? '').trim()); if (!m) return 0;
  const n = parseFloat(m[1]), u = m[2]; return n * (u === '亿' ? 1e8 : (u === 'w' || u === '万') ? 1e4 : u.toLowerCase() === 'k' ? 1e3 : 1); };
const ptsN = (s) => parseInt(String(s ?? '').replace(/[^0-9]/g, ''), 10) || 0;

let state = { q: '', region: '', cat: '', char: '', grade: '', genre: '', sort: 'date', page: 1 };
const PER = 60;

function filtered() {
  const q = state.q.trim().toLowerCase();
  let rows = DB.scripts.filter((s) => {
    if (state.region && s.regionType !== state.region) return false;
    if (state.cat && s.scriptCategory !== state.cat) return false;
    if (state.char && s.characterType !== state.char) return false;
    if (state.grade && s.scriptGrade !== state.grade) return false;
    if (state.genre && !String(s.scriptGenres || '').split(',').includes(state.genre)) return false;
    if (q) {
      const hay = (s.scriptName + ' ' + s.topName + ' ' + s.logline + ' ' + s.scriptGenres + ' ' + s.scriptThemeAi + ' ' + s.topHot).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by = {
    date: (a, b) => (b.createTime || '').localeCompare(a.createTime || ''),
    score: (a, b) => (+b.scriptScore || 0) - (+a.scriptScore || 0),
    hot: (a, b) => hotN(b.topHot) - hotN(a.topHot),
    points: (a, b) => ptsN(b.takePoints) - ptsN(a.takePoints),
    words: (a, b) => (+b.tokenNumber || 0) - (+a.tokenNumber || 0),
  }[state.sort];
  return rows.sort(by);
}

function chip(v) { return v ? '<span class="tag">' + esc(v) + '</span>' : ''; }

function scriptCard(s) {
  const img = s.topImage || s.scriptImageUrl || '';
  const cover = img
    ? '<div class="cover"><img loading="lazy" src="' + esc(img) + '">'
      + '<div class="badges"><span class="bd gold">' + esc(s.scriptGrade || '') + '</span><span class="bd">' + esc(s.scriptScore || '') + '分</span></div>'
      + (s.topHot ? '<div class="cb">🔥 ' + esc(s.topHot) + '</div>' : '')
      + '<div class="cb2">' + esc(s.takePoints || '') + ' 积分</div></div>'
    : '<div class="cover"></div>';
  return '<div class="card" data-id="' + esc(s.id) + '">' + cover + '<div class="cbody">'
    + '<div class="ttl">' + esc(s.scriptName || s.topName) + '</div>'
    + (s.topName && s.topName !== s.scriptName ? '<div class="en">' + esc(s.topName) + '</div>' : '')
    + '<div class="tags">' + chip(CAT[s.scriptCategory]) + chip(REGION[s.regionType]) + chip(CHAR[s.characterType])
    + chip(s.episodeNumber ? s.episodeNumber + '集' : '') + chip(s.tokenNumber ? s.tokenNumber + '万字' : '') + '</div>'
    + '<div class="tags">' + String(s.scriptGenres || '').split(',').slice(0, 4).map(chip).join('') + '</div>'
    + '<div class="log">' + esc(s.logline || '') + '</div>'
    + '<div class="meta"><span>' + esc((s.createTime || '').slice(0, 10)) + '</span>'
    + (s.episodeDurationMax ? '<span>单集≤' + esc(s.episodeDurationMax) + '分钟</span>' : '') + '</div>'
    + '</div></div>';
}

function renderScripts() {
  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  if (state.page > pages) state.page = pages;
  const slice = rows.slice((state.page - 1) * PER, state.page * PER);
  $('#count').textContent = '命中 ' + rows.length + ' / ' + DB.scripts.length + ' 部';
  $('#grid').innerHTML = slice.length ? slice.map(scriptCard).join('') : '<div class="empty">没有匹配的剧本</div>';
  $('#pager').style.display = pages > 1 ? 'flex' : 'none';
  $('#pg').textContent = state.page + ' / ' + pages;
  $('#prev').disabled = state.page <= 1; $('#next').disabled = state.page >= pages;
}

function planBlocks(plan) {
  if (!plan) return '<div class="empty">无策划案</div>';
  const lines = String(plan).split(/\\n+/).map((l) => l.trim()).filter(Boolean);
  return lines.map((l) => {
    const m = /^([0-9一二三四五六七八九十]+)\\s*[、.．]\\s*(.+)$/.exec(l);
    if (m) return '<div class="blk"><b>' + esc(m[1] + '、 ' + m[2].slice(0, 6)) + '</b>' + esc(m[2].slice(6)) + '</div>';
    return '<div class="blk">' + esc(l) + '</div>';
  }).join('');
}

function openScript(id) {
  const s = DB.scripts.find((x) => String(x.id) === String(id));
  if (!s) return;
  const img = s.topImage || s.scriptImageUrl || '';
  const kv = [
    ['剧名', s.scriptName], ['英文/策划名', s.topName], ['频道', CAT[s.scriptCategory] || s.scriptCategory],
    ['市场', REGION[s.regionType] || s.regionType], ['形态', CHAR[s.characterType] || s.characterType],
    ['AI 题材', s.scriptThemeAi], ['原始标签', s.scriptGenres], ['评分/评级', (s.scriptScore ?? '') + ' / ' + (s.scriptGrade ?? '')],
    ['热度', s.topHot], ['售价', (s.takePoints ?? '') + ' 积分'], ['集数', s.episodeNumber],
    ['单集时长', s.episodeDurationMin && s.episodeDurationMax ? s.episodeDurationMin + '-' + s.episodeDurationMax + ' 分钟' : ''],
    ['总字数', s.tokenNumber && s.tokenNumber + ' 万'], ['单集字数上限', s.wordCountLimit],
    ['主要演员≤', s.actorNumberMax], ['场景数≤', s.sceneNumberMax], ['台词密度', s.dialogueDensity],
    ['输出语言', s.outputLanguage], ['对标匹配度', s.scriptMatchingDegree], ['上架时间', s.createTime],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => '<span>' + k + '</span><span>' + esc(v) + '</span>').join('');
  $('#sheetBody').innerHTML =
    '<div class="bd2">' + (img ? '<img src="' + esc(img) + '">' : '')
    + '<div class="kv">' + kv + '</div></div>'
    + '<div class="plan"><h3>策划案 topPlanning</h3>' + planBlocks(s.topPlanning) + '</div>';
  $('#sheetTitle').textContent = s.scriptName || s.topName || '';
  $('#overlay').style.display = 'block';
}

function renderComments() {
  $('#view-comments').innerHTML = '<table><thead><tr><th>封面</th><th>剧本</th><th>评级</th><th>评分</th><th>题材</th><th>频道</th><th>形态</th><th>来源</th><th>免费</th><th>时间</th><th>提交人</th></tr></thead><tbody>'
    + DB.comments.map((c) => '<tr><td>' + (c.scriptPictureUrl ? '<img class="thumb" loading="lazy" src="' + esc(c.scriptPictureUrl) + '">' : '') + '</td>'
      + '<td>' + esc(c.scriptName) + '</td><td><b>' + esc(c.scriptGrade) + '</b></td><td>' + esc(c.scriptScore) + '</td>'
      + '<td>' + esc(c.scriptTheme) + '</td><td>' + esc(c.scriptTypeAi) + '</td><td>' + esc(CHAR[c.characterType] || c.characterType) + '</td>'
      + '<td>' + esc(c.scriptSrc) + '</td><td>' + esc(c.freePaid) + '</td><td>' + esc(c.releaseTime) + '</td><td>' + esc(c.memberNickname) + '</td></tr>').join('')
    + '</tbody></table>';
}

function renderFilms() {
  $('#view-films').innerHTML = '<table><thead><tr><th>封面</th><th>标题</th><th>梗概</th><th>分镜</th><th>时长(s)</th><th>比例</th><th>时间</th><th>作者</th><th>视频</th></tr></thead><tbody>'
    + DB.films.map((f) => '<tr><td>' + (f.scriptPictureUrl ? '<img class="thumb" loading="lazy" src="' + esc(f.scriptPictureUrl) + '">' : '') + '</td>'
      + '<td>' + esc(f.videoTitle) + '</td><td style="max-width:320px">' + esc(f.contentSummary) + '</td>'
      + '<td>' + esc(f.storyboardNumber) + '</td><td>' + esc(Math.round(f.videoDuration || 0)) + '</td><td>' + esc(f.videoRatio) + '</td>'
      + '<td>' + esc(f.releaseTime) + '</td><td>' + esc(f.memberNickname) + '</td>'
      + (f.videoPath ? '<td><a href="' + esc(f.videoPath) + '" target="_blank">观看</a></td>' : '<td></td>') + '</tr>').join('')
    + '</tbody></table>';
}

function renderWriters() {
  const SVC = { 1: '剧本创作', 2: '剧本评估', 3: '剧本修改', 4: '剧本代写' };
  $('#view-writers').innerHTML = '<table><thead><tr><th>编剧</th><th>城市</th><th>星级</th><th>频道</th><th>形态</th><th>市场</th><th>最高评分</th><th>报价(元)</th><th>推荐</th></tr></thead><tbody>'
    + DB.writers.map((w) => '<tr><td><b>' + esc(w.realName || w.otherName) + '</b></td><td>' + esc(w.city) + '</td><td>' + esc(w.writerStar) + '★</td>'
      + '<td>' + esc(w.scriptCategory) + '</td><td>' + esc(String(w.characterType || '').split(',').map((c) => CHAR[c] || c).join('/')) + '</td>'
      + '<td>' + esc(String(w.regionType || '').split(',').map((r) => REGION[r] || r).join('/')) + '</td><td>' + esc(w.scriptScore) + '</td>'
      + '<td>' + esc(w.servicePriceFrom) + ' - ' + esc(w.servicePriceTo) + '</td><td>' + (w.isRecommend ? 'No.' + esc(w.recommendRank) : '') + '</td></tr>').join('')
    + '</tbody></table>';
}

function renderNews() {
  $('#view-news').innerHTML = DB.news.map((n) =>
    '<div class="card" style="padding:14px 18px;margin-bottom:10px"><div class="ttl">' + esc(n.ftopic) + '</div>'
    + '<div class="muted" style="margin:6px 0">' + esc(n.fauthor) + ' · ' + esc(n.ftime || n.createTime || '') + '</div>'
    + '<div class="log" style="-webkit-line-clamp:4">' + esc(n.faiSummary) + '</div>'
    + (n.flink ? '<div style="margin-top:8px"><a href="' + esc(n.flink) + '" target="_blank">查看原文 →</a></div>' : '') + '</div>').join('');
}

function show(tab) {
  for (const t of ['scripts', 'comments', 'films', 'writers', 'news']) {
    $('#view-' + t).style.display = t === tab ? '' : 'none';
    $('#tab-' + t).classList.toggle('on', t === tab);
  }
  $('#bar').style.display = tab === 'scripts' ? 'flex' : 'none';
}

// 组装筛选器
const genreSel = DB.genres.map((g) => '<option>' + esc(g) + '</option>').join('');
$('#f-genre').innerHTML = '<option value="">全部题材</option>' + genreSel;
const bind = (id, key) => $(id).addEventListener('change', (e) => { state[key] = e.target.value; state.page = 1; renderScripts(); });
bind('#q', 'q'); $('#q').addEventListener('input', (e) => { state.q = e.target.value; state.page = 1; renderScripts(); });
bind('#f-region', 'region'); bind('#f-cat', 'cat'); bind('#f-char', 'char'); bind('#f-grade', 'grade'); bind('#f-genre', 'genre'); bind('#f-sort', 'sort');
$('#prev').onclick = () => { state.page--; renderScripts(); };
$('#next').onclick = () => { state.page++; renderScripts(); };
$('#grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card'); if (card && card.dataset.id) openScript(card.dataset.id);
});
$('#sheetClose').onclick = () => { $('#overlay').style.display = 'none'; };
$('#overlay').addEventListener('click', (e) => { if (e.target === $('#overlay')) $('#overlay').style.display = 'none'; });
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => show(b.dataset.tab));

renderScripts(); renderComments(); renderFilms(); renderWriters(); renderNews(); show('scripts');
`;

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>咔咔猩数据快照 · 浏览器</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>咔咔猩（kakaxing.com）公开数据快照 <span class="muted">/ 本地离线浏览</span></h1>
  <div class="stats">
    <span><b>${dedupedScripts.length}</b>剧本</span><span><b>${writers.length}</b>编剧</span>
    <span><b>${comments.length}</b>评剧本</span><span><b>${films.length}</b>拉片</span><span><b>${news.length}</b>快讯</span>
    <span class="muted">抓取时间：${new Date().toISOString().slice(0, 10)} · 已折叠 ${relistedCount} 条平台重复上架（保留最新版） · 原始明细见 data/ 目录</span>
  </div>
  <div class="tabs">
    <button id="tab-scripts" data-tab="scripts" class="on">剧本市场</button>
    <button id="tab-comments" data-tab="comments">评剧本</button>
    <button id="tab-films" data-tab="films">拉片</button>
    <button id="tab-writers" data-tab="writers">编剧</button>
    <button id="tab-news" data-tab="news">快讯</button>
  </div>
</header>
<main>
  <div id="bar" class="bar">
    <input id="q" type="text" placeholder="搜索 剧名 / 卖点 / 题材 / 热度…">
    <select id="f-region"><option value="">全部市场</option><option value="CN">国内</option><option value="NA">北美</option></select>
    <select id="f-cat"><option value="">全部频道</option><option value="F">女频</option><option value="M">男频</option></select>
    <select id="f-char"><option value="">全部形态</option><option value="live">真人</option><option value="animation">AIGC</option></select>
    <select id="f-grade"><option value="">全部评级</option><option>S</option><option>A+</option><option>A</option></select>
    <select id="f-genre"></select>
    <select id="f-sort">
      <option value="date">最新上架</option><option value="score">评分最高</option>
      <option value="hot">热度最高</option><option value="points">售价最高</option><option value="words">字数最多</option>
    </select>
    <span id="count" class="muted"></span>
  </div>
  <div id="view-scripts">
    <div id="grid" class="grid"></div>
    <div id="pager" class="pager"><button id="prev">上一页</button><span id="pg" class="muted"></span><button id="next">下一页</button></div>
  </div>
  <div id="view-comments" style="display:none"></div>
  <div id="view-films" style="display:none"></div>
  <div id="view-writers" style="display:none"></div>
  <div id="view-news" style="display:none"></div>
</main>
<div id="overlay" class="overlay"><div class="sheet">
  <div class="hd"><h2 id="sheetTitle"></h2><button id="sheetClose" class="x">✕</button></div>
  <div id="sheetBody"></div>
</div></div>
<script id="DB" type="application/json">${dbJson}</script>
<script>${PAGE_JS}</script>
</body>
</html>`;

writeFileSync(join(DIR, 'browse.html'), HTML);
console.log(`✅ browse.html 生成完毕：${(HTML.length / 1024 / 1024).toFixed(1)} MB，含 ${slimScripts.length} 部剧本等 5 个数据集`);
