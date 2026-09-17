
const DATA = JSON.parse(document.getElementById("payload").textContent);
const flow = DATA.flow, files = DATA.files, RS = DATA.runstate;
const nodes = flow.graph.nodes, edges = flow.graph.edges;
document.getElementById("t").textContent = "工作流画布 · " + (flow.title || flow.id).replace(/^智能选题工作流 /,"");
document.getElementById("v").textContent = "v" + flow.version + " ｜ 项目 " + DATA.project;
if (DATA.deliveryPage) { const a = document.getElementById("dl-link"); a.href = DATA.deliveryPage; a.style.display = ""; }

/* ---------- 中文名映射（画布不露英文术语） ---------- */
const ZH = {"find-trope":"找梗师","internet-feel":"网感师","plot-choreographer":"剧情编排师","plot-redline":"红方评审",
  "topic-zeitgeist":"热点扫描","topic-analysis-report":"调研分析","topic-proposal":"方案主笔",
  "topic-chief-aesthetic":"审美总编","topic-delivery-gate":"交付监理","script-drama-beat":"分镜编剧",
  "scene-breakdown":"小纲师","script-final":"成品剧本师","dialogue-polish":"台词打磨",
  "structure-design":"结构选型师","novel-bible":"开书师","novel-chapter":"章回写手","deconstruct-book":"拆书师",
  "render-html":"交付页渲染","kb_load":"知识装载","kb_search":"知识检索","check_trope_combo":"梗组合校验",
  "check_aesthetic_asserts":"审美断言","check_contract_compliance":"约束对账","docx_ingest":"批注解析",
  "continuity_slice":"台账切片","continuity_commit":"台账结算","meme_harvest":"梗素材采集"};
const ST_ZH = {"done":"已完成","awaiting":"待决","pending":"待重跑","none":"未启动"};
const STAGE_ZH = {"S1":"调研","S2":"结构","S3":"大纲","S4":"小纲","S5":"成稿"};
const STAGE_COLOR = {"S1":"#5e7d5a","S2":"#4f6d8c","S3":"#9c6b4a","S4":"#7d5f8a","S5":"#a5546b"};

