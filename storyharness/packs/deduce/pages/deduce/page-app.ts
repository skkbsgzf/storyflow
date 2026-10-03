// 推演舞台 · 客户端 JS（galgame 化 v2）。无模板字面量（外层是 TS 模板串）。
// 消息队列驱动：stimulus 拆 旁白→台词 两条消息，点击推进（打字机），队列走完出选项；
// 采纳后主角台词入队，走完自动推下一拍。分数默认隐藏，「引擎视角」开关才显示综合分。
export const DEDUCE_APP_JS = `
var PID = new URLSearchParams(location.search).get('project') || 'template-推演';
function gotoCase(id){ location.href = '/deduce?project=' + encodeURIComponent(id); }
var AUTO = new URLSearchParams(location.search).get('demo') === '1';   // 自动演示模式（?demo=1）
var S = null;             // 引擎状态
var MQ = [];              // 消息队列 [{speaker, text}]  speaker 空 = 旁白
var MI = 0;               // 当前消息下标
var TYPING = false;       // 打字机进行中
var TTIMER = null;
var AUTO_NEXT = false;    // 队列走完自动推下一拍（采纳后）
var SHOW_SCORES = false;  // 引擎视角
var IMG_INFLIGHT = {};
var KCOL = { '推进': '#c96f4a', '回避': '#5b7fa6', '意外': '#8a6fb0', '自由': '#5f9c7a' };
var LAST_ERR = '';

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function hue(s){ var h=0; s=String(s||''); for(var i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))>>>0; } return h%360; }
function toast(m){ var t=$('toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(function(){ t.classList.remove('show'); }, 3200); }
function api(path, body){
  var url = '/api/deduce/' + path;
  var opts;
  if (path.indexOf('state') === 0) { url += '?project=' + encodeURIComponent(PID); }
  else { opts = { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(Object.assign({ project: PID }, body || {})) }; }
  return fetch(url, opts).then(function(r){ return r.json().then(function(j){
    if (!r.ok || j.error) {
      var e = new Error(j.note ? (j.error + '：' + j.note) : (j.error || ('HTTP ' + r.status)));
      e.code = j.error; throw e;
    }
    return j;
  }); });
}

/* ── 消息队列 / 对话框 ─────────────────────────────── */
function queueFromStimulus(st){
  MQ = []; MI = 0;
  if (st.narration) MQ.push({ speaker:'', text: st.narration });
  MQ.push({ speaker: st.speaker || '', text: st.line });
}
function curMsg(){ return MQ[MI] || null; }
function typeMessage(){
  var m = curMsg();
  var box = $('dlgText'), plate = $('dlgName');
  if (!m) { renderIdle(); return; }
  if (m.speaker) {
    plate.style.display = ''; plate.textContent = m.speaker;
    plate.style.background = 'hsl(' + hue(m.speaker) + ' 45% 38%)';
    box.classList.remove('narr');
    setSprite(m.speaker);
  } else {
    plate.style.display = 'none';
    box.classList.add('narr');
    dimSprite();
  }
  var full = m.text;
  box.textContent = '';
  TYPING = true; $('dlgNext').style.display = 'none';
  var i = 0;
  clearInterval(TTIMER);
  TTIMER = setInterval(function(){
    i += 1;
    box.textContent = full.slice(0, i);
    if (i >= full.length) finishType();
  }, 26);
  function finishType(){
    clearInterval(TTIMER); TYPING = false;
    box.textContent = full;
    var more = MI < MQ.length - 1;
    $('dlgNext').style.display = 'flex';
    $('dlgNext').textContent = more ? '▼' : '⋯';
    if (!more && S && S.pending) setTimeout(function(){
      if (!TYPING && S && S.pending) { if (S.ask) renderProbe(); showChoices(); }
    }, 420);
    else if (!more && AUTO && AUTO_NEXT) setTimeout(function(){ try { advance(); } catch(e){} }, 1100);
  }
}
function advance(){           // 点对话框：开局/完成打字 → 下一条 → 采纳后续拍/出选项
  if (LOADING) return;
  if (S && !S.pending && S.beats.length === 0) { next(); return; }   // 空场：点击即开始
  if (TYPING) { clearInterval(TTIMER); TYPING = false; $('dlgText').textContent = curMsg().text;
    $('dlgNext').style.display = 'flex'; return; }
  if (AUTO_NEXT) { AUTO_NEXT = false; next(); return; }
  if (MI < MQ.length - 1) { MI += 1; typeMessage(); return; }
  if (S && S.pending && !$('choices').classList.contains('show')) { showChoices(); return; }
}
/* ── 舞台渲染 ─────────────────────────────────────── */
function setSprite(name){
  var slot = $('sprite');
  var have = S && S.assets && S.assets.portraits && S.assets.portraits[name];
  var inner = have
    ? '<img src="/api/deduce/asset?project=' + encodeURIComponent(PID) + '&file=portrait-' + encodeURIComponent(name) + '.png" alt="' + esc(name) + '">'
    : '<svg viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="sg' + hue(name) + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="hsl(' + hue(name) + ' 30% 26%)"/><stop offset="1" stop-color="hsl(' + hue(name) + ' 35% 10%)"/>' +
      '</linearGradient></defs>' +
      '<path d="M100 18c-26 0-42 20-42 46 0 16 6 30 15 38-30 10-52 34-58 78l-4 80h178l-4-80c-6-44-28-68-58-78 9-8 15-22 15-38 0-26-16-46-42-46z" fill="url(#sg' + hue(name) + ')" stroke="hsl(' + hue(name) + ' 50% 45% / .5)" stroke-width="1.5"/></svg>';
  if (slot._name !== name || slot._have !== have) {
    slot._name = name; slot._have = have;
    slot.classList.add('swap');
    setTimeout(function(){ slot.innerHTML = inner; slot.classList.remove('swap'); }, 140);
  }
  slot.style.opacity = '1';
}
function dimSprite(){ var s = $('sprite'); s.style.opacity = '0.45'; }
function renderBg(){
  var el = $('bg');
  var h = hue(S ? S.title : '');
  var css = 'radial-gradient(1100px 500px at 70% 18%, hsl(' + h + ' 42% 22% / .55), transparent 60%),' +
            'radial-gradient(900px 600px at 22% 80%, hsl(' + ((h+40)%360) + ' 38% 16% / .5), transparent 65%),' +
            'linear-gradient(160deg, hsl(' + h + ' 30% 9%), hsl(' + ((h+20)%360) + ' 34% 5%))';
  if (S && S.assets && S.assets.bg) {
    var src = '/api/deduce/asset?project=' + encodeURIComponent(PID) + '&file=bg.png';
    if (el._src !== src) { el.innerHTML = '<img src="' + src + '" alt="">'; el._src = src; }
  } else { el.innerHTML = ''; el._src = ''; el.style.background = css; }
}
function renderTop(){
  $('sceneT').textContent = S ? S.title : '';
  $('prog').textContent = '第 ' + (S ? S.beats.length : 0) + ' / ' + (S ? S.targetBeats : '?') + ' 拍';
  $('btnDraft').disabled = !S || S.beats.length < 2;
  $('engView').classList.toggle('on', SHOW_SCORES);
  var b = $('demoBadge'); if (b) b.style.display = AUTO ? '' : 'none';
}
function renderHud(){
  var el = $('hud');
  if (!S || !S.attributes || !Object.keys(S.attributes).length) { el.innerHTML = ''; return; }
  el.innerHTML = Object.keys(S.attributes).map(function(k){
    var v = S.attributes[k];
    var c = v >= 60 ? '#5f9c7a' : (v >= 35 ? '#d9a441' : '#c96f5a');
    return '<span class="hchip" title="' + esc(k) + '">' + esc(k.split('.')[1] || k) + ' <b style="color:' + c + '">' + v + '</b></span>';
  }).join('');
}
function floatFx(applied){
  if (!applied || !Object.keys(applied).length) return;
  var wrap = $('fx');
  Object.keys(applied).forEach(function(k, i){
    var v = applied[k];
    var d = document.createElement('span');
    d.className = 'fdelta ' + (v > 0 ? 'up' : 'down');
    d.textContent = k.split('.')[1] + ' ' + (v > 0 ? '+' : '') + v;
    d.style.right = (30 + i * 90) + 'px';
    wrap.appendChild(d);
    setTimeout(function(){ d.remove(); }, 2400);
  });
  renderHud();
}
function openTree(){
  if (!S || !S.tree) return;
  var byParent = {};
  S.tree.forEach(function(n){ (byParent[n.parent || 'ROOT'] = byParent[n.parent || 'ROOT'] || []).push(n); });
  var html = '';
  function walk(pid, depth){
    (byParent[pid] || []).forEach(function(n){
      var cls = n.onChain ? 'tnode on' : 'tnode';
      html += '<div class="' + cls + '" style="margin-left:' + (depth * 26) + 'px">' +
        '<span class="tmark">' + (n.onChain ? '●' : '○') + '</span>' +
        '<span class="tlabel">第' + n.n + '拍 [' + esc(n.kind) + '] ' + esc(n.text || '') + '</span>' +
        (n.onChain ? '<span class="tnow">当前线</span>' : '<button class="btn" data-node="' + n.id + '">从此重推</button>') +
        '</div>';
      walk(n.id, depth + 1);
    });
  }
  walk('ROOT', 0);
  $('treeBody').innerHTML = html || '<div class="dim2" style="padding:12px">还没有已定拍</div>';
  $('treeOv').classList.add('show');
}
function branchTo(id){
  if (!confirm('切到该节点重推？当前节点之后的支线保留在树上。')) return;
  api('branch', { node: id }).then(function(){ return refresh(); }).then(closeTree).catch(function(e){ toast('切换失败：' + e.message); });
}
function closeTree(){ $('treeOv').classList.remove('show'); }
function openReplay(){
  if (!S) return;
  $('replayTitle').textContent = S.title;
  var h = '<div class="rchap">' + esc(S.premise) + '</div>';
  if (!S.beats.length) h += '<div class="dim2" style="padding:12px">还没有已定拍——先去推演。</div>';
  for (var i = 0; i < S.beats.length; i++) {
    var b = S.beats[i], st = b.stimulus || {};
    if (st.narration) h += '<div class="rnarr">' + esc(st.narration) + '</div>';
    if (st.speaker) h += '<div class="rname" style="background:hsl(' + hue(st.speaker) + ' 45% 38%)">' + esc(st.speaker) + '</div>';
    if (st.line) h += '<div class="rline">「' + esc(st.line) + '」</div>';
    var ch = b.chosen || {};
    h += '<div class="rresp">' + (ch.custom ? '（自写）' : '') + esc(ch.text || '') + (ch.action ? ' <i>（' + esc(ch.action) + '）</i>' : '') + '</div>';
    var fx = Object.keys(b.effects || {});
    if (fx.length) {
      h += '<div class="befx">';
      for (var j = 0; j < fx.length; j++) {
        var v = b.effects[fx[j]];
        h += '<span style="color:' + (v > 0 ? '#7fb98a' : '#d0907e') + '">' + esc(fx[j]) + ' ' + (v > 0 ? '+' : '') + v + '</span>';
      }
      h += '</div>';
    }
  }
  if (S.preferences && S.preferences.length) {
    h += '<div class="sect">你的方向表态</div>';
    for (var p = 0; p < S.preferences.length; p++) h += '<div class="pref">⚡ ' + esc(S.preferences[p]) + '</div>';
  }
  $('replayBody').innerHTML = h;
  $('replayOv').classList.add('show');
  $('replayBody').scrollTop = 0;
}
function downloadNovel(){
  var t = $('draftText').textContent;
  if (!t) { toast('还没有成稿'); return; }
  var head = '# ' + (S ? S.title : '剧情推演') + '\n\n';
  var blob = new Blob([head + t], { type: 'text/markdown;charset=utf-8' });
  var aEl = document.createElement('a');
  aEl.href = URL.createObjectURL(blob);
  aEl.download = (S ? S.title : '剧情推演') + '.md';
  document.body.appendChild(aEl);
  aEl.click();
  aEl.remove();
  toast('已下载 ' + aEl.download);
}
function closeReplay(){ $('replayOv').classList.remove('show'); }
function doSave(){
  var nm = prompt('存档名（记录当前节点）：'); if (!nm || !nm.trim()) return;
  api('save', { name: nm.trim() }).then(function(j){ toast('已存「' + nm.trim() + '」'); if (S) S.bookmarks = j.bookmarks; }).catch(function(e){ toast('存档失败：' + e.message); });
}
function doLoad(){
  var bms = (S && S.bookmarks) || [];
  if (!bms.length) { toast('还没有存档'); return; }
  var pick = prompt('读哪个存档？ [1] ' + bms.join('  [2] ') + ' ——输入序号');
  var idx = Number(pick) - 1;
  if (!pick || !bms[idx]) return;
  api('load', { name: bms[idx] }).then(function(){ return refresh(); }).then(function(){ toast('已读「' + bms[idx] + '」'); }).catch(function(e){ toast('读档失败：' + e.message); });
}
document.addEventListener('click', function(e){
  var b = e.target.closest && e.target.closest('#treeBody [data-node]');
  if (b) branchTo(b.getAttribute('data-node'));
});
function renderIdle(){       // 队列空：开始态 / 推演中 / 无事可做
  var box = $('dlgText'), plate = $('dlgName');
  plate.style.display = 'none'; box.classList.remove('narr');
  $('dlgNext').style.display = 'none';
  if (LOADING) { box.innerHTML = '推演中<span class="dots"><i>.</i><i>.</i><i>.</i></span>'; return; }
  if (S && !S.pending && S.beats.length === 0) {
    box.innerHTML = '引擎已备好本场景。<span class="hintline">' + (AUTO ? '自动演示即将开始' : '点击任意处开始推演') + '</span>';
    if (AUTO) setTimeout(function(){ try { if (window.S && !window.S.pending && window.S.beats.length === 0) next(); } catch(e){} }, 1200);
    return;
  }
  if (S && !S.pending && S.beats.length >= S.targetBeats) { box.innerHTML = '本场已推完 ' + S.beats.length + ' 拍。<span class="hintline">右上 ☰ 收尾成稿</span>'; return; }
  box.innerHTML = '<span class="hintline">点击任意处继续</span>';
}
function renderChoices(){
  var c = $('choices');
  if (!S || !S.pending || MI < MQ.length - 1 || TYPING) { c.classList.remove('show'); return; }
  var p = S.pending;
  c.innerHTML = '<div class="ch-title">' + esc(S.protagonist) + '此刻——</div>' + p.options.map(function(o, i){
    var sc = (SHOW_SCORES && o.score && o.score.composite > 0 && o.score.composite !== 0.5)
      ? '<span class="ch-score">综合 ' + Math.round(o.score.composite * 100) + '</span>' : '';
    return '<button class="ch" data-i="' + i + '" style="animation-delay:' + (i * 90) + 'ms">' +
      '<span class="ch-kind" style="color:' + (KCOL[o.kind] || '#888') + '">' + esc(o.kind) + '</span>' +
      '<span class="ch-text">' + (o.text ? '「' + esc(o.text) + '」' : '（' + esc(o.action) + '）') + '</span>' + sc +
      '<span class="ch-fx">' + Object.keys(o.effects || {}).map(function(k){
        var v = o.effects[k];
        return '<i style="color:' + (v > 0 ? '#7fb98a' : '#d0907e') + '">' + esc(k.split('.')[1]) + ' ' + (v > 0 ? '+' : '') + v + '</i>';
      }).join('') + '</span></button>';  }).join('') +
  '<div class="ch-sub">点击选择 · 数字键 1-4 · <a href="javascript:void(0)" onclick="event.stopPropagation();customOpen()">自己写</a> · <a href="javascript:void(0)" onclick="event.stopPropagation();reroll()">换一批</a></div>';
  if (S.ask) { c.classList.remove('show'); return; }   // 追问优先：先表态再看选项
  c.classList.add('show');
  if (AUTO) setTimeout(function(){ try { if (window.S && window.S.pending && document.getElementById('choices').classList.contains('show')) pickByIndex(0); } catch(e){} }, 2100);
  if (S.gapClose) toast('两条路分数接近——都想要可以采纳后回退重走');
}
function hideChoices(){ $('choices').classList.remove('show'); }
function showChoices(){ renderChoices(); }

function renderAll(){
  renderBg(); renderTop(); renderIdle(); renderChoices(); renderProbe();
  if (S && S.pending) { queueFromStimulus(S.pending.stimulus); MI = 0; typeMessage(); }
}
function renderProbe(){
  var el = $('probe');
  var a = S && S.ask;
  if (!a || !a.paths || !a.paths.length || TYPING || MI < MQ.length - 1) { el.classList.remove('show'); return; }
  $('askQ').textContent = a.question;
  $('askPaths').innerHTML = a.paths.map(function(p, i){
    return '<button class="path" onclick="event.stopPropagation();answerProbe(' + i + ')"><b>' + esc(p.label) + '</b><span>' + esc(p.desc) + '</span></button>';
  }).join('') + '<button class="ghost" style="background:rgba(20,18,26,.9);color:#c9c8d2;border:1px solid rgba(255,255,255,.18);padding:6px 12px" onclick="event.stopPropagation();dismissAsk()">跳过，直接选</button>';
  el.classList.add('show');
  if (AUTO) setTimeout(function(){ try { if (window.S && window.S.ask) answerProbe(0); } catch(e){} }, 1600);
  if (AUTO) setTimeout(function(){ try { if (window.S && window.S.ask) answerProbe(0); } catch(e){} }, 1600);
}

/* ── 面板（角色/剧情/笔记）─────────────────────────── */
var TAB = 'chars';
function openPanel(t){ TAB = t || TAB; renderPanel(); $('panel').classList.add('open'); }
function closePanel(){ $('panel').classList.remove('open'); }
function attrBoard(){
  if (!S || !S.attributes) return [];
  return Object.keys(S.attributes).map(function(k){
    var v = S.attributes[k];
    var d = v - 30;
    return { key: k, attr: k.split('.')[0], who: k.split('.')[1] || '', v: v, d: d };
  });
}
function whoSpeaks(){
  var c = {};
  if (S && S.beats) for (var i = 0; i < S.beats.length; i++) {
    var sp = S.beats[i].stimulus && S.beats[i].stimulus.speaker;
    if (sp) c[sp] = (c[sp] || 0) + 1;
  }
  return c;
}
function renderPanel(){
  if (!S) return;
  document.querySelectorAll('#panel .ptab').forEach(function(b){ b.classList.toggle('on', b.dataset.t === TAB); });
  var el = $('panelBody');
  if (TAB === 'chars') {
    el.innerHTML = S.characters.map(function(c){
      var have = S.assets && S.assets.portraits && S.assets.portraits[c.name];
      var thumb = have
        ? '<img src="/api/deduce/asset?project=' + encodeURIComponent(PID) + '&file=portrait-' + encodeURIComponent(c.name) + '.png">'
        : '<span class="pinit" style="background:hsl(' + hue(c.name) + ' 40% 24%)">' + esc(c.name.slice(0,1)) + '</span>';
      var rel = Object.keys(c.relationships || {}).map(function(r){
        var v = c.relationships[r];
        return '<div class="rel"><b>' + esc(r) + '</b>' + esc(v.stance || '') + (v['暗线'] ? '<i>暗线：' + esc(v['暗线']) + '</i>' : '') + '</div>';
      }).join('');
      return '<div class="ccard"><div class="cthumb">' + thumb + '</div><div class="cmain">' +
        '<div class="cname">' + esc(c.name) + ' <em>' + esc(c.archetype) + '</em>' + (c.name === S.protagonist ? ' <em class="me">主视角</em>' : '') + '</div>' +
        '<div class="cline">' + esc(c.speech_pattern || '') + '</div>' +
        (c.current_arc ? '<div class="cline dim2">弧线：' + esc(c.current_arc) + '</div>' : '') +
        (rel ? '<div class="rels">' + rel + '</div>' : '') +
        (function(){
          var rows = attrBoard().filter(function(r){ return r.who === c.name; })
            .map(function(r){
              var col = r.v >= 60 ? '#7fb98a' : r.v >= 35 ? '#d9a441' : '#d0907e';
              var d = r.d > 0 ? '<em class="up">+' + r.d + '</em>' : r.d < 0 ? '<em class="dn">' + r.d + '</em>' : '';
              return '<div class="abar"><span class="alb">' + esc(r.attr) + '</span>' +
                '<span class="tr"><i style="width:' + r.v + '%;background:' + col + '"></i></span>' +
                '<b style="color:' + col + '">' + r.v + '</b>' + d + '</div>';
            }).join('');
          return rows ? '<div class="aattrs">' + rows + '</div>' : '';
        })() +
        ((c.forbidden || []).length ? '<div class="ftags">' + c.forbidden.map(function(f){ return '<span>禁·' + esc(f) + '</span>'; }).join('') + '</div>' : '') +
        '</div></div>';
    }).join('');
  } else if (TAB === 'plot') {
    var pct = Math.min(100, Math.round(S.beats.length / Math.max(1, S.targetBeats) * 100));
    el.innerHTML = '<div class="premise">' + esc(S.premise) + '</div>' +
      '<div class="pbar"><i style="width:' + pct + '%"></i><span>' + S.beats.length + ' / ' + S.targetBeats + ' 拍</span></div>' +
      (S.preferences && S.preferences.length ? '<div class="sect">你的表态（回灌推演）</div>' + S.preferences.map(function(p){ return '<div class="pref">⚡ ' + esc(p) + '</div>'; }).join('') : '') +
      '<div class="sect">已定拍</div>' +
      (S.beats.length ? S.beats.map(function(b){
        var st = (b.stimulus.narration ? b.stimulus.narration + ' ' : '') + (b.stimulus.speaker ? b.stimulus.speaker + '：' : '') + b.stimulus.line;
        return '<div class="beat"><i>' + b.n + '</i><div><p>' + esc(st) + '</p><em>' +
          (b.chosen.custom ? '（自写）' : '') + esc(b.chosen.text || '') + (b.chosen.action ? '（' + esc(b.chosen.action) + '）' : '') + '</em>' +
          (function(){
            var fx = Object.keys(b.effects || {}).map(function(k){
              var v = b.effects[k];
              return '<span style="color:' + (v > 0 ? '#7fb98a' : '#d0907e') + '">' + esc(k) + ' ' + (v > 0 ? '+' : '') + v + '</span>';
            }).join(' ');
            return fx ? '<div class="befx">' + fx + '</div>' : '';
          })() + '</div></div>';
      }).join('') : '<div class="dim2" style="padding:8px 2px">还没有已定拍</div>');
  } else {
    el.innerHTML = '<textarea id="noteTa" placeholder="随手记：伏笔、要回收的刀、下一场想试的方向……（自动保存）">' + esc(S.notes || '') + '</textarea><div class="nsave" id="nsave"></div>';
    var ta = $('noteTa');
    ta.addEventListener('input', function(){
      clearTimeout(ta._h);
      ta._h = setTimeout(function(){
        api('notes', { text: ta.value }).then(function(){ $('nsave').textContent = '已保存 ' + new Date().toLocaleTimeString(); if (S) S.notes = ta.value; }).catch(function(e){ $('nsave').textContent = '保存失败：' + e.message; });
      }, 900);
    });
  }
}
/* ── 生图（懒加载，不阻塞推演）───────────────────────── */
function requestAssets(){
  if (!S || !S.imageBackend || S.imageBackend === 'off') return;
  var want = [];
  if (!S.assets.bg) want.push({ kind: 'bg' });
  (S.characters || []).forEach(function(c){ if (!(S.assets.portraits && S.assets.portraits[c.name])) want.push({ kind: 'portrait', name: c.name }); });
  want.forEach(function(w){
    var key = w.kind + ':' + (w.name || '');
    if (IMG_INFLIGHT[key]) return;
    IMG_INFLIGHT[key] = true;
    api('image', w).then(function(){
      delete IMG_INFLIGHT[key];
      if (!S.assets) S.assets = { bg: false, portraits: {} };
      if (w.kind === 'bg') { S.assets.bg = true; renderBg(); }
      else {
        S.assets.portraits[w.name] = true;
        var cur = curMsg();
        if (cur && cur.speaker === w.name) setSprite(w.name);
        if (TAB === 'chars') renderPanel();
      }
    }).catch(function(e){
      delete IMG_INFLIGHT[key];
      if (!LAST_ERR) { LAST_ERR = e.message; toast('生图未就绪（' + e.message.slice(0, 60) + '）——先用占位形象'); }
    });
  });
}

/* ── 动作 ────────────────────────────────────────── */
var LOADING = false;
function setLoading(v){ LOADING = v; if (v || MI >= MQ.length) renderIdle(); }
function setState(j){
  S = j; MQ = []; MI = 0; AUTO_NEXT = false;
  hideChoices(); renderAll(); renderHud(); requestAssets();
}
function renderBootErr(m){
  var box = $('dlgText'), plate = $('dlgName');
  plate.style.display = 'none'; box.classList.remove('narr');
  $('dlgNext').style.display = 'none';
  box.innerHTML = '加载失败：' + esc(m) + '　<a href="javascript:void(0)" onclick="refresh()" style="color:#d9b96a">重试</a>';
}
function refresh(){ return api('state').then(function(j){ setState(j); }).catch(function(e){
    if (e.code === 'NO_SCRIPT') { renderNoScript(); return; }
    renderBootErr(e.message);
  }); }
function next(){
  if (LOADING) return;
  hideChoices();
  setLoading(true);
  api('next').then(function(j){ setLoading(false); setState(j); }).catch(function(e){
    setLoading(false);
    if (e.code === 'NO_SCRIPT' || e.message.indexOf('NO_SCRIPT|') === 0) { renderNoScript(); return; }
    toast('推演失败：' + e.message); renderIdle();
  });
}
function pickByIndex(i){
  var o = S.pending.options[i]; if (!o) return;
  hideChoices();
  api('choose', { id: o.id }).then(function(j){
    if (S) S.pending = null;
    floatFx(j.applied);          // 乐观清空：主角台词入队时不回弹选项
    MQ.push({ speaker: S ? S.protagonist : '', text: (o.text ? o.text : '') + (o.action ? '（' + o.action + '）' : '') });
    MI = MQ.length - 1; AUTO_NEXT = true; typeMessage();
  }).catch(function(e){ toast('采纳失败：' + e.message); });
}
function customOpen(){
  var v = prompt('自己写一句（' + (S ? S.protagonist : '') + '的台词/动作）：');
  if (!v || !v.trim()) return;
  hideChoices();
  api('choose', { custom: v.trim() }).then(function(){
    if (S) S.pending = null;
    MQ.push({ speaker: S ? S.protagonist : '', text: v.trim() });
    MI = MQ.length - 1; AUTO_NEXT = true; typeMessage();
  }).catch(function(e){ toast('采纳失败：' + e.message); });
}
function reroll(){
  hideChoices();
  api('rollback').then(function(){ return api('next'); }).then(setState).catch(function(e){ toast('重推失败：' + e.message); refresh(); });
}
function rollback(){
  api('rollback').then(refresh).catch(function(e){ toast('回退失败：' + e.message); });
}
function answerProbe(i){ api('probe', { pick: i }).then(function(){
  if (S) { S.ask = null; if (S.pending) S.pending.probe = null; }   // 两处都清：renderProbe 读 S.ask
  renderProbe(); if (S && S.pending) showChoices();
}).catch(function(e){ toast(e.message); }); }
function dismissAsk(){ if (S) S.ask = null; $('probe').classList.remove('show'); if (S && S.pending) showChoices(); }
function doDraft(){
  api('draft').then(function(j){
    $('draftText').textContent = j.text; $('draftFile').textContent = '已存 ' + j.file;
    $('mdraft').classList.add('show');
  }).catch(function(e){ toast('成稿失败：' + e.message); });
}
function doReset(){
  if (!confirm('本场推演归档重开？（已推拍序列存入 推演/runs/）')) return;
  api('reset').then(refresh).catch(function(e){ toast('重置失败：' + e.message); });
}
/* ── 导入（小说/设定 → 新剧本）──────────────────────── */
function openImport(){ $('mitab-n').classList.add('on'); $('mitab-s').classList.remove('on'); $('importTa').value = ''; $('importBeats').value = '10'; $('mimport').classList.add('show'); }
function importTab(m){ $('mitab-n').classList.toggle('on', m === 'novel'); $('mitab-s').classList.toggle('on', m === 'settings'); $('importMode').value = m; }
function doImport(){
  var text = $('importTa').value.trim();
  if (text.length < 50) { toast('至少粘贴 50 字'); return; }
  if (S && !confirm('导入将替换当前剧本并清空本场推演（旧本自动归档）。继续？')) return;
  $('importGo').disabled = true; $('importGo').textContent = '提炼中…';
  api('import', { mode: $('importMode').value, text: text, target_beats: Number($('importBeats').value) || 10 })
    .then(function(){ $('mimport').classList.remove('show'); $('importGo').disabled = false; $('importGo').textContent = '生成剧本，开始推演 →'; toast('剧本已生成'); IMG_INFLIGHT = {}; LAST_ERR = ''; return refresh(); })
    .catch(function(e){ $('importGo').disabled = false; $('importGo').textContent = '生成剧本，开始推演 →'; toast('提炼失败：' + e.message); });
}
function renderNoScript(){
  S = null;
  $('stage').classList.add('noscript');
  renderBg();
  $('dlgName').style.display = 'none';
  $('dlgText').innerHTML = '';
  $('noscript').classList.add('show');
  $('prog').textContent = '未建剧本';
}
/* ── 全局事件 ─────────────────────────────────────── */
document.addEventListener('click', function(e){
  if (e.target.closest('#panel, #topbar, #choices, #probe, .modal, #dlg .noadv')) return;
  if (!$('dlg').offsetParent && document.getElementById('noscript').classList.contains('show')) return;
  advance();
});
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') { closePanel(); document.querySelectorAll('.modal').forEach(function(m){ m.classList.remove('show'); }); hideChoices(); if (S && S.pending) renderChoices(); return; }
  if (e.target.matches('textarea, input')) return;
  if (S && S.pending && $('choices').classList.contains('show') && /^[1-4]$/.test(e.key)) { pickByIndex(Number(e.key) - 1); return; }
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); }
});
function choicesDelegate(e){
  var b = e.target.closest('.ch');
  if (b) { e.stopPropagation(); pickByIndex(Number(b.dataset.i)); }
}
`;
