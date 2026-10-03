// 推演舞台页面（galgame 化 v2）· 单文件自包含，/deduce 直出，API 同源 /api/deduce/*。
// 结构：deduce-page.ts = 壳（HTML+CSS）；deduce-page-app.ts = 客户端 JS。
// 口径：打分=建议面（默认隐藏，右上「引擎视角」才显示综合分）；成稿/笔记是产物，分数/标签只活在推演层。
import { DEDUCE_APP_JS } from "./page-app.js";

export const DEDUCE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>剧情推演 · StoryHarness</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent }
  html,body { height:100%; overflow:hidden }
  body { background:#0a0a10; color:#ece9e2; font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif; user-select:none }
  #stage { position:fixed; inset:0; overflow:hidden }
  #bg { position:absolute; inset:0; background:#101018; transition:opacity .5s }
  #bg img { width:100%; height:100%; object-fit:cover; opacity:.85 }
  #vig { position:absolute; inset:0; pointer-events:none;
    background:radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(5,5,10,.72) 100%),
               linear-gradient(rgba(5,5,10,.25), transparent 30%, transparent 62%, rgba(5,5,10,.6)) }
  #sprite { position:absolute; bottom:0; left:50%; transform:translateX(-58%); height:72vh; max-height:640px; aspect-ratio:200/260;
    transition:opacity .45s, filter .45s; pointer-events:none; filter:drop-shadow(0 18px 40px rgba(0,0,0,.6)) }
  #sprite img { width:100%; height:100%; object-fit:contain; object-position:bottom; mix-blend-mode:screen }
  #sprite svg { width:100%; height:100% }
  #sprite.swap { opacity:0 !important; transform:translateX(-58%) translateY(8px) }
  /* 顶栏 */
  #topbar { position:absolute; top:0; left:0; right:0; display:flex; align-items:center; gap:10px; padding:12px 16px; z-index:20 }
  #topbar .mark { font-weight:700; letter-spacing:3px; font-size:15px; text-shadow:0 1px 8px rgba(0,0,0,.8) }
  #topbar .scene { color:#b9b7c2; font-size:13px; text-shadow:0 1px 6px rgba(0,0,0,.9) }
  #prog { font-size:12px; color:#a9a7b4; border:1px solid rgba(255,255,255,.16); border-radius:99px; padding:0 10px; background:rgba(10,10,16,.4) }
  #topbar .sp { flex:1 }
  .tbtn { font:12.5px/1 inherit; color:#d8d6df; background:rgba(12,12,20,.55); border:1px solid rgba(255,255,255,.14);
    border-radius:99px; padding:6px 13px; cursor:pointer; backdrop-filter:blur(6px) }
  .tbtn:hover { border-color:hsl(var(--hue,40) 60% 55% / .8); color:#fff }
  .tbtn.on { background:hsl(40 60% 40% / .25); border-color:hsl(40 60% 55% / .7); color:#f5e9c8 }
  /* 对话框 */
  #dlg { position:absolute; left:50%; bottom:26px; transform:translateX(-50%); width:min(920px, 94vw); min-height:112px;
    background:rgba(10,10,17,.78); border:1px solid rgba(255,255,255,.14); border-radius:16px;
    padding:20px 26px 16px; backdrop-filter:blur(10px); cursor:pointer; z-index:15;
    box-shadow:0 18px 60px rgba(0,0,0,.55) }
  #dlgName { position:absolute; top:-15px; left:22px; font-size:13.5px; font-weight:600; letter-spacing:1px;
    padding:3px 16px; border-radius:8px; color:#fff; box-shadow:0 4px 14px rgba(0,0,0,.5) }
  #dlgText { font-size:16.5px; line-height:1.85; color:#f1efe8; min-height:56px; user-select:text }
  #dlgText.narr { color:#c9c8d2; font-style:normal }
  #dlgText .hintline { color:#8e8c9a; font-size:14px }
  #dlgText .dots i { animation:blink 1.2s infinite; font-style:normal }
  #dlgText .dots i:nth-child(2){ animation-delay:.2s } #dlgText .dots i:nth-child(3){ animation-delay:.4s }
  @keyframes blink { 0%,60%{opacity:.15} 30%{opacity:1} }
  #dlgNext { position:absolute; right:16px; bottom:10px; color:#d9b96a; font-size:13px; display:none; animation:bob 1.1s infinite }
  @keyframes bob { 50%{ transform:translateY(3px) } }
  /* 选项 */
  #choices { position:absolute; left:50%; bottom:190px; transform:translateX(-50%); width:min(600px,92vw); z-index:16;
    display:none; flex-direction:column; gap:10px }
  #choices.show { display:flex }
  .ch-title { text-align:center; color:#b9b7c2; font-size:13px; letter-spacing:2px; margin-bottom:2px; text-shadow:0 1px 6px #000 }
  .ch { display:flex; align-items:center; gap:12px; text-align:left; font:inherit; color:#efede6; cursor:pointer;
    background:rgba(13,13,22,.88); border:1px solid rgba(255,255,255,.16); border-left:3px solid rgba(255,255,255,.25);
    border-radius:12px; padding:13px 18px; opacity:0; animation:chIn .35s forwards; backdrop-filter:blur(8px) }
  @keyframes chIn { from{ opacity:0; transform:translateY(10px) } to{ opacity:1; transform:none } }
  .ch:hover { border-color:hsl(40 70% 60% / .75); background:rgba(24,22,32,.92); transform:translateX(3px) }
  .ch-kind { font-size:11.5px; font-weight:600; letter-spacing:2px; min-width:34px }
  .ch-text { font-size:15.5px; flex:1 }
  .ch-score { font-size:12px; color:#d9b96a; border:1px solid rgba(217,185,106,.4); border-radius:6px; padding:1px 8px }
  .ch-sub { text-align:center; color:#8e8c9a; font-size:12.5px; margin-top:2px }
  .ch-sub a { color:#b9a06a; text-decoration:none }
  /* 追问 */
  #probe { position:absolute; right:20px; top:92px; width:288px; z-index:18; display:none;
    background:rgba(20,17,10,.94); border:1px solid hsl(40 60% 50% / .6); border-radius:14px; padding:14px 16px }
  #probe.show { display:block }
  #askQ { font-size:15px; margin-bottom:12px } #askQ::before { content:"⚡ "; color:#d9b96a }
  #askPaths { display:flex; flex-direction:column; gap:8px }
  #askSub { color:#a9a7b4; font-size:12px; margin:6px 0 10px; line-height:1.6 }
  .path { flex:1; min-width:180px; text-align:left; font:inherit; color:#efede6; cursor:pointer;
    background:rgba(13,13,22,.8); border:1px solid rgba(255,255,255,.18); border-radius:10px; padding:10px 14px }
  .path:hover { border-color:#d9b96a }
  .path b { display:block; font-size:14px } .path span { color:#a9a7b4; font-size:12.5px }
  /* 侧栏 */
  #panel { position:absolute; top:0; right:0; bottom:0; width:min(420px,100vw); z-index:30; display:flex; flex-direction:column;
    background:rgba(11,11,18,.94); border-left:1px solid rgba(255,255,255,.12); backdrop-filter:blur(14px);
    transform:translateX(102%); transition:transform .28s }
  #panel.open { transform:none }
  #panel .phead { display:flex; align-items:center; gap:8px; padding:14px 16px 10px }
  .ptab { font:inherit; font-size:13px; color:#b9b7c2; background:transparent; border:1px solid transparent; border-radius:8px; padding:5px 14px; cursor:pointer }
  .ptab.on { color:#f5e9c8; border-color:hsl(40 60% 55% / .5); background:hsl(40 60% 40% / .15) }
  #panel .sp { flex:1 }
  #panel .pclose { color:#8e8c9a; background:none; border:none; font-size:20px; cursor:pointer; padding:0 6px }
  #panelBody { flex:1; overflow:auto; padding:4px 16px 24px; user-select:text }
  .ccard { display:flex; gap:12px; padding:14px 2px; border-bottom:1px solid rgba(255,255,255,.07) }
  .cthumb { width:76px; height:100px; flex:none; border-radius:10px; overflow:hidden; background:rgba(255,255,255,.04);
    display:flex; align-items:center; justify-content:center }
  .cthumb img { width:100%; height:100%; object-fit:cover; mix-blend-mode:screen }
  .pinit { font-size:30px; color:#e8e6e1; width:100%; height:100%; display:flex; align-items:center; justify-content:center }
  .cname { font-size:15.5px; font-weight:600 } .cname em { font-style:normal; font-size:11.5px; color:#9d9ba8;
    border:1px solid rgba(255,255,255,.16); border-radius:5px; padding:0 6px; margin-left:6px; vertical-align:1px }
  .cname em.me { color:#d9b96a; border-color:rgba(217,185,106,.5) }
  .cline { font-size:13px; color:#b9b7c2; margin-top:4px } .cline.dim2 { color:#8e8c9a }
  .rels { margin-top:8px; display:flex; flex-direction:column; gap:6px }
  .rel { font-size:12.5px; color:#c9c8d2; background:rgba(255,255,255,.04); border-radius:8px; padding:6px 10px }
  .rel b { color:#e8e6e1; margin-right:8px } .rel i { display:block; color:#9d8f6a; font-style:normal; font-size:12px; margin-top:2px }
  .ftags { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px }
  .ftags span { font-size:11.5px; color:#d0907e; border:1px solid rgba(208,144,126,.4); border-radius:5px; padding:1px 7px }
  .premise { font-size:13.5px; color:#c9c8d2; background:rgba(255,255,255,.04); border-radius:10px; padding:10px 14px; margin:8px 0 12px }
  .pbar { position:relative; height:8px; background:rgba(255,255,255,.08); border-radius:4px; overflow:hidden; margin-bottom:6px }
  .pbar i { position:absolute; inset:0 auto 0 0; background:hsl(40 60% 50%); border-radius:4px }
  .pbar span { position:absolute; right:0; top:12px; font-size:12px; color:#8e8c9a }
  .sect { font-size:12.5px; color:#d9b96a; letter-spacing:2px; margin:16px 0 6px }
  .pref { font-size:12.5px; color:#b9b7c2; padding:4px 2px }
  .beat { display:flex; gap:10px; padding:8px 2px; border-bottom:1px solid rgba(255,255,255,.06) }
  .beat i { font-style:normal; color:#6f6d7a; font-size:12px; min-width:22px; padding-top:2px }
  .beat p { font-size:13px; color:#c9c8d2 } .beat em { font-style:normal; font-size:13px; color:#efede6; display:block; margin-top:2px }
  #noteTa { width:100%; height:46vh; font:inherit; font-size:13.5px; color:#e8e6e1; background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:12px; resize:vertical; margin-top:10px }
  .nsave { color:#6f8f6f; font-size:12px; margin-top:6px; min-height:16px }
  /* 弹层 */
  .modal { position:fixed; inset:0; background:rgba(6,6,10,.8); z-index:40; display:none; align-items:center; justify-content:center; padding:20px }
  .modal.show { display:flex }
  .sheet { width:min(680px,100%); max-height:86vh; overflow:auto; background:#14141d; border:1px solid rgba(255,255,255,.14);
    border-radius:16px; padding:22px 26px }
  .sheet h3 { font-size:15px; margin-bottom:14px; font-weight:600 }
  .sheet pre { white-space:pre-wrap; font:inherit; line-height:1.9; color:#e8e6e1; user-select:text }
  .sheet .row { display:flex; gap:8px; justify-content:flex-end; margin-top:16px }
  .btn { font:inherit; font-size:13.5px; color:#e8e6e1; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.16);
    border-radius:9px; padding:7px 16px; cursor:pointer } .btn:hover { border-color:hsl(40 60% 55% / .7) }
  .btn.pri { background:hsl(40 62% 46%); border-color:transparent; color:#171408; font-weight:600 }
  .btn.pri:disabled { opacity:.5 }
  .mit.on { border-color:hsl(40 60% 55% / .7); color:#f5e9c8; background:hsl(40 60% 40% / .15) }
  .mitabs { display:flex; gap:8px; margin-bottom:12px }
  #importTa { width:100%; height:34vh; font:inherit; font-size:13px; color:#e8e6e1; background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:12px; resize:vertical }
  .irow { display:flex; gap:10px; align-items:center; margin-top:12px; color:#8e8c9a; font-size:12.5px }
  .irow input { width:70px; font:inherit; color:#e8e6e1; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
    border-radius:8px; padding:5px 10px }
  /* 无剧本空态 */
  #noscript { position:absolute; inset:0; display:none; align-items:center; justify-content:center; z-index:12 }
  #noscript.show { display:flex }
  #noscript .hero { text-align:center; background:rgba(11,11,18,.82); border:1px solid rgba(255,255,255,.12);
  .herocases { display:flex; gap:10px; justify-content:center; flex-wrap:wrap }
    border-radius:18px; padding:38px 44px; backdrop-filter:blur(8px) }
  #noscript h2 { font-size:20px; letter-spacing:2px; margin-bottom:10px }
  #noscript p { color:#a9a7b4; font-size:13.5px; margin-bottom:20px }
  /* 菜单 & toast */
  #menu { position:absolute; top:52px; right:16px; z-index:25; display:none; flex-direction:column; gap:6px;
    background:rgba(13,13,20,.96); border:1px solid rgba(255,255,255,.14); border-radius:12px; padding:10px; min-width:150px }
  #menu.show { display:flex }
  #menu .btn { text-align:left }
  #toast { position:fixed; bottom:170px; left:50%; transform:translateX(-50%); z-index:60; background:rgba(20,18,26,.95);
    border:1px solid rgba(255,255,255,.2); color:#e8e6e1; font-size:13px; border-radius:10px; padding:8px 18px;
    opacity:0; pointer-events:none; transition:opacity .25s; max-width:80vw }
  #toast.show { opacity:1 }
  .hchip { font-size:12px; color:#c9c8d2; border:1px solid rgba(255,255,255,.14); border-radius:99px; padding:1px 9px; background:rgba(10,10,16,.4); white-space:nowrap }
  #fx { position:fixed; top:64px; right:0; left:0; pointer-events:none; z-index:35 }
  .fdelta { position:absolute; top:0; font-size:15px; font-weight:700; animation:fxup 2.3s forwards }
  .fdelta.up { color:#7fb98a } .fdelta.down { color:#d0907e }
  @keyframes fxup { 0%{ transform:translateY(0); opacity:0 } 12%{ opacity:1 } 80%{ opacity:1 } 100%{ transform:translateY(-34px); opacity:0 } }
  #treeOv { position:fixed; inset:0; background:rgba(6,6,10,.82); z-index:45; display:none; align-items:center; justify-content:center; padding:24px }
  #treeOv.show { display:flex }
  .tsheet { width:min(720px,100%); max-height:84vh; overflow:auto; background:#14141d; border:1px solid rgba(255,255,255,.14); border-radius:16px; padding:22px 26px }
  .tsheet h3 { font-size:15px; margin-bottom:14px; font-weight:600 }
  .tnode { display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:9px; margin:2px 0 }
  .tnode:hover { background:rgba(255,255,255,.05) }
  .tnode.on { background:hsl(40 60% 40% / .12); border:1px solid hsl(40 60% 55% / .35) }
  .tmark { color:#d9b96a; width:14px } .tnode:not(.on) .tmark { color:#5f5e68 }
  .tlabel { flex:1; font-size:13.5px; color:#e8e6e1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .tnow { font-size:11.5px; color:#d9b96a; border:1px solid rgba(217,185,106,.4); border-radius:5px; padding:0 7px }
  .tnode .btn { font-size:12px; padding:3px 10px }
  .ch-fx { display:flex; flex-direction:column; gap:2px; align-items:flex-end }
  .ch-fx i { font-style:normal; font-size:12px; white-space:nowrap }
  .befx { margin-top:4px; font-size:12px; display:flex; gap:10px }
  .aattrs { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px }
  .arow { font-size:12px; color:#c9c8d2; background:rgba(255,255,255,.05); border-radius:6px; padding:1px 8px }
  .rnarr { color:#c9c8d2; font-size:14px; padding:6px 2px }
  .rname { display:inline-block; font-size:12.5px; color:#fff; border-radius:6px; padding:1px 10px; margin:10px 0 4px }
  .rline { font-size:15px; color:#f1efe8; padding:2px 2px 6px }
  .rresp { font-size:13.5px; color:#d9b96a; padding:2px 2px 8px; border-bottom:1px solid rgba(255,255,255,.06) }
  .rresp i { font-style:normal; color:#8e8c9a; font-size:12px }
  .rchap { font-size:13px; color:#c9c8d2; background:rgba(255,255,255,.04); border-radius:10px; padding:10px 14px; margin:8px 0 14px }
  .abar { display:flex; align-items:center; gap:8px; font-size:12px; color:#c9c8d2; padding:3px 0 }
  .abar .alb { min-width:64px }
  .abar .tr { flex:1; height:5px; background:rgba(255,255,255,.08); border-radius:3px; overflow:hidden }
  .abar .tr i { display:block; height:100%; border-radius:3px }
  .abar b { min-width:26px; text-align:right }
  .abar em { font-style:normal; font-size:11px; min-width:28px; text-align:right }
  .abar em.up { color:#7fb98a } .abar em.dn { color:#d0907e }
  #askPaths .ghost { background:rgba(20,18,26,.9); color:#c9c8d2; border:1px solid rgba(255,255,255,.18) }
  footer { position:absolute; bottom:4px; left:0; right:0; text-align:center; color:rgba(160,158,172,.55); font-size:11px; z-index:5; pointer-events:none }
  @media (max-width:640px){
    #sprite { height:52vh } #dlg { bottom:14px } #choices { bottom:150px }
    #probe { left:14px; right:14px; width:auto; top:auto; bottom:190px }
  }
</style>
</head>
<body>
<div id="stage">
  <div id="bg"></div>
  <div id="vig"></div>
  <div id="sprite"></div>

  <div id="topbar">
    <span class="mark">剧情推演</span>
    <span class="scene" id="sceneT"></span>
    <span id="prog"></span>
    <span id="demoBadge" style="display:none;font-size:12px;color:#f5e9c8;border:1px solid hsl(40 60% 55% / .6);border-radius:99px;padding:1px 10px;background:hsl(40 60% 40% / .2)">▶ 自动演示</span>
    <span class="sp"></span>
    <span id="hud" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"></span>
    <span class="sp"></span>
    <button class="tbtn" id="engView" onclick="event.stopPropagation();SHOW_SCORES=!SHOW_SCORES;renderTop();renderChoices()" title="显示引擎综合分（排序建议，不构成闸）">引擎视角</button>
    <button class="tbtn" onclick="event.stopPropagation();openReplay()">回看</button>
    <button class="tbtn" onclick="event.stopPropagation();openPanel('chars')">角色</button>
    <button class="tbtn" onclick="event.stopPropagation();openPanel('plot')">剧情</button>
    <button class="tbtn" onclick="event.stopPropagation();openPanel('notes')">笔记</button>
    <button class="tbtn" onclick="event.stopPropagation();toggleMenu()">☰</button>
  </div>
  <div id="menu" onclick="event.stopPropagation()">
    <button class="btn" onclick="hideMenu();openTree()">分支树</button>
    <button class="btn" onclick="hideMenu();doSave()">存档</button>
    <button class="btn" onclick="hideMenu();doLoad()">读档</button>
    <button class="btn" onclick="hideMenu();location.href='/deduce?project='+encodeURIComponent('template-连环计')">案例 · 三国连环计</button>
    <button class="btn" onclick="hideMenu();location.href='/deduce?project='+encodeURIComponent('template-推演')">案例 · 退婚宴</button>
    <button class="btn" onclick="hideMenu();openImport()">新建 / 导入剧本</button>
    <button class="btn" id="btnDraft" onclick="hideMenu();doDraft()" disabled>收尾成稿</button>
    <button class="btn" onclick="hideMenu();doReset()">重置本场</button>
  </div>

  <div id="noscript">
    <div class="hero">
      <h2>剧情推演</h2>
      <p>官方案例一键开玩，或导入一段小说 / 粘贴设定从零创建——<br>引擎出候选、你只负责点选，推演一出你自己的戏。</p>
      <div class="herocases">
        <button class="btn pri" onclick="gotoCase('template-连环计')">案例 · 三国连环计（经典重演）</button>
        <button class="btn" onclick="gotoCase('template-推演')">案例 · 退婚宴（原创短剧）</button>
      </div>
      <p style="margin-top:14px"><button class="btn" onclick="openImport()">导入小说 / 设定创建 →</button></p>
    </div>
  </div>

  <div id="choices" onclick="choicesDelegate(event)"></div>

  <div id="probe">
    <div id="askQ"></div>
    <div id="askSub">引擎拿不准走向，问你要哪种感觉——表态会记进偏好，影响后续几拍的推演倾向。</div>
    <div id="askPaths"></div>
  </div>

  <div id="dlg" class="noadv" onclick="event.stopPropagation();advance()">
    <span id="dlgName"></span>
    <div id="dlgText"></div>
    <span id="dlgNext">▼</span>
  </div>

  <div id="panel">
    <div class="phead">
      <button class="ptab on" data-t="chars" onclick="TAB='chars';renderPanel()">角色</button>
      <button class="ptab" data-t="plot" onclick="TAB='plot';renderPanel()">剧情</button>
      <button class="ptab" data-t="notes" onclick="TAB='notes';renderPanel()">笔记</button>
      <span class="sp"></span>
      <button class="pclose" onclick="closePanel()">×</button>
    </div>
    <div id="panelBody"></div>
  </div>

  <div id="treeOv" onclick="if(event.target===this)closeTree()">
    <div class="tsheet">
      <h3>分支树 <span style="color:#8e8c9a;font-size:12px">● 当前线 ○ 支线（「从此重推」切线，支线保留）</span></h3>
      <div id="treeBody"></div>
      <div class="row"><button class="btn pri" onclick="closeTree()">返回推演</button></div>
    </div>
  </div>
  <div id="fx"></div>

  <div id="replayOv" onclick="if(event.target===this)closeReplay()">
    <div class="tsheet">
      <h3>剧情回看 · <span id="replayTitle" style="color:#d9b96a"></span></h3>
      <div id="replayBody"></div>
      <div class="row"><button class="btn pri" onclick="closeReplay()">返回推演</button></div>
    </div>
  </div>
  <div class="modal" id="mdraft" onclick="if(event.target===this)this.classList.remove('show')">
    <div class="sheet">
      <h3>场景草稿 <span style="color:#8e8c9a;font-size:12px" id="draftFile"></span></h3>
      <pre id="draftText"></pre>
      <div class="row">
        <button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('draftText').textContent)">复制正文</button>
        <button class="btn pri" onclick="downloadNovel()">下载 .md 小说</button>
        <button class="btn pri" onclick="document.getElementById('mdraft').classList.remove('show')">返回推演</button>
      </div>
    </div>
  </div>

  <div class="modal" id="mimport" onclick="if(event.target===this)this.classList.remove('show')">
    <div class="sheet">
      <h3>新建剧本</h3>
      <div class="mitabs">
        <button class="btn mit on" id="mitab-n" onclick="importTab('novel')">从小说导入</button>
        <button class="btn mit" id="mitab-s" onclick="importTab('settings')">从设定创建</button>
      </div>
      <textarea id="importTa" placeholder="粘贴小说文本（挑一段冲突鲜明的场景，引擎会戏剧化提纯为可推演的戏）——或粘贴世界观/角色设定，引擎从零创建开场冲突"></textarea>
      <div class="irow">
        目标拍数 <input id="importBeats" type="number" min="4" max="20" value="10">
        <span style="flex:1"></span>
        <input type="hidden" id="importMode" value="novel">
        <button class="btn pri" id="importGo" onclick="doImport()">生成剧本，开始推演 →</button>
      </div>
    </div>
  </div>

  <div id="toast"></div>
  <footer>分数是排序建议，选择权在你 · 点击流仅本机留档</footer>
</div>
<script>
${DEDUCE_APP_JS}
/* 壳级小组件 */
function toggleMenu(){ document.getElementById('menu').classList.toggle('show'); }
function hideMenu(){ document.getElementById('menu').classList.remove('show'); }
document.addEventListener('click', function(e){ if (!e.target.closest('#menu') && !e.target.closest('#topbar')) hideMenu(); });
refresh();
</script>
</body>
</html>`;