/* ---------- 运行状态 ---------- */
function st(n){ const s = (RS.nodes[n]||{}).status || "none"; return s; }
function persistState(){
  saveFile("run-state.json", JSON.stringify(RS, null, 2), "json")
    .then(m => { const el = document.getElementById("saved"); if (el) el.textContent = m; });
}
window.persistState = persistState;
const handles = {};
async function saveFile(name, content, ext){
  try{
    if (window.showSaveFilePicker){
      const h = handles[name] || await showSaveFilePicker({suggestedName: name});
      handles[name] = h;
      const w = await h.createWritable(); await w.write(content); await w.close();
      return "已写回 " + name;
    }
    throw 0;
  }catch(e){
    if (e && e.name === "AbortError") return "已取消";
    const b = new Blob([content], {type: ext==="json"?"application/json":"text/markdown"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = name.split("/").pop(); a.click();
    return "浏览器不支持直接写盘，已下载（放回项目目录即生效）";
  }
}

/* ---------- 布局：最长上游链分层 + 重心排序 ---------- */
const NW=196, NH=76, GX=88, GY=64, MG=44;
let pos = {};
function computeLayers(){
  // 阶段优先布局：先按 stage 分组，阶段内再按拓扑排序
  const ids = Object.keys(nodes), ins = {}, outs = {};
  ids.forEach(i => {ins[i]=[];outs[i]=[];});
  edges.forEach(e => { if(nodes[e.from]&&nodes[e.to]){ outs[e.from].push(e.to); ins[e.to].push(e.from);} });
  // 按 stage 分组，保持 stages 数组中的顺序
  const stageOrder = (flow.stages||[]).map(s=>s.id);
  const stageOf = {};
  ids.forEach(i => { stageOf[i] = nodes[i].stage || stageOrder[0]; });
  // 阶段内拓扑排序（入度法）
  const result = [];
  const staged = {};
  for (const sid of stageOrder) {
    const group = ids.filter(i => stageOf[i] === sid);
    if (!group.length) continue;
    // 阶段内拓扑：入度为 0 的先出
    const inDeg = {};
    group.forEach(i => inDeg[i] = 0);
    for (const e of edges) {
      if (group.includes(e.from) && group.includes(e.to)) inDeg[e.to] = (inDeg[e.to]||0)+1;
    }
    const queue = group.filter(i => !inDeg[i]);
    const sorted = [];
    while (queue.length) {
      const n = queue.shift(); sorted.push(n);
      for (const e of edges) {
        if (e.from === n && group.includes(e.to)) {
          inDeg[e.to]--;
          if (inDeg[e.to] <= 0) queue.push(e.to);
        }
      }
    }
    // 拓扑排序后如果有剩余（环），按 id 排
    const rest = group.filter(x => !sorted.includes(x)).sort();
    sorted.push(...rest);
    staged[sid] = sorted;
    result.push({ sid, nodes: sorted });
  }
  // 分列：每阶段至少 1 列，节点多的阶段拆多列
  const cols = [];
  let maxRows = 0;
  for (const { sid, nodes: group } of result) {
    const per = Math.ceil(group.length / Math.max(1, Math.ceil(group.length / 4)));
    for (let i = 0; i < group.length; i += per) {
      cols.push({ sid, nodes: group.slice(i, i + per) });
    }
    maxRows = Math.max(maxRows, per);
  }
  return { cols, maxRows: Math.max(maxRows, 3) };
}
function autoLayout(){
  const {Ls, byL} = computeLayers();
  Ls.forEach(l=>{
    const colH = byL[l].length*(NH+GY)-GY;
    let maxRows = 0; Ls.forEach(x=>maxRows=Math.max(maxRows,byL[x].length));
    const y0 = MG + Math.max(0,(maxRows*(NH+GY)-colH)/2);
    byL[l].forEach((n,k)=>{ pos[n] = [MG + l*(NW+GX), Math.round(y0 + k*(NH+GY))]; });
  });
  render();
}
function fitView(){
  const xs = Object.values(pos).map(p=>p[0]), ys = Object.values(pos).map(p=>p[1]);
  const w = Math.max(...xs)+NW+MG, h = Math.max(...ys)+NH+MG;
  const st = document.getElementById("stage");
  const k = Math.min(st.clientWidth/w, st.clientHeight/h, 1.2);
  view = {k, x:(st.clientWidth-w*k)/2, y:Math.max(10,(st.clientHeight-h*k)/2)};
  applyView();
}

/* ---------- 视图变换 ---------- */
let view = {k:1, x:40, y:30};
function applyView(){ document.getElementById("world").style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; }
document.getElementById("stage").addEventListener("wheel", e=>{
  e.preventDefault();
  const r = document.getElementById("stage").getBoundingClientRect();
  const mx = e.clientX-r.left, my = e.clientY-r.top;
  const k2 = Math.min(2.2, Math.max(0.35, view.k * (e.deltaY<0?1.12:0.89)));
  view.x = mx-(mx-view.x)*k2/view.k; view.y = my-(my-view.y)*k2/view.k; view.k = k2; applyView();
}, {passive:false});
let panning = null;
document.getElementById("stage").addEventListener("mousedown", e=>{
  if (e.target.closest(".node") || e.target.closest("#inspector")) return;
  panning = {x:e.clientX, y:e.clientY, vx:view.x, vy:view.y};
});
window.addEventListener("mousemove", e=>{
  if (drag) { dragMove(e); return; }
  if (panning){ view.x = panning.vx+e.clientX-panning.x; view.y = panning.vy+e.clientY-panning.y; applyView(); }
});
window.addEventListener("mouseup", ()=>{ panning=null; if(drag){drag=null; render();} });

/* ---------- 渲染 ---------- */
function nodeOutputs(n){
  const outs = (flow.outputs||[]).filter(o=>o.node===n).map(o=>o.file);
  for (const k of ["output","file"]) { const v = nodes[n][k]; if (v && !outs.includes(v)) outs.push(v); }
  return outs;
}
function render(){
  const nc = document.getElementById("nodes"); nc.innerHTML = "";
  for (const [n,m] of Object.entries(nodes)){
    const [x,y] = pos[n];
    const d = document.createElement("div");
    const gate = (m.kind==="gate"||m.kind==="srd");
    const s = st(n), isDel = (flow.graph.outputs||[]).includes(n);
    d.className = `node k-${m.kind}` + (sel===n?" sel":"");
    d.style.left = x+"px"; d.style.top = y+"px";
    const zhTag = m.skill ? (ZH[m.skill]||m.skill) : (m.minitool ? (ZH[m.minitool]||m.minitool) : (gate?"红方验收":""));
    d.innerHTML = `<div class="accent" style="background:${gate?"#a5433a":(STAGE_COLOR[m.stage]||"#b8b0a4")}"></div>
      <div class="hd"><span class="dot st-${s}" title="${ST_ZH[s]||s}"></span><span class="zh">${zhTitle(m)}</span></div>
      <div class="sub">${zhTag}${m.stage?" · "+m.stage:""}</div>
      ${isDel?`<span class="out">交 付</span>`:""}`;
    d.addEventListener("mousedown", e=>startDrag(e,n));
    d.addEventListener("click", e=>{ e.stopPropagation(); select(n); });
    nc.appendChild(d);
  }
  drawEdges(); hud();
}
function zhTitle(m){ return m.title || "未命名节点"; }
let sel = null, selEdge = null, tab = "info";
function drawEdges(){
  const svg = document.getElementById("edges");
  let maxC = 0; Object.values(pos).forEach(p=>maxC=Math.max(maxC,p[0]));
  const W = maxC+NW+MG+60, H = 2600;
  let s = `<svg width="${W}" height="${H}" style="position:absolute;left:0;top:0;overflow:visible"><defs><marker id="arw" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 z" fill="#a89f90"/></marker></defs>`;
  // 阶段竖线：相邻列阶段变化处画竖线 + 阶段名
  const colStage = {};
  for (const [n,p] of Object.entries(pos)){
    const c = Math.round((p[0]-MG)/(NW+GX));
    const sg = nodes[n].stage || "?";
    colStage[c] = colStage[c] || {}; colStage[c][sg] = (colStage[c][sg]||0)+1;
  }
  const cols = Object.keys(colStage).map(Number).sort((a,b)=>a-b);
  let runs = [], run = null;
  cols.forEach(c=>{ const sg=(()=>{let b=null,bn=0;for(const[k,v] of Object.entries(colStage[c])) if(v>bn){bn=v;b=k;} return b;})(); if(run&&run.stage===sg){run.to=c;} else {if(run)runs.push(run);run={stage:sg,from:c,to:c};} });
  if (run) runs.push(run);
  runs.forEach(r=>{
    if (!r.stage || r.stage==="?") return;
    const x = MG + r.from*(NW+GX) - 26, x2 = MG + (r.to+1)*(NW+GX) + 6;
    const col = STAGE_COLOR[r.stage] || "#b8b0a4";
    s += `<line class="stage-rule" x1="${x}" y1="20" x2="${x}" y2="${H-40}" stroke="${col}" stroke-width="1.2"/>`;
    s += `<text class="stage-name" x="${x+8}" y="34" fill="${col}">${STAGE_ZH[r.stage]||r.stage}</text>`;
  });
  // 派生回环：每阶段 gate 菱形 → 本阶段入口（修改流）/ 全局入口（从零构筑）
  let li = 0;
  const stageEntry = {}; (flow.stages||[]).forEach(x=>stageEntry[x.id]=x.entry);
  (flow.stages||[]).forEach((st,si)=>{
    const g = st.gate; if (!g || !pos[g]) return;
    const gx=pos[g][0]+NW/2, gy=pos[g][1]+NH;
    const drawArc = (target,color,label)=>{
      if (!pos[target]) return;
      const tx=pos[target][0]+NW/2, ty=pos[target][1]+NH;
      const by=Math.max(gy,ty)+40+(li++%3)*24;
      s += `<path class="edge-hit" data-e="${g}-loop" d="M${gx},${gy} C${gx},${by} ${tx},${by} ${tx},${ty}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="7,4" marker-end="url(#arw)"/>`;
      s += `<text class="loop-label" x="${(gx+tx)/2}" y="${by-4}" fill="${color}" text-anchor="middle">${label}</text>`;
    };
    drawArc(stageEntry[st.id], "#a5433a", st.id+" 打回·修改流");
    if (si>0) drawArc(stageEntryFirst(), "#7a4a4a", st.id+" 打回·从零构筑");
  });
  function stageEntryFirst(){ const sts=(flow.stages||[]); return sts.length?sts[0].entry:null; }
  function stageEntryOf(id){ const st=(flow.stages||[]).find(x=>x.id===id); return st?st.entry:null; }
  // 前向边
  for (const e of edges){
    if (e.loop) continue; // 派生回环已画
    if (!pos[e.from] || !pos[e.to]) continue;
    const [x1,y1] = pos[e.from], [x2,y2] = pos[e.to];
    const sx=x1+NW, sy=y1+NH/2, tx=x2, ty=y2+NH/2, mx=(sx+tx)/2;
    const active = isEdgeActive(e);
    s += `<path class="edge-hit" data-e="${e.id}" d="M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}" fill="none" stroke="#a89f90" stroke-width="1.4"${(e.optional||e.when)?' stroke-dasharray="5,4"':""} opacity="${active?0.9:0.35}" marker-end="url(#arw)"/>`;
    if (e.transform) s += `<text class="edge-label" x="${mx}" y="${(sy+ty)/2-4}" text-anchor="middle">${e.transform}</text>`;
  }
  svg.innerHTML = s + "</svg>";
  svg.querySelectorAll(".edge-hit").forEach(p=>{
    p.addEventListener("click", ev=>{ ev.stopPropagation(); selectEdge(p.dataset.e); });
  });
}
function stageEntryOf(id){ const st=(flow.stages||[]).find(x=>x.id===id); return st?st.entry:null; }
function stageEntryFirst(){ const sts=(flow.stages||[]); return sts.length?sts[0].entry:null; }
function isEdgeActive(e){
  if ((e.when||"").includes("rejected")) return (RS.gate||{}).verdict === "rejected";
  if ((e.when||"").includes("challenge")) return (RS.nodes["gate-r2"]||{}).verdict === "challenge";
  if ((e.when||"").includes("route=dual")) return (flow.inputs.route||{}).default === "dual" || (RS.inputs||{}).route === "dual";
  if ((e.when||"").includes("批注回流")) return (RS.inputs||{}).批注回流 === "on";
  return true;
}
function hud(){
  const c = {done:0, awaiting:0, pending:0};
  Object.keys(nodes).forEach(n=>{ const s=st(n); c[s]=(c[s]||0)+1; });
  document.getElementById("hud").innerHTML =
    `<span>节点 <b>${Object.keys(nodes).length}</b></span><span>完成 <b>${c.done||0}</b></span><span>待决 <b>${c.awaiting||0}</b></span><span>待重跑 <b>${c.pending||0}</b></span><span id="saved"></span>`;
}

/* ---------- 拖拽 ---------- */
let drag = null;
function startDrag(e, n){
  e.stopPropagation();
  drag = {n, sx:e.clientX, sy:e.clientY, ox:pos[n][0], oy:pos[n][1]};
}
function dragMove(e){
  const k = view.k;
  pos[drag.n] = [Math.round(drag.ox + (e.clientX-drag.sx)/k), Math.round(drag.oy + (e.clientY-drag.sy)/k)];
  render();
}
function commitDrag(){ drag = null; }

/* ---------- 检查器 ---------- */
function select(n){ sel = n; selEdge = null; tab = nodeOutputs(n).length ? "snap" : "info"; openInsp(); }
function openInsp(){ drawTabs(); fill(); }
function selectEdge(id){
  sel = null; selEdge = edges.find(e=>e.id===id); openInsp();
  document.getElementById("i-title").textContent = "衔接 · " + selEdge.id;
  document.getElementById("i-tabs").style.display = "none";
  document.getElementById("i-body").innerHTML = `<div class="kv">
    <span class="k">衔接</span><span class="v">${selEdge.from} → ${selEdge.to}</span>
    <span class="k">变换</span><span class="v"><code>${selEdge.transform||"-"}</code></span>
    <span class="k">条件</span><span class="v">${selEdge.when||"-"}${selEdge.optional?" ｜ 可选":""}</span>
    <span class="k">语义</span><span class="v">${selEdge.desc||"-"}</span></div>`;
  render();
}
function closeInsp(){ document.getElementById("inspector").classList.remove("on"); sel=null; selEdge=null; render(); }
document.querySelectorAll("#i-tabs button").forEach(b=>b.addEventListener("click",()=>{ tab=b.dataset.t; drawTabs(); fill(); }));
function drawTabs(){
  document.querySelectorAll("#i-tabs button").forEach(b=>b.classList.toggle("on", b.dataset.t===tab));
  document.getElementById("i-tabs").style.display = sel ? "flex" : "none";
  document.getElementById("i-title").textContent = sel ? ("节点 · " + zhTitle(nodes[sel])) : "—";
}
function mdHtml(md){
  let h = md.replace(/&/g,"&amp;").replace(/</g,"&lt;");
  h = h.replace(/^#### (.*)$/gm,"<h4>$1</h4>").replace(/^### (.*)$/gm,"<h4>$1</h4>").replace(/^## (.*)$/gm,"<h3>$1</h3>").replace(/^# (.*)$/gm,"<h2>$1</h2>");
  h = h.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/`([^`]+)`/g,"<code>$1</code>");
  h = h.replace(/^---+$/gm,"<hr>");
  h = h.replace(/^\|(.+)\|$/gm,(m,row)=>{ const c=row.split("|").map(x=>x.trim()); if(c.every(x=>/^:?-{2,}:?$/.test(x))) return ""; return "<tr>"+c.map(x=>`<td>${x}</td>`).join("")+"</tr>"; });
  h = h.replace(/(<tr>[\s\S]*?<\/tr>)/, "<table>$1</table>").replace(/<\/tr>(\s*)<tr>/g,"</tr><tr>").replace(/<\/table>\s*<table>/g,"");
  h = h.replace(/^- (.*)$/gm,"<li>$1</li>").replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g,"<ul>$1</ul>");
  h = h.split(/\n{2,}/).map(b=>/^<(h\d|table|ul|hr)/.test(b.trim())?b:"<p>"+b.replace(/\n/g,"<br>")+"</p>").join("\n");
  return h;
}
function fill(){
  const body = document.getElementById("i-body");
  if (!sel){ body.innerHTML=""; return; }
  const m = nodes[sel];
  if (tab === "info"){
    body.innerHTML = `<div class="kv">
      <span class="k">节点</span><span class="v">${sel}</span>
      <span class="k">类型</span><span class="v">${m.kind}${m.stage?` ｜ <b style="color:#7d5f8a">${m.stage} ${STAGE_ZH[m.stage]||""}</b>`:""}</span>
      <span class="k">说明</span><span class="v">${m.title||"-"}</span>
      ${m.skill?`<span class="k">技能</span><span class="v"><code>skills/${m.skill}.md</code></span>`:""}
      ${m.minitool?`<span class="k">工具</span><span class="v"><code>${m.minitool}</code></span>`:""}
      ${(m.assist||[]).length?`<span class="k">协作</span><span class="v">${m.assist.join("、")}</span>`:""}
      ${(m.kb||[]).length?`<span class="k">知识依据</span><span class="v">${m.kb.map(k=>`<code>${k}</code>`).join(" ")}</span>`:""}
      ${m.file?`<span class="k">产物</span><span class="v"><code>${m.file}</code></span>`:""}
      <span class="k">状态</span><span class="v">${ST_ZH[st(sel)]}（第 ${(RS.nodes[sel]||{}).round||1} 轮）</span>
      </div><p class="msg">${m.desc||""}</p>
      ${commentHtml()}
      ${(m.kind==="gate"||m.kind==="srd")?verdictHtml():""}`;
    bindVerdict(); bindComment();
  } else if (tab === "snap"){
    const outs = nodeOutputs(sel);
    if (!outs.length){ body.innerHTML = `<p class="msg">该节点无独立产物（${(m.kind==="gate"||m.kind==="srd")?"验收门节点：裁决记录见运行状态":"结构性步骤，产出汇入下游"}）。</p>${(m.kind==="gate"||m.kind==="srd")?verdictHtml():""}`; bindVerdict(); return; }
    const vers = (DATA.snapshots[sel]||[]);
    if (!vers.length){
      body.innerHTML = `<p class="msg">尚无产物快照（节点未执行或未捕获）。</p>` + ((m.kind==="gate"||m.kind==="srd") ? verdictHtml() : "");
      bindVerdict(); return;
    }
    let html = `<div class="kv"><span class="k">快照版本</span><span class="v"><select id="ver-sel" class="ver-sel">${vers.map((v,i)=>`<option value="${i}">第 ${v.round} 轮 · ${v.ts}${v.note?" · "+v.note:""}</option>`).join("")}</select></span></div>`;
    html += `<div id="snap-view"></div>`;
    html += (m.kind==="gate"||m.kind==="srd") ? verdictHtml() : "";
    body.innerHTML = html;
    const render2 = ()=>{
      const i = parseInt((document.getElementById("ver-sel")||{}).value||"0");
      const v = vers[vers.length-1-i] || vers[0];
      const prev = (i+1 < vers.length) ? vers[vers.length-2-i] || null : null;
      let h = "";
      const vcontent = v.content || {};
      for (const f of Object.keys(vcontent)){
        h += `<div class="kv"><span class="k">文件</span><span class="v"><code>${f}</code></span></div><div class="md">${mdHtml(vcontent[f])}</div>`;
      }
      if (prev){
        h += `<p class="msg">与上一版差异：</p><pre class="task">`;
        for (const [f, meta] of Object.entries(v.files||{})){
          const a = (prev.content||{})[f] || "";
          const b = v.content[f] || "";
          if (a !== b){
            const A = a.split("\n"), B = b.split("\n");
            let s2 = 0; while(s2 < A.length && s2 < B.length && A[s2]===B[s2]) s2++;
            let ea = A.length, eb = B.length;
            while(ea > s2 && eb > s2 && A[ea-1]===B[eb-1]){ea--;eb--;}
            for(let k=s2;k<ea;k++) h += `<span class="d-del">- ${A[k].replace(/&/g,"&amp;").replace(/</g,"&lt;")}</span><br>`;
            for(let k=s2;k<eb;k++) h += `<span class="d-add">+ ${B[k].replace(/&/g,"&amp;").replace(/</g,"&lt;")}</span><br>`;
          }
        }
        h += `</pre>`;
      }
      document.getElementById("snap-view").innerHTML = h;
    };
    const vs = document.getElementById("ver-sel");
    if (vs) vs.addEventListener("change", render2);
    render2();
    bindVerdict();
  } else if (tab === "edit"){
    const outs = nodeOutputs(sel);
    if (!outs.length){ body.innerHTML = `<p class="msg">该节点无独立产物可编辑。</p>`; return; }
    const f = outs[0], c = files[f] || "";
    body.innerHTML = `<div class="kv"><span class="k">编辑</span><span class="v"><code>${f}</code>（保存写回项目文件）</span></div>
      <textarea id="et">${c.replace(/</g,"&lt;")}</textarea>
      <div class="act"><button class="tb" style="background:#262420;color:#f4f1ea;border-color:#262420" id="esave">保存改动</button><span class="msg" id="emsg"></span></div>`;
    document.getElementById("esave").onclick = async ()=>{
      const nv = document.getElementById("et").value;
      files[f] = nv;
      (DATA.snapshots[sel] = DATA.snapshots[sel] || []).push({round: (RS.nodes[sel]||{}).round||1, ts: new Date().toLocaleString(), note: "用户修改", content: {[f]: nv}});
      const msg = await saveFile(f, nv, "md");
      document.getElementById("emsg").textContent = msg + " ｜ 已登记新版本（宿主可 diff 感知）";
    };
  } else if (tab === "rerun"){
    const upstream = edges.filter(e=>e.to===sel && !(e.when||"").includes("rejected") && !(e.when||"").includes("challenge")).map(e=>e.from);
    const stageOf = {}; (flow.stages||[]).forEach(s=>(s.nodes||[]).forEach(x=>stageOf[x]=s.id));
    const myStage = stageOf[sel];
    const preset = (RS.presets||{})[myStage] || "semi";
    const inputs = {}; upstream.forEach(u=>nodeOutputs(u).forEach(f=>{ if(files[f]) inputs[f]="✓"; }));
    const tp = {runId: DATA.project+"-r"+((RS.nodes[sel]||{}).round||1), nodeId: sel, kind: m.kind,
      skill: m.skill||undefined, minitool: m.minitool||undefined, assist: m.assist||undefined,
      kb: m.kb||undefined, inputs: inputs,
      inputs_note: upstream.length ? "上游产物：" + upstream.join("、") : "无上游",
      output: m.file || nodeOutputs(sel)[0] || "(汇入下游)",
      preset: preset,
      note: m.kind==="agent" ? "认知任务包：宿主 Agent 用自己的 token 执行，flow_submit 回交" : "确定性步骤：由工具进程零 token 执行"};
    body.innerHTML = `<p class="msg">重跑范围：从本节点重跑，<b>到本阶段验收门即停</b>；未变化的上游走缓存命中（Agent 上下文复用，只喂差异）。</p>
      <div class="vbtns">
        <button class="tb" style="border-color:#262420;font-weight:700" id="r-from">从本节点重跑 → 阶段门</button>
        <button class="tb" id="r-zero">本阶段从零重做</button>
      </div>
      <div class="task">${JSON.stringify(tp, null, 2)}</div>
      <div class="act"><span class="msg" id="rmsg">标记后由宿主 / 运行时消费。</span></div>`;
    document.getElementById("r-from").onclick = ()=>{ markRerun(sel); fill(); };
    const rz = document.getElementById("r-zero");
    if (rz) rz.onclick = ()=>{ const stg = (flow.stages||[]).find(x=>x.nodes && x.nodes.includes(sel)); if (stg && stg.entry) markRerun(stg.entry); };
    function markRerun(target){
      RS.nodes[sel] = RS.nodes[sel] || {};
      RS.nodes[sel].verdict = "send-back";
      RS.nodes[sel].status = "pending";
      RS.nodes[sel].round = (RS.nodes[sel].round||1)+1;
      if (target && RS.nodes[target]) { RS.nodes[target].status = "pending"; RS.nodes[target].round = (RS.nodes[target].round||1)+1; }
      render(); fill();
    }
  }
}
function commentHtml(){
  const list = (RS.comments||{})[sel] || [];
  return `<p class="msg" style="margin:14px 0 4px">批注意见</p>
    <div id="cmt-list">${list.map(c=>`<div class="cmt">${c}</div>`).join("")}</div>
    <textarea id="cmt-new" style="min-height:56px" placeholder="补充意见…"></textarea>
    <div class="act"><button class="tb" id="cmt-add">登记意见</button></div>`;
}
function bindComment(){
  const btn = document.getElementById("cmt-add"), box = document.getElementById("cmt-new");
  if (!btn || !box) return;
  btn.onclick = ()=>{
    const v = box.value.trim(); if (!v) return;
    (RS.comments = RS.comments || {})[sel] = (RS.comments[sel]||[]).concat(v);
    box.value = "";
    const l = document.getElementById("cmt-list");
    if (l) l.insertAdjacentHTML("beforeend", `<div class="cmt">${v}</div>`);
    persistState();
  };
}
function verdictHtml(){
  const v = (RS.nodes[sel]||{}).verdict || "awaiting";
  const sts = (flow.stages||[]); const gi = sts.findIndex(s=>s.gate===sel);
  const opts = sts.slice(0, gi+1).reverse().map(s=>`<option value="${s.id}">${s.id} ${s.name}（根因在此）</option>`).join("");
  return `<p class="msg">菱形验收门（红方四视角意见书为必读件；裁决权默认人工）。当前裁决：<b>${v}</b>。</p>
    ${opts?`<div class="kv"><span class="k">打回根因</span><span class="v"><select id="vroot" style="width:100%;background:#0d1017;color:#d8dce2;border:1px solid #2a2f3a;border-radius:6px;padding:4px">${opts}</select></span></div>`:""}
    <div class="vbtns"><button class="ok" id="vg">通过</button><button class="no" id="vn">驳回（按根因回注）</button></div>`;
}
function bindVerdict(){
  const g = document.getElementById("vg"), n = document.getElementById("vn");
  if (!g) return;
  g.onclick = ()=>{ RS.nodes[sel].verdict = "approved"; RS.nodes[sel].status = "done"; render(); fill(); };
  n.onclick = ()=>{
    const sts = (flow.stages||[]);
    const rootSel = document.getElementById("vroot");
    const rootId = rootSel ? rootSel.value : sts[0] && sts[0].id;
    const ri = sts.findIndex(s=>s.id===rootId);
    RS.nodes[sel].verdict = "send-back";
    RS.nodes[sel].status = "awaiting";
    RS.nodes[sel].root_cause_stage = rootId;
    (sts[ri].nodes||[]).forEach(nid=>{ if (RS.nodes[nid]) { RS.nodes[nid].status = "pending"; RS.nodes[nid].round = (RS.nodes[nid].round||1)+1; } });
    const order = Object.keys(nodes);
    const ti = order.indexOf(sts[ri].nodes[0] || order[0]);
    order.slice(ti+1).forEach(x=>{ if(RS.nodes[x] && RS.nodes[x].status==="done"){ RS.nodes[x].status="pending"; RS.nodes[x].stale=true; } });
    render(); fill();
  };
}

/* ---------- 启动 ---------- */
autoLayout();
fitView();
document.getElementById("stage").addEventListener("click", e=>{ if(e.target.id==="stage"){ closeInsp(); } });
