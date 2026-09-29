// 产品门面 v2（E-A）：dsh desktop 同构工作台——左栏项目，中间对话为中心，右栏三面板（世界书/工作流/文档）。
// 数据接口（B 组契约）：/api/hub · /api/panel/worldbook · /api/panel/files · /api/panel/telemetry ·
// /api/kernel-verb（白名单：flow_init/flow_run/flow_next/flow_effect）· /api/projects/:id/agent/*（pi 单脑）。
export const HOME_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>StoryHarness</title>
<style>
:root{--bg:#faf9f7;--side:#f3f1ec;--line:#e6e2d8;--ink:#2b2622;--ink2:#6f675c;--acc:#8a5a2e;--accd:#6f4622;--ok:#3d6b45;--warn:#8a6d1a;--paper:#fffdf8}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:var(--bg);color:var(--ink);height:100vh;display:flex;overflow:hidden}
button,select,input,textarea{font-family:inherit}
#side{width:232px;flex:none;background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:14px 10px}
#brand{font-weight:800;font-size:16px;margin:2px 6px 14px}#brand small{display:block;font-size:9.5px;color:var(--ink2);font-weight:500;letter-spacing:2px;margin-top:2px}
#newrun{border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px;font-size:13px;cursor:pointer;color:var(--ink);text-align:center;margin-bottom:4px}
#newrun:hover{border-color:var(--acc);color:var(--acc)}
.ws-name{font-size:11px;color:var(--ink2);margin:12px 6px 4px;font-weight:600}
#workspaces{flex:1;overflow-y:auto}
.proj{padding:6px 9px;border-radius:8px;cursor:pointer;font-size:12.5px;display:flex;justify-content:space-between;gap:6px;align-items:center}
.proj:hover{background:#eae6dd}.proj.on{background:#e6e0d3}
.proj .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.proj .m{font-size:10px;color:var(--ink2);flex:none}
.proj .cv{color:var(--ink2);cursor:pointer;padding:0 2px;flex:none}
.proj.sub{margin-left:18px;font-size:11.5px}
.proj.sub .more{cursor:pointer;color:var(--ink2);padding:0 4px}
.proj.sub .more:hover{color:var(--acc)}
.proj.grp .t{font-weight:600}
.pm-tab.on{background:var(--paper);color:var(--acc);border-left:3px solid var(--acc)}
.pm-pane.on{display:block}
.pm-pane{display:none}
#mode{border:1px solid var(--line);border-radius:8px;padding:7px 6px;font-size:12px;color:var(--ink2);background:var(--paper)}
#foot{font-size:11px;color:var(--ink2);margin:10px 6px 0;display:flex;justify-content:space-between}
#main{flex:1;display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--line)}
#mainbar{height:46px;flex:none;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid var(--line);background:var(--side)}
#mainbar .projname{font-weight:700;font-size:14px}
#mainbar .tab{cursor:pointer;padding:4px 12px;border-radius:6px;font-size:13px;color:var(--ink2);border:1px solid transparent}
#mainbar .tab.on{color:var(--acc);border-color:var(--acc)}
#mainbar .sp{flex:1}
#status{font-size:11.5px;color:var(--ink2)}
#view{flex:1;min-height:0;display:flex}
/* hero（未选项目）：立项即开跑 */
#hero{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px}
#hero .h{font-size:28px;font-weight:800;display:flex;gap:10px;align-items:center}
#hero .tag{font-size:11px;color:var(--acc);border:1px solid var(--acc);border-radius:20px;padding:2px 10px}
#hero .frow{margin-top:16px;display:flex;gap:10px;font-size:12.5px;color:var(--ink2);align-items:center}
#flow-sel{border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:#fff;font-size:12.5px;color:var(--ink)}
#composer{margin-top:22px;width:min(620px,92%);background:var(--paper);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 30px rgba(60,45,20,.06);padding:13px}
#prompt{width:100%;border:none;outline:none;resize:none;font:inherit;font-size:14px;background:transparent;min-height:42px}
#crow{display:flex;align-items:center;gap:10px;margin-top:8px}
#crow .meta{font-size:12px;color:var(--ink2)}
#crow .sp{flex:1}
#ep{width:70px;border:1px solid var(--line);border-radius:8px;padding:5px 6px;font-size:12px;color:var(--ink2);background:transparent}
#go{width:auto;padding:9px 20px;border-radius:10px;border:none;background:var(--acc);color:#fff;font-size:13.5px;font-weight:700;white-space:nowrap;cursor:pointer}
#go:hover{background:var(--accd)}#go:disabled{opacity:.4}
#newlog{margin-top:12px;font-size:12.5px;color:var(--ink2);white-space:pre-wrap;display:none}
#newlog.on{display:block}
/* chat */
#chatwrap{flex:1;display:none;min-width:0}
#chatwrap.on{display:flex}
#chatcol{flex:1;display:flex;flex-direction:column;min-width:0}
#msgs{flex:1;overflow-y:auto;padding:18px 22px}
.cm{margin-bottom:14px;max-width:100%}
.cm .who{font-size:10.5px;color:var(--ink2);margin-bottom:3px}
.cm .body{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:10px 14px;line-height:1.7;font-size:13px;word-break:break-word}
.cm.user .body{background:#f0e9da;border-right:3px solid var(--acc)}
.cm.user{margin-left:auto;max-width:78%}
.cm .body.md p{margin:0 0 8px}.cm .body.md ul{margin:0 0 8px 18px}
.cm .body.md h1,.cm .body.md h2,.cm .body.md h3{margin:10px 0 5px;font-weight:700}
.cm .body.md code{background:rgba(0,0,0,.06);padding:1px 5px;border-radius:3px;font-family:Consolas,monospace;font-size:.9em}
.cm.think .body{border-left:3px solid #b8a464;font-size:11.5px;color:var(--ink2);max-height:160px;overflow:auto}
.ctool{border:1px solid var(--line);background:var(--paper);border-radius:8px;margin-bottom:10px;font-size:12px;overflow:hidden}
.ctool .ch{padding:6px 12px;display:flex;gap:8px;align-items:center;color:var(--ink2);cursor:pointer}
.ctool .ch:hover{background:#f0ece3}
.ctool .ch .nm{font-weight:700;font-family:Consolas,monospace}
.ctool .ch .st{margin-left:auto;font-size:10.5px}
.ctool .cb{display:none;border-top:1px solid var(--line);padding:8px 12px;max-height:240px;overflow:auto;white-space:pre-wrap;font-family:Consolas,monospace;font-size:11px;color:var(--ink2);background:var(--bg)}
.ctool.open .cb{display:block}
#inputbar{flex:none;border-top:1px solid var(--line);padding:10px 14px;display:flex;gap:10px;align-items:flex-end;background:var(--side)}
#input{flex:1;resize:none;border:1px solid var(--line);border-radius:8px;padding:9px 12px;font:inherit;font-size:13px;outline:none;min-height:38px;max-height:140px;background:var(--paper)}
#input:focus{border-color:var(--acc)}
#send{flex:none;padding:9px 20px;border:1px solid var(--acc);background:var(--acc);color:#fff;font-weight:700;border-radius:8px;cursor:pointer}
#send:disabled{opacity:.5}
/* trajectory */
#traj{flex:1;display:none;overflow-y:auto;padding:18px 24px}
#traj.on{display:block}
#traj table{width:100%;border-collapse:collapse;font-size:12px}
#traj th,#traj td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}
#traj th{color:var(--ink2);font-weight:600}
/* workflow panel（模块化初稿） */
.cv-chip{display:inline-block;padding:3px 10px;border:1px solid var(--line);border-radius:14px;font-size:11.5px;cursor:pointer;margin:2px 4px 2px 0;background:#fff}
.cv-chip.on{border-color:var(--acc);color:var(--acc)}
.cv-btn{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:3px 9px;font-size:11.5px;cursor:pointer;color:var(--ink)}
.cv-btn:hover{border-color:var(--acc);color:var(--acc)}
.cv-n{display:flex;gap:8px;align-items:center;padding:6px;border-bottom:1px dashed var(--line);cursor:pointer;font-size:12.5px}
.cv-n:hover{background:#f7f3ea}
.cv-nt{flex:1;min-width:0}.cv-nt b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cv-nt small{color:var(--ink2);font-size:10.5px}
.cv-arr{color:var(--ink2)}
.cv-det{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;margin:4px 0}
.cv-det p{margin:6px 0 0;line-height:1.5}
.cv-det b{font-family:Consolas,monospace;font-size:11px}
.cv-file{color:var(--acc);cursor:pointer;text-decoration:underline}
.cv-link{font-size:11.5px;color:var(--ink2);padding:4px;border-bottom:1px dashed var(--line)}
#cv-overlay{display:none;position:fixed;inset:0;background:var(--bg);z-index:50;flex-direction:column}
#cv-overlay.on{display:flex}
#cvf-bar{height:42px;flex:none;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--line);background:var(--side)}
#cvf-frame{flex:1;border:none;width:100%;background:#fff}
/* right panel */
#right{width:var(--rw,360px);flex:none;display:flex;flex-direction:column;border-left:1px solid var(--line);background:var(--side);min-width:0}
#right.hide{display:none}
#rtabs{flex:none;display:flex;gap:2px;padding:8px 8px 0}
#rtabs .rt{flex:1;text-align:center;padding:6px 0;border-radius:8px 8px 0 0;cursor:pointer;font-size:12.5px;color:var(--ink2);border:1px solid transparent;border-bottom:none}
#rtabs .rt.on{background:var(--paper);color:var(--acc);border-color:var(--line)}
#rbody{flex:1;overflow-y:auto;background:var(--paper);border-top:1px solid var(--line)}
.panel{display:none;padding:12px}.panel.on{display:block}
.wb-e{padding:7px 9px;border-bottom:1px dashed var(--line);font-size:12.5px;cursor:pointer}
.wb-e:hover{background:#f7f3ea}
.wb-e b{display:block}.wb-e small{color:var(--ink2)}
#wb-view{display:none;padding:12px}
#wb-view h3{margin-bottom:8px}
#fl-tree .f{padding:5px 8px;font-size:12.5px;cursor:pointer;border-radius:6px;display:flex;justify-content:space-between}
#fl-tree .f:hover{background:#f0ece3}
#fl-tree .f .m{color:var(--ink2);font-size:10.5px}
#fl-view pre{white-space:pre-wrap;font-family:Consolas,monospace;font-size:11.5px;line-height:1.6}
#cv-frame{width:100%;height:100%;border:none}
.back{cursor:pointer;color:var(--acc);font-size:12px;margin-bottom:8px;display:inline-block}
/* 主区窗格（分屏/全屏/收起）+ 自绘模式下拉 */
#sdiv{width:5px;flex:none;cursor:col-resize;background:transparent}
#sdiv:hover,#sdiv.on{background:var(--acc)}
#pane1{flex:1;display:flex;min-width:0}
#pdiv{width:5px;flex:none;cursor:col-resize;background:transparent;display:none}
#view.sp #pdiv{display:block}
#pdiv:hover{background:var(--acc)}
#pane2{width:46%;min-width:260px;flex:none;display:none;flex-direction:column;border-left:1px solid var(--line);background:var(--paper)}
#view.sp #pane2{display:flex}
#p2-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line);background:var(--side)}
#p2-bar b{font-size:12.5px}
#p2-body{flex:1;min-height:0;overflow:auto}
#p2-body th,#p2-body td{border-bottom:1px solid var(--line);padding:5px 7px;text-align:left;font-size:12px}
#p2-body .p2f{display:flex;justify-content:space-between;gap:8px;padding:5px 12px;font-size:12.5px;cursor:pointer}
#p2-body .p2f:hover{background:#f0ece3}
#p2-choose{padding:26px 18px;display:flex;flex-direction:column;gap:12px;max-width:420px;margin:0 auto;width:100%}
.p2c{display:flex;gap:12px;align-items:center;border:1px solid var(--line);background:#fff;border-radius:12px;padding:14px 16px;cursor:pointer}
.p2c:hover{border-color:var(--acc)}
.p2c b{font-size:13.5px;display:block}
.p2c small{color:var(--ink2)}
.p2c .k{margin-left:auto;color:var(--ink2);font-size:11px}
#p2-url{flex:1;border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:12px;min-width:0}
body.z1 #side,body.z1 #sdiv,body.z1 #right,body.z1 #pane2,body.z1 #pdiv{display:none}
body.z2 #side,body.z2 #sdiv,body.z2 #right,body.z2 #pane1,body.z2 #pdiv{display:none}
#modebox{position:relative}
#modebtn{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--ink2);background:var(--paper);cursor:pointer;white-space:nowrap}
#modebtn:hover{border-color:var(--acc);color:var(--acc)}
#modelist{display:none;position:absolute;bottom:calc(100% + 6px);right:0;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 26px rgba(60,45,20,.14);padding:4px;min-width:132px;z-index:40}
#modelist.on{display:block}
#modelist div{padding:7px 12px;border-radius:7px;font-size:12.5px;cursor:pointer;white-space:nowrap}
#modelist div:hover{background:#f0ece3}
#modelist div.on{background:#eae4d7;color:var(--acc)}
#rtoggle{position:absolute;right:10px;top:9px;z-index:5;border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;color:var(--ink2)}
</style>
</head>
<body>
<aside id="side">
  <div id="brand">📖 Story<small>HARNESS · PI 单脑</small></div>
  <button id="newrun">＋ 新项目</button>
  <div class="ws-name">工作区<span id="ws-add" title="新建工作区（选一个全新文件夹）" style="cursor:pointer;color:var(--acc);font-weight:700;margin-left:8px">＋</span></div>
  <div id="ws-form" style="display:none;margin:4px 6px 8px;padding:8px;border:1px dashed var(--line);border-radius:8px;font-size:12px">
    <input id="wsf-name" placeholder="工作区名称（如：曹操项目）" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;padding:5px 8px;font:inherit;margin-bottom:6px;background:var(--paper)">
    <input id="wsf-path" placeholder="文件夹路径（如 D:/caocao-ws，不存在会自动创建）" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;padding:5px 8px;font:inherit;margin-bottom:6px;background:var(--bg)">
    <button id="wsf-go" style="width:100%;border:1px solid var(--acc);background:var(--acc);color:#fff;border-radius:6px;padding:5px;font-weight:700;cursor:pointer">创建工作区</button>
  </div>
  <div id="workspaces">加载中…</div>
  <div id="foot"><span id="foot-model">—</span><span>__VER__ · 8431</span></div>
</aside>
<div id="sdiv" title="拖拽调宽"></div>
<main id="main">
  <div id="mainbar">
    <span class="projname" id="pname">StoryHarness</span>
    <span class="tab on" id="tab-chat" style="display:none">对话</span>
    <span class="tab" id="tab-traj" style="display:none">轨迹</span>
    <button id="newchat" class="cv-btn" style="display:none" title="当前项目开一个新会话">＋ 会话</button>
    <button id="preset-btn" class="cv-btn" style="display:none" title="项目预设：设计/插件/文件结构/模板">⚙ 预设</button>
    <span class="sp"></span>
    <span id="status">● 检测中</span>
    <button id="b-side" class="cv-btn" title="收起/展开项目栏">◧ 侧栏</button>
    <button id="b-split" class="cv-btn" title="分屏：右侧开一个窗格，自选内容">⫿ 分屏</button>
    <button id="b-full" class="cv-btn" title="全屏：聚焦主视图，再点还原">⛶ 全屏</button>
    <button id="rtoggle" style="position:static">◧ 面板</button>
  </div>
  <div id="view">
    <div id="pane1">
    <div id="hero">
      <div class="h">📖 StoryHarness <span class="tag">预览版</span></div>
      <div class="frow">
        <select id="flow-sel"></select>
        <span id="ws-cur">—</span>
        <span class="meta">集数</span><input id="ep" type="number" min="1" max="99" value="6" style="width:64px;border:1px solid var(--line);border-radius:6px;padding:4px">
      </div>
      <div id="composer">
        <textarea id="prompt" placeholder="一句话题材方向 → 立项并开跑；对话接管推进" rows="2"></textarea>
        <div id="crow">
          <span class="meta" id="attr-toggle" title="项目属性：位置/模型档/产物契约" style="cursor:pointer;color:var(--acc)">⚙ 属性</span>
          <span class="sp"></span><button id="go">↑ 立项开跑</button>
        </div>
      </div>
      <div id="attrs" style="display:none;margin-top:10px;padding:10px;border:1px dashed var(--line);border-radius:8px;font-size:12px">
        <div style="margin-bottom:6px;color:var(--ink2)">项目位置（默认仓内 projects/；自定义文件夹 = 独立原生项目，junction 挂载）</div>
        <input id="loc" placeholder="D:/我的新工作区/projects（留空 = 仓内）" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit;margin-bottom:8px;background:var(--bg)">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="color:var(--ink2)">模型档</span>
          <select id="tier" style="border:1px solid var(--line);border-radius:6px;padding:4px;background:var(--paper);font-size:12px">
            <option value="">默认（机械=flash，文学=high）</option>
            <option value="flash">全部 flash（省）</option>
          </select>
          <span style="color:var(--ink2)">产物上限</span>
          <select id="maxc" style="border:1px solid var(--line);border-radius:6px;padding:4px;background:var(--paper);font-size:12px">
            <option value="">流程默认（分镜 12000）</option>
            <option value="6000">紧凑 6000</option>
            <option value="16000">加厚 16000</option>
          </select>
          <span style="color:var(--ink2)" title="插件集由所选流程的模块声明决定（项目级运行时开关=二期 overlay）">插件：随流程</span>
        </div>
      </div>
      <div id="newlog"></div>
    </div>
    <div id="chatwrap">
      <div id="chatcol">
        <div id="msgs"></div>
        <div id="inputbar">
          <textarea id="input" placeholder="对 pi 单脑说：推进下一节点 / 查设定 / 改稿…（Enter 发送）" rows="1"></textarea>
          <div id="modebox" title="权限模式（会话内生效）">
            <button id="modebtn">完全访问 ▾</button>
            <div id="modelist"></div>
          </div>
          <button id="send">发送</button>
        </div>
      </div>
    </div>
    <div id="traj"><div id="traj-body" style="color:var(--ink2);font-size:12.5px">尚无运行记录</div></div>
    </div>
    <div id="pdiv" title="拖拽分界调宽"></div>
    <div id="pane2">
      <div id="p2-bar"><b id="p2-title">选择内容</b><span style="flex:1"></span><button id="p2-re" class="cv-btn">⌄ 选择</button><button id="p2-close" class="cv-btn">✕</button></div>
      <div id="p2-body"></div>
    </div>
  </div>
</main>
<div id="preset-modal" style="display:none;position:fixed;inset:0;z-index:80;background:rgba(30,25,18,.45)">
  <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(860px,94vw);max-height:88vh;overflow:auto;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 60px rgba(30,22,10,.25)">
    <div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)">
      <b style="font-size:15px">项目预设 · <span id="pm-pname">—</span></b>
      <span class="sp" style="flex:1"></span>
      <button id="pm-close" class="cv-btn">✕ 关闭</button>
    </div>
    <div style="display:flex;min-height:380px">
      <div style="width:150px;flex:none;border-right:1px solid var(--line);padding:12px 8px;display:flex;flex-direction:column;gap:4px" id="pm-tabs">
        <div class="pm-tab on" data-t="design" style="padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px">项目设计</div>
        <div class="pm-tab" data-t="plugins" style="padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px">插件</div>
        <div class="pm-tab" data-t="files" style="padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px">文件结构</div>
        <div class="pm-tab" data-t="tpl" style="padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px">产物模板</div>
      </div>
      <div style="flex:1;padding:16px 20px;font-size:13px">
        <div class="pm-pane on" id="pm-design">
          <div style="color:var(--ink2);margin-bottom:8px">项目设计 = 题材方向 / 集数 / 严肃性 / 风格（写入项目配置，下轮 run 合并生效）</div>
          <div style="margin-bottom:8px"><span style="color:var(--ink2);display:inline-block;width:70px">题材方向</span>
            <textarea id="pm-direction" rows="2" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit;background:var(--bg)"></textarea></div>
          <div style="margin-bottom:8px;display:flex;gap:14px;align-items:center">
            <span style="color:var(--ink2)">集数</span><input id="pm-ep" type="number" min="1" max="99" style="width:70px;border:1px solid var(--line);border-radius:6px;padding:5px;font:inherit;background:var(--bg)">
            <span style="color:var(--ink2)">严肃性</span>
            <select id="pm-serious" style="border:1px solid var(--line);border-radius:6px;padding:4px;background:var(--bg);font-size:12.5px"><option>标准</option><option>严肃</option><option>爽</option></select>
            <span style="color:var(--ink2)">风格</span>
            <select id="pm-style" style="border:1px solid var(--line);border-radius:6px;padding:4px;background:var(--bg);font-size:12.5px"><option>爽</option><option>正剧</option><option>喜剧</option></select>
          </div>
          <button id="pm-save" class="cv-btn" style="border:1px solid var(--acc);color:var(--acc);padding:6px 16px;border-radius:8px;cursor:pointer">保存设计</button>
          <span id="pm-saved" style="color:var(--ok);font-size:12px;margin-left:8px"></span>
        </div>
        <div class="pm-pane" id="pm-plugins"><div style="color:var(--ink2)">加载中…</div></div>
        <div class="pm-pane" id="pm-files"><div style="color:var(--ink2)">加载中…</div></div>
        <div class="pm-pane" id="pm-tpl"><div style="color:var(--ink2)">加载中…</div></div>
      </div>
    </div>
  </div>
</div>
<aside id="right">
  <div id="rtabs">
    <div class="rt on" data-p="wb">世界书</div>
    <div class="rt" data-p="cv">工作流</div>
    <div class="rt" data-p="fl">文档</div>
  </div>
  <div id="rbody">
    <div class="panel on" id="p-wb"><div style="color:var(--ink2);font-size:12px;padding:8px">选中项目后载入世界书</div></div>
    <div class="panel" id="p-cv"><div style="color:var(--ink2);font-size:12px;padding:8px">选中项目后载入生效编排</div></div>
    <div class="panel" id="p-fl"><div style="color:var(--ink2);font-size:12px;padding:8px">选中项目后载入文件树</div></div>
  </div>
</aside>
<div id="cv-overlay">
  <div id="cvf-bar"><b id="cvf-name">工作流画布</b><span style="flex:1"></span><span style="font-size:11px;color:var(--ink2)">Esc 关闭 · 数据源 8421 作业台</span><button id="cvf-close" class="cv-btn">✕ 关闭画布</button></div>
  <iframe id="cvf-frame" title="工作流画布全屏"></iframe>
</div>
<script>
const $ = id => document.getElementById(id);
const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let HUB=null, CUR=null, SIDE=[];   // CUR = {id,group}
const enc = encodeURIComponent;

/* ---------- md（轻量，同工作台口径） ---------- */
function md(t){
  const inl = s => esc(s).replace(/\\*\\*([^*]+)\\*\\*/g,"<b>$1</b>").replace(/\`([^\`]+)\`/g,"<code>$1</code>");
  let h="",ul=false;
  for(const ln of String(t??"").split(/\\r?\\n/)){
    const m=ln.match(/^(#{1,3})\\s+(.*)$/);
    if(m){ if(ul){h+="</ul>";ul=false} h+=("<"+m[1]+">"+inl(m[2])+"</"+m[1]+">"); continue }
    if(/^[-*]\\s+/.test(ln)){ if(!ul){h+="<ul>";ul=true} h+="<li>"+inl(ln.replace(/^[-*]\\s+/,""))+"</li>"; continue }
    if(ul){h+="</ul>";ul=false}
    if(!ln.trim()) continue;
    h+="<p>"+inl(ln)+"</p>";
  }
  if(ul)h+="</ul>";
  return h;
}

/* ---------- hub / 项目清单（树形：项目 ▸ 会话嵌套，Codex 式） ---------- */
const expanded = new Set();
const expandedGroups = new Set();
async function loadHub(){
  // 超时+自动重试：栈重启瞬间加载会永远卡「加载中…」（甲方实测）——8s 超时 ×3 次退避
  let hub = null, lastErr = "";
  for (let i = 0; i < 3; i++) {
    try {
      const c = new AbortController(); const t = setTimeout(()=>c.abort(), 8000);
      hub = await (await fetch("/api/hub", { signal: c.signal })).json(); clearTimeout(t);
      break;
    } catch(e) { lastErr = String(e); clearTimeout(t); await new Promise(r=>setTimeout(r, 1500*(i+1))); }
  }
  if (!hub) {
    $("workspaces").innerHTML = '<div class="proj" style="color:#a5433a">hub 加载失败（'+esc(lastErr.slice(0,60))+'）</div><div class="proj" style="cursor:pointer;color:var(--acc)" onclick="loadHub()">↻ 重试</div>';
    $("ws-cur").textContent="—"; return;
  }
  HUB = hub;
  $("ws-cur").textContent = "📁 " + HUB.workspace;
  $("foot-model").textContent = HUB.model;
  const sel = $("flow-sel");
  sel.innerHTML = HUB.flows.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.id)+"（"+esc(f.title)+"）</option>").join("");
  renderTree();
}
async function renderTree(){
  const box = $("workspaces");
  box.innerHTML = HUB.groups.map((g,gi)=>{
    const open = !wsCollapsed.has(g.name);
    // 同题归组：title 相同 ≥2 的项目收进组文件夹（同一题材的多轮跑不再平铺刷屏）
    const byTitle={};
    g.projects.forEach(p=>{ const k=(p.title||p.id).trim(); (byTitle[k]=byTitle[k]||[]).push(p); });
    const rows=[];
    for(const [title,arr] of Object.entries(byTitle)){
      if(arr.length>1){
        const gk=gi+"|"+title;
        const open=expandedGroups.has(gk);
        rows.push('<div class="proj grp" data-grp="'+esc(gk)+'"><span class="cv">'+(open?"▾":"▸")+'</span><span class="t">'+esc(title)+'</span><span class="m arc-tog" title="切换 显示/归档 会话">🗄</span><span class="m">'+arr.length+'</span></div>');
        if(open) for(const p of arr){
          rows.push('<div class="proj sub" data-g="'+gi+'" data-id="'+esc(p.id)+'">'+
            '<span class="cv" data-cv="'+gi+'|'+esc(p.id)+'" title="展开会话">'+(expanded.has(gi+"|"+p.id)?"▾":"▸")+'</span>'+
            '<span class="t" style="color:var(--ink2)">'+esc(p.id)+'</span>'+
            '<span class="m">'+(p.total?p.done+"/"+p.total:"—")+'</span></div>');
        }
      } else {
        const p=arr[0];
        rows.push('<div class="proj" data-g="'+gi+'" data-id="'+esc(p.id)+'">'+
          '<span class="cv" data-cv="'+gi+'|'+esc(p.id)+'" title="展开会话">'+(expanded.has(gi+"|"+p.id)?"▾":"▸")+'</span>'+
          '<span class="t">'+esc(title)+'</span>'+
          '<span class="m">'+(p.total?p.done+"/"+p.total:"—")+'</span></div>');
      }
    }
    return '<div class="ws-name" data-ws="'+esc(g.name)+'" style="cursor:pointer">'+(open?"▾":"▸")+' '+esc(g.name)+'</div>'+
      (open ? (rows.join("") || '<div class="proj" style="color:var(--ink2)">(空)</div>') : '');
  }).join("") + '<div id="tree-sub"></div>';
  box.querySelectorAll(".ws-name[data-ws]").forEach(el=>el.addEventListener("click",()=>{
    const k=el.dataset.ws;
    if(wsCollapsed.has(k)) wsCollapsed.delete(k); else wsCollapsed.add(k);
    renderTree();
  }));
  box.querySelectorAll(".grp").forEach(el=>el.addEventListener("click",()=>{
    const k=el.dataset.grp;
    if(expandedGroups.has(k)) expandedGroups.delete(k); else expandedGroups.add(k);
    renderTree();
  }));
  box.querySelectorAll(".grp .arc-tog").forEach(el=>el.addEventListener("click",e=>{
    e.stopPropagation();
    window.SHOW_ARCHIVED=!window.SHOW_ARCHIVED; renderTree();
  }));
  box.querySelectorAll(".proj.sub[data-id], .proj[data-id]:not(.grp):not(.sub)").forEach(el=>el.addEventListener("click",e=>{
    if(e.target.dataset.cv) return;
    selectProject(+el.dataset.g, el.dataset.id);
  }));
  box.querySelectorAll(".cv[data-cv]").forEach(el=>el.addEventListener("click",async e=>{
    e.stopPropagation();
    const [gi,id]=el.dataset.cv.split("|");
    const key=gi+"|"+id;
    if(expanded.has(key)){ expanded.delete(key); renderTree(); return; }
    expanded.add(key); renderTree();
    const sub= document.getElementById("tree-sub");
    let list=[];
    try{ list= await (await fetch("/api/projects/"+enc(id)+"/agent/sessions")).json(); }catch{}
    const chat=list.filter(s=>s.mode==="chat"&&(window.SHOW_ARCHIVED?s.archived:!s.archived)).slice(0,8);
    const holder=document.createElement("div");
    holder.innerHTML= '<div class="ws-name" style="margin-left:18px">↳ 会话</div>'+
      (chat.length? chat.map(s=>'<div class="proj sub" data-pid="'+esc(id)+'" data-sid="'+esc(s.id)+'"><span class="t">'+esc(s.title||s.id)+'</span><span class="m more" data-more="'+esc(s.id)+'" title="置顶/分叉/归档">…</span></div>').join("")
      : '<div class="proj sub" style="color:var(--ink2)">(无会话)</div>');
    sub.appendChild(holder);
    holder.querySelectorAll(".sub[data-sid]").forEach(x=>x.addEventListener("click",e=>{
      if(e.target.dataset.more) return;
      selectProject(+gi, id);
      openSession(x.dataset.sid);
    }));
    holder.querySelectorAll(".more").forEach(m=>m.addEventListener("click",e=>{
      e.stopPropagation();
      sessionMenu(m, id, m.dataset.more);
    }));
  }));
}
/* 会话操作菜单（置顶/重命名/分叉/归档）——对齐 dsh 的 … 菜单 */
function sessionMenu(anchor, pid, sid){
  document.getElementById("ctxmenu")?.remove();
  const m=document.createElement("div"); m.id="ctxmenu";
  m.style.cssText="position:fixed;z-index:99;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:4px;font-size:12.5px;min-width:120px";
  m.innerHTML=['📌 置顶','✏ 重命名','⑂ 分叉','🗄 归档'].map(x=>'<div class="mi" data-a="'+x.slice(2)+'" style="padding:7px 12px;cursor:pointer;border-radius:6px">'+x+'</div>').join("");
  document.body.appendChild(m);
  const r=anchor.getBoundingClientRect();
  m.style.left=Math.min(r.left, window.innerWidth-160)+"px";
  m.style.top=(r.bottom+4)+"px";
  m.querySelectorAll(".mi").forEach(mi=>{
    mi.onmouseenter=()=>mi.style.background="#f0ece3";
    mi.onmouseleave=()=>mi.style.background="";
    mi.addEventListener("click",async()=>{
      const a=mi.dataset.a; m.remove();
      try{
        if(a==="置顶"){ await fetch("/api/projects/"+enc(pid)+"/agent/sessions/"+enc(sid)+"/pin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:true})}); }
        else if(a==="重命名"){ const t=prompt("会话名称："); if(t!==null) await fetch("/api/projects/"+enc(pid)+"/agent/sessions/"+enc(sid)+"/rename",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:t})}); }
        else if(a==="分叉"){ const f=await (await fetch("/api/projects/"+enc(pid)+"/agent/sessions/"+enc(sid)+"/fork",{method:"POST"})).json(); if(CUR&&CUR.id===pid){ await loadSessions(); openSession(f.id); } }
        else if(a==="归档"){ await fetch("/api/projects/"+enc(pid)+"/agent/sessions/"+enc(sid)+"/archive",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:true})}); }
        renderTree();
      }catch(e){ alert("操作失败："+e.message) }
    });
  });
  setTimeout(()=>document.addEventListener("click",()=>m.remove(),{once:true}),0);
}
function selectProject(gi,id){
  CUR = {id, group:gi}; SID=null;   // 切项目重置会话（loadSessions 自动开该项目最近会话）
  document.querySelectorAll(".proj").forEach(x=>x.classList.remove("on"));
  const el = document.querySelector('.proj[data-id="'+CSS.escape(id)+'"]'); if(el) el.classList.add("on");
  $("tab-chat").style.display=""; $("tab-traj").style.display=""; showView("chat");
  $("newchat").style.display=""; $("preset-btn").style.display="";
  const p = (HUB.groups[gi].projects.find(x=>x.id===id))||{};
  $("pname").textContent = p.title || id;
  loadSessions(); loadPanels();
}

/* ---------- 新项目立项 ---------- */
function showView(v){   // hero | chat | traj 三视图互斥（新项目钮在项目视图里也能回立项页）
  $("hero").style.display = v==="hero" ? "flex" : "none";
  $("chatwrap").classList.toggle("on", v==="chat");
  $("traj").classList.toggle("on", v==="traj");
  $("tab-chat").classList.toggle("on", v==="chat");
  $("tab-traj").classList.toggle("on", v==="traj");
}
$("newrun").onclick = ()=>{ showView("hero"); $("prompt").focus(); $("prompt").placeholder = "一句话题材方向 → 立项并开跑；对话接管推进"; };
$("attr-toggle").onclick=()=>{ const a=$("attrs"); a.style.display=a.style.display==="none"?"block":"none"; };
$("go").onclick = async ()=>{
  const dir=$("prompt").value.trim(); if(!dir) return;
  const pid="p-sh-"+new Date().toISOString().replace(/[-:T]/g,"").slice(0,12);
  $("go").disabled=true;
  const log=$("newlog"); log.classList.add("on"); log.textContent="立项 "+pid+" 并开跑…";
  try{
    const r=await (await fetch("/api/kernel-verb",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({verb:"flow_run",args:{flow:$("flow-sel").value,project:pid,inputs:{direction:dir,episodes:Number($("ep").value)||6}},location:$("loc").value.trim()||undefined})})).json();
    if(r.error) throw new Error(r.error);
    log.textContent="已开跑 ✓ ——对话已接管，直接开始说话";
    $("prompt").value="";
    await loadHub(); selectProject(0,pid);
  }catch(e){ log.textContent="失败："+e.message }
  $("go").disabled=false;
};
$("prompt").addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("go").click()} });

/* ---------- 对话（pi 单脑）---------- */
let SID=null, streaming=false, pendingCards={};
const MODES=[["plan","计划模式"],["confirm","变更前确认"],["auto","自动编辑"],["full","完全访问"]];
let curMode=localStorage.getItem("sh-mode")||"full";
if(!MODES.some(m=>m[0]===curMode)) curMode="full";
const sessApi = () => "/api/projects/"+enc(CUR.id)+"/agent";
async function loadSessions(){
  if(!CUR) return;
  try{ SIDE = await (await fetch(sessApi()+"/sessions")).json(); }catch{ SIDE=[]; }
  // 会话管理入口=左栏树（项目 ▸ 会话）；中栏不再重复渲染（0.5.2 甲方反馈：功能重复）
  if(!SID && SIDE.length) openSession(SIDE[0].id);
}
async function openSession(sid){
  SID=sid;
  try{
    const s=await (await fetch(sessApi()+"/sessions/"+sid)).json();
    const box=$("msgs"); box.innerHTML="";
    const cards={};
    for(const m of (s.messages||[])){
      if(m.role==="user") addMsg("我",m.content,"user");
      else if(m.role==="assistant"){
        if(m.content) addMsg("pi 单脑",m.content,"assistant",true);
        for(const tc of m.tool_calls||[]){ cards[tc.id]=addTool(tc.function.name,tc.function.arguments); }
      } else if(m.role==="tool"&&cards[m.tool_call_id]) cards[m.tool_call_id].setResult(m.content,true);
    }
    if(Array.isArray(s.events)&&s.events.length){
      const rows=s.events.filter(e=>e.event&&["judge_evidence","integrity_reject","submit"].includes(e.event.event))
        .map(e=>{const v=e.event;return v.event==="judge_evidence"?'<div class="ge-row">⚖ 判官证据 · flagged='+(v.flagged||[]).length+' · '+esc(v.node||"")+"</div>"
          :v.event==="integrity_reject"?'<div class="ge-row">⛔ 完整性拒绝（第'+(v.round||"?")+"轮）"+esc(v.detail||"")+"</div>"
          :'<div class="ge-row">✓ '+esc(v.node||"")+" 交卷</div>"}).join("");
      if(rows) box.insertAdjacentHTML("beforeend",'<div class="cm"><div class="who">运行证据</div><div class="body">'+rows+"</div></div>");
    }
    box.scrollTop=box.scrollHeight;
  }catch{ /* */ }
  loadSessions();
}
$("newchat").onclick = async ()=>{ if(!CUR)return;
  const s=await (await fetch(sessApi()+"/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json();
  SID=s.id; $("msgs").innerHTML=""; loadSessions();
};
function addMsg(who,text,cls,mdr){
  const w=document.createElement("div"); w.className="cm "+(cls||"");
  w.innerHTML='<div class="who">'+esc(who)+'</div><div class="body"></div>';
  const b=w.querySelector(".body");
  if(mdr){ b.classList.add("md"); b.innerHTML=md(text); } else b.textContent=text;
  $("msgs").appendChild(w); $("msgs").scrollTop=$("msgs").scrollHeight;
  return {w,b,setMd(t){b.classList.add("md");b.innerHTML=md(t)},set(t){b.textContent=t}};
}
function addTool(name,args){
  const w=document.createElement("div"); w.className="ctool";
  w.innerHTML='<div class="ch"><span>🔧</span><span class="nm">'+esc(name)+'</span><span class="st">…</span></div><div class="cb"></div>';
  let at=args; try{at=JSON.stringify(JSON.parse(args),null,1)}catch{}
  w.querySelector(".cb").textContent="参数：\\n"+at;
  w.querySelector(".ch").addEventListener("click",()=>w.classList.toggle("open"));
  $("msgs").appendChild(w); $("msgs").scrollTop=$("msgs").scrollHeight;
  return {setResult(c,ok){w.querySelector(".cb").textContent+="\\n── 结果 ──\\n"+c;w.querySelector(".st").textContent=ok===false?"✗":(ok===true?"✓":"…")}};
}
$("input").addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg()} });
(function(){   // 自绘模式下拉：原生 select 的弹层在窗缘会脱窗错位（09-27 甲方截图）
  const lab=v=>(MODES.find(m=>m[0]===v)||MODES[3])[1];
  const btn=$("modebtn"), list=$("modelist");
  const paint=()=>{ btn.textContent=lab(curMode)+" ▾"; list.querySelectorAll("div").forEach(d=>d.classList.toggle("on",d.dataset.v===curMode)); };
  list.innerHTML=MODES.map(m=>'<div data-v="'+m[0]+'">'+m[1]+'</div>').join("");
  list.querySelectorAll("div").forEach(d=>d.addEventListener("click",()=>{ curMode=d.dataset.v; localStorage.setItem("sh-mode",curMode); paint(); list.classList.remove("on"); }));
  btn.addEventListener("click",e=>{ e.stopPropagation(); list.classList.toggle("on"); paint(); });
  document.addEventListener("click",()=>list.classList.remove("on"));
  paint();
})();
$("send").onclick = () => { if(streaming){ fetch(sessApi()+"/sessions/"+SID+"/stop",{method:"POST"}).catch(()=>{}); } else sendMsg(); };
async function sendMsg(){
  if(streaming||!CUR) { if(!CUR) alert("先在左栏选一个项目（或立项）"); return; }
  const inp=$("input"), text=inp.value.trim(); if(!text) return;
  if(!SID){ const s=await (await fetch(sessApi()+"/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).json(); SID=s.id; }
  streaming=true; inp.value="";
  $("send").textContent="■ 停止"; $("send").style.background="var(--warn)";
  addMsg("我",text,"user");
  let turn=addMsg("pi 单脑","","assistant"); turn.b.classList.add("md"); let full="";
  let think=null;
  try{
    const resp=await fetch(sessApi()+"/sessions/"+SID+"/turn",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,mode:curMode})});
    const rd=resp.body.getReader(),dec=new TextDecoder(); let buf="";
    const close=()=>{ if(full) turn.setMd(full); turn.w.classList.remove("md"); };
    while(true){
      const {done,value}=await rd.read(); if(done) break;
      buf+=dec.decode(value,{stream:true}); let i;
      while((i=buf.indexOf("\\n\\n"))>=0){
        const fr=buf.slice(0,i); buf=buf.slice(i+2);
        for(const line of fr.split("\\n")){
          if(!line.startsWith("data:"))continue;
          const d=line.slice(5).trim(); if(!d)continue;
          if(d==="[DONE]"){close();continue}
          let ev;try{ev=JSON.parse(d)}catch{continue}
          if(ev.type==="delta"){full+=ev.text;turn.setMd(full);$("msgs").scrollTop=$("msgs").scrollHeight}
          else if(ev.type==="tool_call"){close();full="";const c=addTool(ev.name,ev.args);pendingCards[ev.id]=c;c.setResult("",null);turn=addMsg("pi 单脑","","assistant")}
          else if(ev.type==="tool_result"){const c=pendingCards[ev.id];if(c)c.setResult(ev.content,ev.ok)}
          else if(ev.type==="thinking_delta"){
            if(!think){think=addMsg("🧠 思维链","","think")}
            think.b.textContent+=ev.text;$("msgs").scrollTop=$("msgs").scrollHeight;
          }
          else if(ev.type==="done"){close()}
          else if(ev.type==="error"){close();turn.w.querySelector(".body").classList.add("err");turn.b.textContent=ev.message}
        }
      }
    }
    close(); loadSessions();
  }catch(e){ turn.b.textContent="连接失败："+e.message }
  streaming=false; $("send").textContent="发送"; $("send").style.background="var(--acc)"; inp.focus();
}

/* ---------- 轨迹 ---------- */
$("tab-chat").onclick=()=>showView("chat");
async function renderTrajInto(el){   // 轨迹渲染单一实现：主区轨迹页签与分屏窗格共用（内容融合）
  if(!CUR)return;
  const t=await (await fetch("/api/panel/telemetry?project="+enc(CUR.id))).json();
  if(!t.runs.length){el.innerHTML="尚无运行记录";return}
  const L=t.latest; const th='<tr><th>节点</th><th>档位</th><th>耗时</th><th>工具</th><th>提交轮</th><th>判官 flagged</th></tr>';
  const rows=(L.nodes||[]).map(n=>'<tr><td>'+esc(n.node)+'</td><td>'+(n.model?String(n.model).replace("zai.glm-5.3",""):"")+'</td><td>'+Math.round((n.elapsedMs||0)/1000)+'s</td><td>'+(n.toolCount??"-")+'</td><td>'+(n.submitRounds??"-")+'</td><td>'+((n.judge&&n.judge.flagged||[]).length)+'</td></tr>').join("");
  el.innerHTML='<div style="margin-bottom:10px;font-size:12.5px;color:var(--ink2)">墙钟 '+Math.round(L.wallMs/60000*10)/10+' 分钟 · '+L.totals.okNodes+"/"+L.totals.nodes+' 节点 · usage '+L.totals.usageIn+"/"+L.totals.usageOut+' tok · 判官 flagged '+L.totals.judgeFlagged+'</div><table>'+th+rows+"</table>";
}
$("tab-traj").onclick=()=>{ showView("traj"); renderTrajInto($("traj-body")); };

/* ---------- 项目预设（D-E2）：设计/插件/文件结构/模板 ---------- */
let PM_CACHE = null;
$("preset-btn").onclick = async () => {
  if (!CUR) { alert("先选一个项目"); return; }
  $("preset-modal").style.display = "block";
  $("pm-pname").textContent = CUR.id;
  const r = await (await fetch("/api/kernel-verb", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ verb:"flow_effect", args:{ project: CUR.id } }) })).json();
  PM_CACHE = r;
  const dir = (HUB.groups[CUR.group].projects.find(p=>p.id===CUR.id)||{}).title || "";
  $("pm-direction").value = dir && !/^p-/.test(dir) ? "" : "";
  try {
    const cfgr = await (await fetch("http://127.0.0.1:8421/api/projects/"+enc(CUR.id)+"/config")).json();
    $("pm-direction").value = cfgr.灵感 || cfgr.direction || "";
    $("pm-ep").value = cfgr.episodes || (cfgr.presets||{}).episodes || "";
    if (cfgr.严肃性) $("pm-serious").value = cfgr.严肃性;
    if (cfgr.风格) $("pm-style").value = cfgr.风格;
  } catch { /* 配置读取失败不阻塞 */ }
};
$("pm-close").onclick = () => { $("preset-modal").style.display = "none"; };
document.querySelectorAll(".pm-tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".pm-tab").forEach(x=>x.classList.remove("on"));
  document.querySelectorAll(".pm-pane").forEach(x=>x.classList.remove("on"));
  t.classList.add("on");
  $("pm-"+t.dataset.t).classList.add("on");
  if (t.dataset.t === "plugins") renderPlugins();
  if (t.dataset.t === "files") renderFiles();
  if (t.dataset.t === "tpl") renderTpl();
}));
$("pm-save").onclick = async () => {
  try {
    const cfgBody = { 灵感: $("pm-direction").value, 严肃性: $("pm-serious").value, 风格: $("pm-style").value, episodes: Number($("pm-ep").value)||undefined };
    await fetch("http://127.0.0.1:8421/api/projects/"+enc(CUR.id)+"/config", { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(cfgBody) });
    $("pm-saved").textContent = "已保存 ✓"; setTimeout(()=>$("pm-saved").textContent="", 2000);
  } catch(e) { $("pm-saved").textContent = "保存失败：" + e.message; }
};
function renderPlugins() {
  const el = $("pm-plugins"); const comp = (PM_CACHE && PM_CACHE.composition) || [];
  const mods = [...new Set(comp.map(c => (c.node||"").split(".")[0]))];
  el.innerHTML = '<div style="color:var(--ink2);margin-bottom:8px">激活插件集由所选流程的模块声明决定（项目级运行时开关 = 二期 overlay，本页只读展示）</div>' +
    (mods.length ? mods.map(m => '<div style="padding:6px 0;border-bottom:1px dashed var(--line)">📦 '+esc(m)+'</div>').join("") : '<div style="color:var(--ink2)">(无编排数据——项目未开跑或 flow_effect 不可用)</div>');
}
function renderFiles() {
  const el = $("pm-files"); const comp = (PM_CACHE && PM_CACHE.composition) || [];
  const dirs = [...new Set(comp.map(c => (c.dir || "").trim()).filter(Boolean))];
  el.innerHTML = '<div style="color:var(--ink2);margin-bottom:8px">产物目录结构（由流程模块声明）</div>' +
    (dirs.length ? dirs.map(d => '<div style="padding:5px 0;border-bottom:1px dashed var(--line)">📁 '+esc(d)+'</div>').join("") : '<div style="color:var(--ink2)">(无声明目录)</div>');
}
function renderTpl() {
  const el = $("pm-tpl");
  el.innerHTML = '<div style="color:var(--ink2)">产物模板 = 各 op 的 headerTemplate + maxChars 契约（D-A 调优：分镜 12000/剧本 10000/其余 6000-8000）。模板的项目级覆盖 = 二期（内核 config 合并链扩展后开放编辑）。</div>';
}

/* ---------- 右栏三面板 ---------- */
document.querySelectorAll("#rtabs .rt").forEach(t=>t.addEventListener("click",()=>{
  document.querySelectorAll("#rtabs .rt").forEach(x=>x.classList.remove("on"));t.classList.add("on");
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("on"));
  $("p-"+t.dataset.p).classList.add("on");
  if(t.dataset.p==="cv"&&CUR) loadCV();
}));
$("rtoggle").onclick=()=>{ $("right").classList.toggle("hide"); if(!$("right").classList.contains("hide")&&CUR) loadPanels(); };
function loadPanels(){ if(!CUR)return; loadWB(); loadFL(); loadCV(); }
async function loadWB(host){
  const d=await (await fetch("/api/panel/worldbook?project="+enc(CUR.id))).json();
  const el=host||$("p-wb");
  if(!(d.entries||[]).length){ el.innerHTML='<div style="color:var(--ink2);font-size:12px;padding:8px">本项目尚无世界书归纳（graph.json 空态）</div>'; return; }
  el.innerHTML='<div style="font-size:11px;color:var(--ink2);padding:2px 4px 8px">'+(d.entries||[]).length+' 词条 · '+(d.relations||[]).length+' 关系</div>'+
    (d.entries||[]).map(e=>'<div class="wb-e" data-t="'+esc(e.title||"")+'"><b>'+esc(e.title||e.id||"")+'</b><small>'+esc((e.tags||[]).join("、"))+'</small></div>').join("");
  el.querySelectorAll(".wb-e").forEach(x=>x.addEventListener("click",()=>{
    const e=(d.entries||[]).find(z=>(z.title||z.id)===x.dataset.t); if(!e)return;
    el.innerHTML='<span class="back" id="wb-back">← 返回词条列表</span><div id="wb-view" style="display:block"><h3>'+esc(e.title||"")+"</h3>"+md(e.summary||e.text||"(无正文)")+"</div>";
    $("wb-back").onclick=()=>loadWB(host);
  }));
}
async function showFileContent(path,host){
  const el=host||$("p-fl");
  const r=await (await fetch("/api/panel/files?project="+enc(CUR.id)+"&file="+enc(path))).json();
  el.innerHTML='<span class="back" id="fl-back">← 返回文件树</span><div style="font-size:12px;font-weight:700;margin-bottom:6px">'+esc(r.path||path)+'</div>'+
    (r.error?'<div style="color:var(--warn);font-size:12px">'+esc(r.error)+'</div>':'<pre>'+esc(r.content||"(空)")+'</pre>');
  $("fl-back").onclick=()=>loadFL(host);
  if(host) return;   // 窗格宿主：文件视图留在窗格内，不切右栏页签
  document.querySelectorAll("#rtabs .rt").forEach(x=>x.classList.remove("on"));
  document.querySelector('#rtabs .rt[data-p="fl"]').classList.add("on");
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("on"));
  $("p-fl").classList.add("on");
}
async function loadFL(host){
  const d=await (await fetch("/api/panel/files?project="+enc(CUR.id))).json();
  const el=host||$("p-fl");
  el.innerHTML='<div style="font-size:11px;color:var(--ink2);padding:2px 4px 8px">'+(d.files||[]).length+' 个文件（两层树，点击查看）</div><div id="fl-tree">'+
    (d.files||[]).map((f,i)=>'<div class="f" data-i="'+i+'"><span>'+esc(f.path)+'</span><span class="m">'+f.sizeKB+'KB</span></div>').join("")+"</div>";
  el.querySelectorAll(".f").forEach(x=>x.addEventListener("click",()=>{ const f=d.files[+x.dataset.i]; showFileContent(f.path,host); }));
}

/* ---------- 工作流面板（模块化初稿，设计：docs/设计-工作流面板模块化-初稿-20260927.md） ---------- */
const KIT_LABEL={topic:"选题",plan:"策划",plot:"剧情",prose:"文学",drama:"分镜",delivery:"交付",detect:"检测评估",search:"检索取数",base:"底座"};
let CV=null;   // {eff, st, tel, kit}
const kitLabel=k=>KIT_LABEL[k]||k;
async function loadCV(host){
  if(!CUR) return;
  const el=host||$("p-cv");
  el.innerHTML='<div style="color:var(--ink2);font-size:12px;padding:8px">载入生效编排…</div>';
  const rd=async f=>{ const r=await (await fetch("/api/panel/files?project="+enc(CUR.id)+"&file="+enc(f))).json(); return r.error?null:(r.content||""); };
  const effTxt=await rd("registry/effective.json");
  if(!effTxt){ el.innerHTML='<div style="color:var(--ink2);font-size:12px;padding:10px">该项目还没有生效编排（立项开跑后自动生成）。</div>'; return; }
  let stNodes={}; const stTxt=await rd("state.json");
  if(stTxt){ try{ stNodes=JSON.parse(stTxt).nodes||{}; }catch{} }
  let tel=null; try{ tel=(await (await fetch("/api/panel/telemetry?project="+enc(CUR.id))).json()).latest; }catch{}
  try{ CV={eff:JSON.parse(effTxt), st:stNodes, tel:tel||null, kit:null, host:host}; }catch{ el.innerHTML='<div style="color:var(--warn);font-size:12px;padding:10px">effective.json 解析失败。</div>'; return; }
  renderCV();
}
function cvDot(nid){
  const s=CV.st[nid]||{};
  if(s.stale) return '<span style="color:var(--warn)" title="stale：编排已改写，待重算">⚠</span>';
  if(s.status==="done") return '<span style="color:var(--ok)">✓</span>';
  if(!s.status||s.status==="pending") return '<span style="color:var(--ink2)">○</span>';
  return '<span style="color:var(--warn)">●</span>';
}
function renderCV(){
  const el=CV.host||$("p-cv");
  const kits=[], byKit={};
  for(const nid in CV.eff.nodes){
    const n=CV.eff.nodes[nid]; if(!n.kit) continue;
    if(!byKit[n.kit]){ byKit[n.kit]=[]; kits.push(n.kit); }
    byKit[n.kit].push(nid);
  }
  if(!kits.length){ el.innerHTML='<div style="color:var(--ink2);font-size:12px;padding:10px">生效编排里没有可归属模块的节点。</div>'; return; }
  if(!CV.kit||kits.indexOf(CV.kit)<0) CV.kit=kits[0];
  const links=CV.eff.links||[];
  const telBy={}; ((CV.tel&&CV.tel.nodes)||[]).forEach(n=>{ telBy[n.node]=n; });
  const stLine='<div style="font-size:10.5px;color:var(--ink2);padding:2px 4px 6px">'+esc(CV.eff.flowId||"")+' · '+Object.keys(CV.eff.nodes).length+' 节点 · 模块 '+kits.length+' · 关联门 '+links.length+'</div>';
  const chips=kits.map(k=>{
    const tot=byKit[k].length, done=byKit[k].filter(nid=>(CV.st[nid]||{}).status==="done").length;
    return '<span class="cv-chip'+(k===CV.kit?" on":"")+'" data-k="'+esc(k)+'">'+esc(kitLabel(k))+' '+done+"/"+tot+'</span>';
  }).join("");
  const nids=byKit[CV.kit];
  const doneN=nids.filter(nid=>(CV.st[nid]||{}).status==="done").length;
  const rows=nids.map((nid,i)=>{
    const n=CV.eff.nodes[nid], s=CV.st[nid]||{}, t=telBy[nid]||{};
    const flags=(t.judge&&t.judge.flagged)||[];
    const meta=(t.elapsedMs?Math.round(t.elapsedMs/1000)+"s":esc(s.status||"—"))+(flags.length?' · <span style="color:var(--warn)">⚖'+flags.length+'</span>':"");
    return '<div class="cv-n" data-i="'+i+'">'+cvDot(nid)+'<div class="cv-nt"><b>'+esc(n.title||nid)+'</b><small>'+esc(n.op||nid)+' · '+meta+'</small></div><span class="cv-arr">›</span></div>';
  }).join("");
  const myStage=(CV.eff.nodes[nids[0]]||{}).stage;
  const rel=links.filter(l=>l.fromModule===myStage||l.toModule===myStage).map(l=>{
    const arrow=l.fromModule===myStage?"→":"←";
    const other=l.fromModule===myStage?l.toModule:l.fromModule;
    return '<div class="cv-link">'+arrow+' 阶段 '+esc(other)+' · mode:'+esc(l.mode||"")+' <small>（连接门 · 调度参考，非固定顺序）</small></div>';
  }).join("")||'<div class="cv-link">（本项目无该模块的落盘关联）</div>';
  el.innerHTML=stLine+'<div style="padding:0 2px 4px">'+chips+'</div>'+
    '<div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-top:1px solid var(--line)">'+
    '<b style="font-size:13px">'+esc(kitLabel(CV.kit))+'模块</b><span style="font-size:11px;color:var(--ink2)">'+doneN+"/"+nids.length+' 完成</span><span style="flex:1"></span>'+
    '<button id="cv-rerun" class="cv-btn">↻ Agent 重跑</button><button id="cv-full" class="cv-btn">⤢ 画布</button></div>'+rows+
    '<div style="font-size:11px;color:var(--ink2);padding:10px 4px 4px">模块间关联（调度参考，非固定顺序）</div>'+rel;
  el.querySelectorAll(".cv-chip").forEach(c=>c.addEventListener("click",()=>{ CV.kit=c.dataset.k; renderCV(); }));
  el.querySelectorAll(".cv-n").forEach(x=>x.addEventListener("click",()=>{
    const nx=x.nextSibling;
    if(nx&&nx.classList&&nx.classList.contains("cv-det")){ nx.remove(); return; }
    const old=x.parentElement.querySelector(".cv-det"); if(old) old.remove();
    const nid=nids[+x.dataset.i], n=CV.eff.nodes[nid], s=CV.st[nid]||{}, t=telBy[nid]||{};
    const file=n.output||s.lastArtifact||"";
    const flags=(t.judge&&t.judge.flagged)||[];
    const html='<div class="cv-det"><b>'+esc(nid)+'</b>'+
      (n.desc?'<p style="color:var(--ink2)">'+esc(n.desc)+'</p>':"")+
      '<p>状态：'+esc(s.status||"pending")+(s.round?' · 第'+s.round+'轮提交':"")+(s.note?' · '+esc(s.note):"")+'</p>'+
      (t.detail?'<p>遥测：'+esc(t.detail)+'</p>':"")+
      (flags.length?'<p style="color:var(--warn)">判官 flagged：'+esc(flags.join("、"))+'</p>':"")+
      (file?'<p>产物：<span class="cv-file" data-f="'+esc(file)+'">'+esc(file)+'（点击查看）</span></p>':"")+
      '</div>';
    const tmp=document.createElement("div"); tmp.innerHTML=html; const det=tmp.firstChild;
    x.after(det);
    const f=det.querySelector(".cv-file");
    if(f) f.addEventListener("click",()=>showFileContent(f.dataset.f,CV.host));
  }));
  const rr=el.querySelector("#cv-rerun");
  if(rr) rr.addEventListener("click",()=>{
    const cmd="重跑「"+kitLabel(CV.kit)+"」模块：先感知该模块现有产物与上下游关联，自行判断重跑范围与方式，逐节点重做并交卷。";
    $("tab-chat").click(); $("input").value=cmd; sendMsg();
  });
  const fv=el.querySelector("#cv-full");
  if(fv) fv.addEventListener("click",openCvFull);
}
function openCvFull(){
  if(!CUR) return;
  $("cvf-name").textContent=$("pname").textContent;
  $("cvf-frame").src="/api/panel/canvas?project="+enc(CUR.id);   // B5 同源代理——跨源 iframe 第三方存储白屏规避
  $("cv-overlay").classList.add("on");
}
$("cvf-close").addEventListener("click",()=>{ $("cv-overlay").classList.remove("on"); $("cvf-frame").src="about:blank"; });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$("cv-overlay").classList.contains("on")) $("cvf-close").click(); });
// 焦点落在画布 iframe 内时 Esc 不冒泡到父文档——同源代理后可在 load 后进 iframe 挂监听
$("cvf-frame").addEventListener("load",()=>{ try{ $("cvf-frame").contentDocument.addEventListener("keydown",e=>{ if(e.key==="Escape") $("cvf-close").click(); }); }catch{ /* 跨源时静默 */ } });

/* ---------- 主区窗格：分屏 / 全屏 / 收起（参照 dsh mockup，09-27 甲方三图） ---------- */
let P2={kind:null, active:false};
$("b-side").onclick=()=>{ const s=$("side"); s.style.display = s.style.display==="none" ? "flex" : "none"; };
$("b-split").onclick=()=>{ const on=$("view").classList.toggle("sp"); $("b-split").style.color=on?"var(--acc)":"";
  if(on){ $("right").classList.add("hide"); if(P2.kind) p2Open(P2.kind); else p2Choose(); }   // 分屏=右栏让位；重开刷新上次内容（融合：同一批渲染器）
  else { document.body.classList.remove("z2"); P2.active=false; $("right").classList.remove("hide"); if(CUR) loadPanels(); }
};
$("b-full").onclick=()=>{
  const b=document.body;
  if(b.classList.contains("z1")||b.classList.contains("z2")){ b.classList.remove("z1","z2"); $("b-full").style.color=""; return; }
  b.classList.add($("view").classList.contains("sp")&&P2.active ? "z2" : "z1");
  $("b-full").style.color="var(--acc)";
};
$("p2-close").onclick=()=>{ $("view").classList.remove("sp"); $("b-split").style.color=""; P2.active=false; document.body.classList.remove("z2"); $("right").classList.remove("hide"); if(CUR) loadPanels(); };
$("p2-re").onclick=()=>p2Choose();
const CONTENTS=[   // 内容注册表：右栏页签与分屏窗格共用同一批渲染器（内容融合，09-28 甲方拍板）
  ["wb","📖","世界书","设定词条与关系"],
  ["cv","🧩","工作流","模块化流程视图"],
  ["fl","📄","文档","浏览当前项目的文件"],
  ["traj","🧭","轨迹","运行遥测明细"],
  ["web","🌐","浏览器","画布或任意网页"]
];
function p2Choose(){
  P2.kind=null; P2.active=true;
  $("p2-title").textContent="选择内容";
  $("p2-body").innerHTML='<div id="p2-choose">'+CONTENTS.map(c=>
    '<div class="p2c" data-c="'+c[0]+'"><span>'+c[1]+'</span><div><b>'+c[2]+'</b><small>'+c[3]+'</small></div><span class="k">'+(c[0]==="web"?"内嵌":"面板")+'</span></div>').join("")+'</div>';
  $("p2-body").querySelectorAll(".p2c").forEach(c=>c.addEventListener("click",()=>p2Open(c.dataset.c)));
}
function p2Open(kind){
  if(!CUR && kind!=="web"){ $("p2-body").innerHTML='<div style="color:var(--ink2);font-size:12px;padding:14px">先在左栏选一个项目。</div>'; $("p2-title").textContent="选择内容"; return; }
  P2.kind=kind; P2.active=true;
  const meta=CONTENTS.find(c=>c[0]===kind)||[kind,"","",kind];
  $("p2-title").textContent=kind==="web"?meta[2]:meta[2]+" · "+CUR.id;
  const b=$("p2-body");
  b.style.display="block"; b.style.overflow="auto";
  if(kind==="wb") loadWB(b);
  else if(kind==="cv") loadCV(b);
  else if(kind==="fl") loadFL(b);
  else if(kind==="traj"){ b.innerHTML='<div style="color:var(--ink2);font-size:12.5px;padding:12px 14px">载入遥测…</div>'; renderTrajInto(b); }
  else { b.style.display="flex"; b.style.flexDirection="column"; b.style.overflow="hidden"; p2Web(""); }
}

function p2Web(url){
  const b=$("p2-body");
  if(!url) url = CUR ? "/api/panel/canvas?project="+enc(CUR.id) : "http://127.0.0.1:8421/";
  b.innerHTML='<div style="flex:none;display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line)">'+
    '<input id="p2-url" value="'+esc(url)+'" placeholder="输入网址；留空回项目画布">'+
    '<button id="p2-go" class="cv-btn">前往</button></div>'+
    '<iframe id="p2-frame" style="flex:1;border:none;width:100%;background:#fff"></iframe>';
  const go=()=>{ $("p2-frame").src=$("p2-url").value.trim() || (CUR?"/api/panel/canvas?project="+enc(CUR.id):"http://127.0.0.1:8421/"); };
  $("p2-go").addEventListener("click",go);
  $("p2-url").addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
  go();
}
(function(){   // 左栏与分屏分界可拖拽（宽度持久化）
  const sd=$("sdiv");
  sd.addEventListener("mousedown",e=>{
    e.preventDefault(); sd.classList.add("on");
    const move=ev=>{ $("side").style.width=Math.min(460,Math.max(170,ev.clientX))+"px"; };
    const up=()=>{ document.removeEventListener("mousemove",move); document.removeEventListener("mouseup",up); sd.classList.remove("on"); try{localStorage.setItem("sh-sidew",$("side").style.width)}catch{} };
    document.addEventListener("mousemove",move); document.addEventListener("mouseup",up);
  });
  try{ const w=localStorage.getItem("sh-sidew"); if(w) $("side").style.width=w; }catch{}
  const pd=$("pdiv");
  pd.addEventListener("mousedown",e=>{
    e.preventDefault();
    const vw=document.getElementById("view").getBoundingClientRect();
    const move=ev=>{ $("pane2").style.width=Math.min(72,Math.max(24,(vw.right-ev.clientX)/vw.width*100))+"%"; };
    const up=()=>{ document.removeEventListener("mousemove",move); document.removeEventListener("mouseup",up); try{localStorage.setItem("sh-p2w",$("pane2").style.width)}catch{} };
    document.addEventListener("mousemove",move); document.addEventListener("mouseup",up);
  });
  try{ const w=localStorage.getItem("sh-p2w"); if(w) $("pane2").style.width=w; }catch{}
})();

/* ---------- 状态灯 ---------- */
(async()=>{ try{const m=await (await fetch("/api/agent/model")).json();$("model")&&0;
  document.querySelectorAll("#foot-model,#model").forEach(e=>{}); }catch{} })();
setInterval(async()=>{ try{const s=await (await fetch("/status")).json();
  $("status").textContent=s.running?"● 排期推进中":"● 空闲";
  $("status").style.color=s.running?"var(--warn)":"var(--ok)";
}catch{}},5000);
(async()=>{ try{
  const m=await (await fetch("/api/agent/model")).json();
  $("foot-model").textContent=m.model||"—";
  $("status").textContent=m.configured?"● 就绪":"● 未配模型";
  $("status").style.color=m.configured?"var(--ok)":"var(--warn)";
}catch{$("status").textContent="● 离线"} })();
const wsCollapsed = new Set();
$("ws-add").addEventListener("click",()=>{ const f=$("ws-form"); f.style.display=f.style.display==="none"?"block":"none"; });
$("wsf-go").addEventListener("click",async()=>{
  const name=$("wsf-name").value.trim(), pth=$("wsf-path").value.trim();
  if(!name||!pth){ alert("名称与路径都要填"); return; }
  try{
    const r=await (await fetch("/api/workspaces",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,path:pth})})).json();
    if(r.error) throw new Error(r.error);
    $("wsf-name").value=""; $("wsf-path").value=""; $("ws-form").style.display="none";
    await loadHub();
  }catch(e){ alert("创建失败："+e.message) }
});
loadHub();
</script>
</body>
</html>`;
