// 前端页面契约验证：把生成好的 workflow.html 载入 vm，断言 flow@2 / R5 契约在前端同样成立
// 用法：node tools/page-lint.mjs projects/<id>/workflow.html
import fs from "node:fs";
import vm from "node:vm";

const page = process.argv[2];
const html = fs.readFileSync(page, "utf8");
const BS = String.fromCharCode(92);
const payloadRaw = html.match(/<script type="application\/json" id="payload">([\s\S]*?)<\/script>/)[1];
const decode = (s) => s.split("<" + BS + "/").join("</");
const payload = JSON.parse(decode(payloadRaw));
const js = html.match(/<script>([\s\S]*?)<\/script>/g)
  .map(s => s.replace(/^<script>/, "").replace(/<\/script>$/, ""))
  .sort((a, b) => b.length - a.length)[0];

// ---- 可记录 DOM 桩：只把 d-body / d-chips / d-title / edges 等当成真对象，其余链式吞掉 ----
const noop = () => {};
const mkEl = () => {
  const o = {
    innerHTML: "", textContent: "", value: "", className: "", tabIndex: 0, scrollTop: 0, offsetWidth: 1, href: "",
    style: new Proxy({}, { get: () => noop, set: () => true }), dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() {}, remove() {},
    insertAdjacentHTML(_p, h) { o.innerHTML += h; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; },
    cloneNode() { return mkEl(); }, parentElement: null, children: [], firstChild: null, isConnected: true,
  };
  return o;
};

/** 用给定 payload 起一份页面脚本，返回可直接求值的 probe。**每个场景一份全新上下文**——
 *  否则场景之间会经由模块级 const（EFF/OVERLAY/...）互相串味。 */
function boot(pd) {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, mkEl());
    return els.get(id);
  };
  const document = {
    getElementById: (id) => (id === "payload" ? { textContent: JSON.stringify(pd) } : el(id)),
    createElement: () => mkEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    body: mkEl(), documentElement: mkEl(),
  };
  const store = new Map();
  const callable = new Proxy(function () {}, { get: () => callable, set: () => true, apply: () => callable });
  const ctx = {
    document,
    window: callable,
    fetch: () => new Promise(() => {}),
    console, setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    alert: noop, navigator: { clipboard: { writeText: () => Promise.resolve() } },
    JSON, Math, Object, Array, String, Number, Boolean, Set, Map, Date, RegExp, Error, Promise, URL,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, FileReader: function () {},
  };
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  return { probe: (code) => vm.runInContext(code, ctx), el, ctx };
}

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL ${name}${detail ? "  → " + detail : ""}`); }
};
const gaps = [];

const { probe, el } = boot(payload);

// 1 · 字段名唯一化：kb/file/check/review 必须消失；loads 仅 core + kb_load 节点保留（规范 R4 §5.1）
const legacy = probe(`JSON.stringify(Object.entries(nodes).filter(([n,m])=>m.kb!==undefined||m.file!==undefined||m.check!==undefined||m.review!==undefined).map(([n])=>n))`);
ok("无旧字段名 node.kb/file/check/review", legacy === "[]", legacy);
const badLoads = probe(`JSON.stringify(Object.entries(nodes).filter(([n,m])=>m.loads!==undefined && !(m.kind==="core"&&m.minitool==="kb_load")).map(([n])=>n))`);
ok("loads 仅限 core+kb_load 节点", badLoads === "[]", badLoads);
const legacyEdge = probe(`JSON.stringify(edges.filter(e=>e.transform!==undefined||e.optional!==undefined||e.loop!==undefined||e.role===undefined).map(e=>e.id))`);
ok("无旧字段名 edge.transform/optional/loop，且每条边有 role", legacyEdge === "[]", legacyEdge);

// 2 · 边=可视化+参数化：role 合法、when 可求值、via 可派生、条件可读
const badRole = probe(`JSON.stringify(edges.filter(e=>!["flow","reject","optional","loop","batch"].includes(edgeRole(e))).map(e=>e.id))`);
ok("边 role 全部合法", badRole === "[]", badRole);
const unparsable = probe(`JSON.stringify(edges.map(e=>[e.id, evalWhen(e.when, condCtx()).unparsable]).filter(x=>x[1]))`);
ok("边 when 全部可求值（0 死线）", unparsable === "[]", unparsable);
const noVia = probe(`JSON.stringify(edges.filter(e=>!edgeVia(e)).map(e=>e.id))`);
ok("每条边 via 可派生", noVia === "[]", noVia);
const badWhenText = probe(`JSON.stringify(edges.filter(e=>e.when && !whenText(e.when)).map(e=>e.id))`);
ok("有条件边 whenText 非空", badWhenText === "[]", badWhenText);
const backMismatch = probe(`JSON.stringify(edges.filter(e=>{const r=edgeRole(e); return isBackEdge(e)!==(r==="loop"||r==="reject");}).map(e=>e.id))`);
ok("isBackEdge = loop ∪ reject", backMismatch === "[]", backMismatch);
const noScope = probe(`JSON.stringify(edges.filter(e=>edgeRole(e)==="reject" && !((e.params||{}).scope)).map(e=>e.id))`);
ok("reject 边带 params.scope", noScope === "[]", noScope);

// 3 · 面板渲染：参数页（kit/op/asserts）· 依据页（知识卡）· 产物页 · 审核页
const kitMissing = probe(`JSON.stringify(Object.entries(nodes).filter(([n,m])=>(m.kit||m.op) && !kitOpOf(m)).map(([n])=>n))`);
ok("kit.op 全部可解析（kit 注册表命中）", kitMissing === "[]", kitMissing);
const stray = probe(`JSON.stringify(Object.entries(nodes).map(([n,m])=>[n,strayFields(m)]).filter(x=>x[1].length))`);
ok("无「未规范化字段」（白名单来自 flow.schema.json）", stray === "[]", stray);
const kbUnknown = probe(`JSON.stringify(Object.entries(nodes).flatMap(([n,m])=>{const k=kitOpOf(m); return k?(k.def.knowledge||[]).filter(x=>kbTitle(x)===x).map(x=>n+":"+x):[];}))`);
ok("知识依据全部有中文名（kbTitles 命中）", kbUnknown === "[]", kbUnknown);
const renderBad = probe(`JSON.stringify(Object.keys(nodes).filter(n=>/undefined|NaN|\\[object Object\\]/.test(nodeInfoPaper(n,nodes[n]))))`);
ok("节点参数页渲染无 undefined/NaN 泄漏", renderBad === "[]", renderBad);
const kitShown = probe(`JSON.stringify(Object.entries(nodes).filter(([n,m])=>m.kit&&m.op).filter(([n,m])=>{const h=nodeInfoPaper(n,m); return !h.includes(m.kit+"."+m.op);}).map(([n])=>n))`);
ok("节点面板显示 kit.op", kitShown === "[]", kitShown);
const outsEmpty = probe(`JSON.stringify(Object.keys(nodes).filter(n=>nodes[n].output && !nodeOutputs(n).length))`);
ok("有 output 的节点必有产物路径（唯一事实源）", outsEmpty === "[]", outsEmpty);
const delMissing = probe(`JSON.stringify((flow.outputs||[]).filter(o=>!nodes[o.node]).map(o=>o.node))`);
ok("交付清单节点均存在", delMissing === "[]", delMissing);
const noKnowledge = probe(`JSON.stringify(Object.entries(nodes).filter(([n,m])=>m.kit&&m.op).map(([n,m])=>[n,(kitOpOf(m).def.knowledge||[]).length]).filter(x=>!x[1]).map(x=>x[0]))`);
if (noKnowledge !== "[]") gaps.push(`kit.op 未配置 knowledge（装载 0 张卡，裸跑）：${noKnowledge}`);

// 4 · 审核页：artifact@1 头部 + review 可解析（无头部时显式说明，不静默留白）
const hdrParse = probe(`(()=>{
  const t="---\\nartifact: 1\\nid: x\\nclass: opinion\\nnode: gate-r1\\nround: 2\\nversion: v2\\nstate: reviewed\\nat: 2026-09-17 19:20\\nby: kit/plot.plot-redline\\nupstream:\\n  - a.md@abc\\n  - b.md@def\\nreview:\\n  gate: gate-r1\\n  verdict: pass\\n  by: user\\n  reason: 通过\\n---\\n\\n# 正文\\n";
  const h=parseArtifactHeader(t); if(!h) return "null";
  return JSON.stringify({cls:h.get("class"), round:h.get("round"), up:h.upstream, rev:h.review});
})()`);
ok("artifact@1 头部可解析（class/round/upstream/review）", hdrParse.includes('"round":"2"') && hdrParse.includes("a.md@abc") && hdrParse.includes('"verdict":"pass"'), hdrParse);
const noHdr = probe(`parseArtifactHeader("plain text\\n# no header")`);
ok("非 artifact@1 文本不误判为头部", noHdr === null, String(noHdr));

// 5 · 无硬编码节点 id：任何节点名都不得作为字面量出现在页面脚本里
const hardcoded = probe(`(()=>{
  const src=${JSON.stringify(js)};
  const maps='(nodes|RS\\\\.nodes|RS\\\\.comments|snapshots|DATA\\\\.snapshots|state\\\\.nodes|pos)';
  const fns='(select|openNodeDoc|openRerun|nodeOutputs|nodeHeader|zhTitle|st)';
  const bad=[];
  Object.keys(nodes).forEach(n=>{
    const q=n.replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\$&");
    if (new RegExp(maps+'\\\\s*\\\\[\\\\s*["\\']'+q+'["\\']\\\\s*\\\\]').test(src)) bad.push(n+":索引硬编码");
    else if (new RegExp(fns+'\\\\(\\\\s*["\\']'+q+'["\\']').test(src)) bad.push(n+":调用硬编码");
  });
  return JSON.stringify(bad);
})()`);
ok("页面脚本无硬编码节点 id（节点键索引/调用）", hardcoded === "[]", hardcoded);

// 6 · 实际调用面板渲染：边面板（role/when/params/via）· 节点面板
const edgePanel = probe(`(()=>{
  const ids=edges.filter(e=>!isBackEdge(e)&&e.when).slice(0,3).concat(edges.filter(e=>isBackEdge(e)).slice(0,2));
  const bad=[];
  ids.forEach(e=>{ openEdgeDoc(e.id); const h=document.getElementById("d-body").innerHTML;
    if(!h.includes(zhTitle(nodes[e.from]))||!h.includes(zhTitle(nodes[e.to]))) bad.push(e.id+":端点缺失");
    if(e.when && !h.includes(whenText(e.when))) bad.push(e.id+":条件缺失");
    if(!h.includes("role=")&&!h.includes("数据流")) bad.push(e.id+":角色缺失");
    if(e.params&&Object.keys(e.params).length&&!h.includes("参数")) bad.push(e.id+":参数缺失");
    if(/undefined|NaN/.test(h)) bad.push(e.id+":undefined泄漏"); });
  return JSON.stringify(bad);
})()`);
ok("边面板渲染 role/when/params/via 且无泄漏", edgePanel === "[]", edgePanel);

const nodePanel = probe(`(()=>{
  const bad=[];
  Object.keys(nodes).forEach(n=>{ document.getElementById("d-body").innerHTML=""; openNodeDoc(n);
    const h=document.getElementById("d-body").innerHTML;
    if(!h.includes(n)) bad.push(n+":无节点说明");
    if(/undefined|NaN/.test(h)) bad.push(n+":undefined泄漏"); });
  return JSON.stringify(bad);
})()`);
ok("节点面板 openNodeDoc 全节点可渲染且无泄漏", nodePanel === "[]", nodePanel);

// ================= R5 · 生成式编排（生效层 / 边界验收 / 配置项 / 指标 / 提案） =================
const HAS_EFF = !!payload.EFF; // payload@2：生效编排键为 EFF（effective@2，links 取代 boundaries）
const HAS_KITS = Object.keys(payload.kits || {}).length > 0;

// 7 · 页面主图 = 生效编排（边界验收节点只有生效编排里才有；bootstrap 看不到）
if (HAS_EFF) {
  // R6：边界门退役为「模块间连接件」（gate_role=link，EFF.links 为内核事实源）。
  // 存量 flow@2 页面（DATA.modules 置空）显式降级为 legacy 断言，不硬套 flow@3 语义。
  const isFlow3Page = probe(`JSON.stringify(!!(DATA.modules||[]).length)`) === "true";
  if (!isFlow3Page) {
    const lg = probe(`JSON.stringify(Object.keys(nodes).filter(n=>nodes[n].gate_role==="link"))`);
    ok("存量页：无 R6 连接件混入（转换后由 WO-08 + flow_effect 重新生成）", lg === "[]", lg);
  }
  const lnkSeam = probe(`JSON.stringify((EFF.links||[]).filter(l=>{const m=nodes[l.id]||{}; return m.kind!=="gate"||m.gate_role!=="link";}).map(l=>l.id))`);
  ok("连接件 kind=gate 且 gate_role=link", lnkSeam === "[]", lnkSeam);
  const lnkMode = probe(`JSON.stringify((EFF.links||[]).filter(l=>!["auto","manual"].includes(nodes[l.id]?.link_mode)).map(l=>l.id))`);
  ok("连接件模式合法（auto=灰虚线自动 / manual=金实线挂人）", lnkMode === "[]", lnkMode);
  const lnkRender = probe(`(()=>{const bad=[];(EFF.links||[]).forEach(l=>{const b=l.id;document.getElementById("d-body").innerHTML="";
    openNodeDoc(b); const h=document.getElementById("d-body").innerHTML;
    if(!h.includes("连接件")) bad.push(b+":无连接件说明");
    if(!h.includes("重跑上游模块")) bad.push(b+":缺驳回语义");
    if(/undefined|NaN/.test(h)) bad.push(b+":undefined泄漏");});return JSON.stringify(bad);})()`);
  ok("连接件有专属说明页（含驳回语义）且渲染无泄漏", lnkRender === "[]", lnkRender);
  const lnkClique = probe(`JSON.stringify(Object.keys(nodes).filter(n=>nodes[n].gate_role==="link" && !(EFF.links||[]).some(l=>l.id===n)))`);
  ok("连接件由内核 links 表标注（不靠 id 前缀嗅探）", lnkClique === "[]", lnkClique);
} else {
  const box = probe(`(()=>{renderEffectiveBanner(); return document.getElementById("eff-banner").innerHTML;})()`);
  ok("无读模型时横幅显式说明「本页是 bootstrap 编排」（不静默）", /bootstrap/.test(box), box.slice(0, 80));
}

// 8 · 每个 tool 都有内容配置项：kit.op 节点必渲染旋钮表（值 / 声明 / 来源 / 可选域）
//     有读模型才谈得上「可调项」；没有读模型时页面必须显式说明原因（由场景 B 覆盖）
if (HAS_EFF) {
  const cfgMissing = probe(`JSON.stringify(Object.entries(nodes).filter(([n,m])=>m.kit&&m.op).filter(([n,m])=>{
    const h=configPaper(n);
    if(!h) return true;
    if(!h.includes("内容配置项")) return true;
    if(/undefined|NaN/.test(h)) return true;
    const rec=(EFF&&EFF.nodeConfig&&EFF.nodeConfig[n])||null;
    if(rec&&rec.resolved){ return Object.keys(rec.resolved.defs).some(k=>!h.includes(k)); }
    return false;
  }).map(([n])=>n))`);
  ok("每个 kit.op 节点都渲染出可调配置项（含全部旋钮键，无泄漏）", cfgMissing === "[]", cfgMissing);

  const cfgSrcBad = probe(`JSON.stringify(Object.entries(EFF&&EFF.nodeConfig||{}).filter(([n,r])=>r.resolved).flatMap(([n,r])=>{
    const bad=[];
    Object.entries(r.resolved.sources||{}).forEach(([k,s])=>{ if(!["overlay","node","op","generic"].includes(s)) bad.push(n+":"+k+":"+s);
      if(!(k in (r.resolved.values||{}))) bad.push(n+":"+k+":无值"); });
    return bad;
  }))`);
  ok("配置逐键来源标注合法且有对应生效值", cfgSrcBad === "[]", cfgSrcBad);

  const cfgPriority = probe(`(()=>{const n=Object.keys(nodes).find(x=>nodes[x].kit&&nodes[x].op); return String(configPaper(n).includes("生效优先级"));})()`);
  ok("配置页说明生效优先级（overlay > 节点 > tool 默认 > 通用默认）", cfgPriority === "true", cfgPriority);

  const cfgPatch = probe(`(()=>{const n=Object.keys(nodes).find(x=>nodes[x].kit&&nodes[x].op);
    const h=configPaper(n); return String(h.includes("set-tool")&&h.includes("flow_overlay")&&h.includes("overlay.json"));})()`);
  ok("配置页给出可落地的改写补丁与命令（写了才算可调，不只是展示）", cfgPatch === "true", cfgPatch);

  // 9 · 指标：tool 效率 + 上下文命中率徽章（按 kit.op 归口，换位置不换 tool）
  const mtBad = probe(`JSON.stringify(Object.entries(nodes).filter(([n,m])=>m.kit&&m.op).map(([n,m])=>[n,metricBadges(m)]).filter(x=>!/效率|未采样/.test(x[1])).map(x=>x[0]))`);
  ok("每个 kit.op 节点都给出 tool 效率徽章（无指标则显式「未采样」）", mtBad === "[]", mtBad);

  const mtConsistent = probe(`JSON.stringify(Object.entries(nodes).filter(([n,m])=>m.kit&&m.op&&toolMetrics(m)).filter(([n,m])=>{
    const t=toolMetrics(m); return (t.ctxOffered>0 && !metricBadges(m).includes("命中")) || (t.ctxOffered===0 && !metricBadges(m).includes("命中 -"));
  }).map(([n])=>n))`);
  ok("命中率徽章与采样分母一致（有装载才谈命中）", mtConsistent === "[]", mtConsistent);

  const mtArith = probe(`JSON.stringify((METRICS?Object.entries(METRICS.byTool||{}):[]).filter(([k,t])=>{
    return Math.abs(t.efficiency-(t.consumedBy/t.cost))>1e-9 || (t.ctxOffered>0 && Math.abs(t.hitRate-(t.ctxUsed/t.ctxOffered))>1e-9);
  }).map(([k])=>k))`);
  ok("指标汇总口径自洽（效率=消费/成本、命中率=命中/装载）", mtArith === "[]", mtArith);

  // 10 · 编排面板：生效层数 / 边界 / 覆盖率 / 提案 / 装载记录（「谁改了我的流程」必须有地方看）
  const orch = probe(`(()=>{const h=orchestrationPaper();
    const need=["生成式编排","边界验收","项目覆盖","优化提案","指标事件"];
    return JSON.stringify(need.filter(x=>!h.includes(x)));})()`);
  ok("编排面板含策略/边界/覆盖/提案/指标五要素", orch === "[]", orch);

  const banner = probe(`(()=>{renderEffectiveBanner(); return document.getElementById("eff-banner").innerHTML;})()`);
  ok("启动时横幅渲染生效编排摘要（无泄漏）", !/undefined|NaN/.test(banner) && banner.length > 0, banner.slice(0, 90));
} else {
  gaps.push("本页无 registry/effective.json（未跑过内核）：R5 配置项/指标/编排面板断言退化为「显式降级」（由合成场景 B 覆盖）");
}

// 11 · 合成场景 A：项目 overlay 改写了某 tool 的配置 → 该节点配置页必须显示改写理由与来源=overlay
if (HAS_EFF) {
  const target = (() => {
    const nc = (payload.EFF || {}).nodeConfig || {};
    const hit = Object.entries(nc).find(([, r]) => r && r.resolved);
    return hit ? { id: hit[0], kit: hit[1].kit, op: hit[1].op, keys: Object.keys(hit[1].resolved.defs || {}) } : null;
  })();
  if (target && target.kit && target.op) {
    const key = target.keys[0];
    const p2 = JSON.parse(JSON.stringify(payload));
    const rec = p2.effective.nodeConfig[target.id];
    const sample = rec.resolved.defs[key].type === "number" ? 1234
      : (rec.resolved.defs[key].enum ? rec.resolved.defs[key].enum[rec.resolved.defs[key].enum.length - 1] : "深");
    rec.resolved.values[key] = sample;
    rec.resolved.sources[key] = "overlay";
    rec.toolOverride = { ...(rec.toolOverride || {}), config: { [key]: sample } };
    p2.overlay = {
      format: "flow-overlay@1", flowId: p2.effective.flowId, origin: "user", reason: "合成场景：验证改写提示",
      patches: [{ kind: "set-tool", kit: target.kit, op: target.op, config: { [key]: sample }, reason: "合成场景：命中率偏低，加注深度", evidence: { rule: "R2", metric: "hitRate", value: 0.1 } }],
    };
    const b2 = boot(p2);
    const h = b2.probe(`configPaper(${JSON.stringify(target.id)})`);
    ok("overlay 改写的 tool：配置页显示改写条数与改写理由", h.includes("项目 overlay 改写") && h.includes("命中率偏低"), h.slice(0, 160));
    ok("overlay 改写的键：来源标「项目覆盖」并加改动标记", h.includes("src-overlay") && h.includes("项目 overlay"), "");
    const h2 = b2.probe(`nodeInfoPaper(${JSON.stringify(target.id)}, nodes[${JSON.stringify(target.id)}])`);
    ok("节点说明页同步显示被改写的配置概览", h2.includes(String(sample)), h2.slice(0, 160));
  } else {
    gaps.push("合成场景 A 跳过：生效编排里没有可解析的 kit.op 节点");
  }
}

// 12 · 合成场景 B：完全没有生效读模型 → 页面必须显式降级为 bootstrap 视图，不得假装有边界/指标
{
  const p3 = JSON.parse(JSON.stringify(payload));
  p3.effective = null; p3.metrics = null; p3.overlay = null; p3.optimize = null;
  // 忠实模拟真实降级：生成器找不到 effective.json 时用的是 bootstrap flow.json，
  // 那里根本没有派生出来的边界门。所以这一场景里把边界门从主图拿掉。
  p3.EFF = null; p3.METRICS = null; p3.OVERLAY = null; p3.OPTIMIZE = null;
  if (p3.DATA && p3.DATA.flow && p3.DATA.flow.graph) {
    const bnd = new Set((((payload.EFF || {}).links) || []).map(l => l.id));
    p3.DATA.flow.graph.nodes = Object.fromEntries(Object.entries(p3.DATA.flow.graph.nodes).filter(([id]) => !bnd.has(id)));
    p3.DATA.flow.graph.edges = p3.DATA.flow.graph.edges.filter(e => !bnd.has(e.from) && !bnd.has(e.to));
  }
  const b3 = boot(p3);
  const h = b3.probe(`(()=>{renderEffectiveBanner(); return document.getElementById("eff-banner").innerHTML;})()`);
  ok("读模型缺失：横幅明示 bootstrap 且给出恢复路径", /bootstrap/.test(h) && /flow_effect|flow_next/.test(h), h.slice(0, 110));
  const nb = b3.probe(`JSON.stringify(Object.keys(nodes).filter(isBoundaryNode))`);
  ok("读模型缺失：不再宣称存在边界验收节点（不伪造）", nb === "[]", nb);
  const cp = b3.probe(`configPaper(Object.keys(nodes)[0])`);
  ok("读模型缺失：配置页不编造旋钮（返回空或显式说明）", cp === "" || /未能|查不到|无旋钮/.test(cp), cp.slice(0, 120));
  const op = b3.probe(`orchestrationPaper()`);
  ok("读模型缺失：编排面板不渲染（无事实可陈）", op === "", op.slice(0, 80));
  const mb = b3.probe(`JSON.stringify(Object.entries(nodes).filter(([n,m])=>m.kit&&m.op).slice(0,3).map(([n,m])=>metricBadges(m)).filter(x=>!x.includes("未采样")))`);
  ok("读模型缺失：指标徽章显式「未采样」而非编造数字", mb === "[]", mb);
}

// ================= OS-04 · 初始化面板（项目输入区 / 定性配置区 / 模板） =================
// 12b · 面板必须由 flow.inputs **逐字段渲染**（控件类型正确、必填可见、无泄漏），
//       且保存走内核端点——否则「界面在撒谎」（原先是只能手写 JSON 的 textarea）。
// 存量页由旧模板生成（函数不存在）⇒ 显式降级并列缺口，不假装通过、也不误报失败。
if (probe(`typeof configZonesPaper === "function"`) !== true) {
  gaps.push("本页由旧模板生成（无 OS-04 初始化面板）：重生成后覆盖 —— python tools/project-pages.py --root projects/<id>");
} else {
  const p4 = JSON.parse(JSON.stringify(payload));
  p4.DATA.flowInputs = {
    project: { type: "project", required: true, desc: "项目上下文" },
    direction: { type: "string", required: true, desc: "题材方向" },
    route: { type: "enum", default: "hot", options: ["hot", "calm", "dual"], desc: "路线" },
    zeitgeist: { type: "boolean", default: true, desc: "是否扫描热点" },
    chapters: { type: "number", default: 3, min: 1, max: 3, desc: "试稿章数" },
  };
  p4.DATA.projectConfig = null;
  p4.DATA.configTemplate = { 项目: "p", 题材: "", 严肃性: "标准", 风格: "爽", AB测试: false, 市场预估: "", presets: {} };
  const b4 = boot(p4);
  const h = b4.probe(`configZonesPaper()`);
  const missKeys = Object.keys(p4.DATA.flowInputs).filter(k => !h.includes(`data-cfg-key="${k}"`));
  ok("OS-04 项目输入区：flow.inputs 逐字段渲染（每键都有控件）", missKeys.length === 0, missKeys.join(","));
  ok("OS-04 必填输入可见（required + 星标）", h.includes('data-cfg-required="1"') && h.includes('class="req"'), "");
  ok("OS-04 enum 渲染为下拉且含全部可选值", h.includes('data-cfg-type="enum"') && h.includes('<option value="dual"'), "");
  ok("OS-04 boolean 渲染为开关", h.includes('data-cfg-type="boolean"') && h.includes('type="checkbox"'), "");
  ok("OS-04 number 渲染为数字框并带 min/max", h.includes('data-cfg-type="number"') && h.includes('min="1"') && h.includes('max="3"'), "");
  ok("OS-04 定性配置区渲染中文键（严肃性/风格为下拉）",
    h.includes('data-cfg-key="严肃性"') && h.includes('data-cfg-key="风格"') && h.includes('<option value="出品"'), "");
  ok("OS-04 面板 HTML 无 undefined/NaN 泄漏", !/undefined|NaN/.test(h), (h.match(/undefined|NaN/g) || []).slice(0, 3).join(","));
  const missing = b4.probe(`JSON.stringify(cfgMissingRequired({direction:"x"}))`);
  ok("OS-04 必填缺项可检出（开跑前可见，不等 flow_run 报错）", missing === '["project"]', missing);
  const filled = b4.probe(`(()=>{DATA.projectConfig={route:"calm",chapters:2};
    const s=configZonesPaper(); return JSON.stringify([s.includes('value="calm" selected'), s.includes('value="2"')]);})()`);
  ok("OS-04 已有配置回填控件（不是空白表单）", filled === "[true,true]", filled);
  const tplDown = b4.probe(`JSON.stringify(!!(DATA.configTemplate&&DATA.configTemplate.严肃性==="标准"))`);
  ok("OS-04 出厂模板随 payload 下发（「载入官方默认」有据）", tplDown === "true", tplDown);
  const saveSrc = probe(`JSON.stringify({kernel:String(saveConfigObject).includes("/config"), offline:String(saveConfigObject).includes("未过内核校验")})`);
  ok("OS-04 保存走内核端点 /api/projects/<id>/config，且保留离线降级并显式说明",
    saveSrc.includes('"kernel":true') && saveSrc.includes('"offline":true'), saveSrc);
}

// ================= OS-02 阶段 C · 阈值预算区（声明面来自内核，页面不重算） =================
// 12c · 阈值预算区的**旋钮键集必须与内核 budget.defs 逐键相等**（多一个 = 页面自造旋钮，
//       少一个 = 声明了却不可调）。生效值/来源/告警一律读内核读模型，页面不做第二套合并。
if (probe(`typeof budgetZonePaper === "function"`) !== true) {
  gaps.push("本页由旧模板生成（无 OS-02 阈值预算区）：重生成后覆盖 —— python tools/project-pages.py --root projects/<id>");
} else if (!(payload.DATA && payload.DATA.budgetView && payload.DATA.budgetView.defs && Object.keys(payload.DATA.budgetView.defs).length)) {
  gaps.push("本页无阈值读模型（registry/effective.json 缺 budget 块，flow_run 一次即可）：阈值预算区显式降级");
  const g5 = boot(JSON.parse(JSON.stringify(payload)));
  const gh = g5.probe(`budgetZonePaper()`);
  ok("OS-02 无读模型时阈值区显式降级（说明怎么取得，不装作空表、不泄漏 undefined）",
    gh.includes("本页暂无阈值读模型") && !/undefined|NaN/.test(gh), gh.slice(0, 80));
} else {
  const p5 = JSON.parse(JSON.stringify(payload));
  const bv = p5.DATA.budgetView;
  const knobs = Object.keys(bv.defs).sort();
  const b5 = boot(p5);
  const bh = b5.probe(`budgetZonePaper()`);
  const pageKnobs = (bh.match(/data-budget-key="([^"]+)"/g) || []).map(x => x.slice(17, -1)).sort();
  ok("OS-02 阈值预算区：旋钮键集与内核 budget.defs **逐键相等**（页面不自造、也不漏渲染）",
    JSON.stringify(pageKnobs) === JSON.stringify(knobs),
    "页 " + pageKnobs.length + " / 内核 " + knobs.length);
  ok("OS-02 每个旋钮带「谁读它」+ 合法区间（能力必须有家，不是只有名字）",
    knobs.every(k => {
      const d = bv.defs[k];
      const bound = d.min === undefined ? true : bh.includes(String(d.min));
      return (d.consumer ? bh.includes(d.consumer) : false) && bound;
    }), knobs.filter(k => !bh.includes(String(bv.defs[k].consumer))).join(","));
  ok("OS-02 面板 HTML 无 undefined/NaN 泄漏", !/undefined|NaN/.test(bh), (bh.match(/undefined|NaN/g) || []).slice(0, 3).join(","));
  // 未覆盖 ⇒ 输入框留空、占位为出厂值（绝不把出厂值写死进项目配置，否则以后改出厂值就不生效了）
  const blank = b5.probe(`(()=>{DATA.projectConfig=null; const s=budgetZonePaper();
    const vals=(s.match(/data-budget-key="[^"]+" data-budget-type="number" value="[^"]*"/g)||[]);
    return JSON.stringify([vals.length, vals.every(x=>x.endsWith('value=""'))]);})()`);
  ok("OS-02 未覆盖的旋钮输入框留空（= 用出厂默认，不冻进配置）", blank === "[" + knobs.length + ",true]", blank);
  // 已覆盖 ⇒ 回填真实值 + 徽标改口「本项目已改」
  const filled5 = b5.probe(`(()=>{DATA.projectConfig={阈值预算:{fillerQuota:9}}; const s=budgetZonePaper();
    return JSON.stringify([s.includes('data-budget-key="fillerQuota" data-budget-type="number" value="9"'), s.includes("本项目已改")]);})()`);
  ok("OS-02 项目已覆盖的旋钮回填真实值并标「本项目已改」", filled5 === "[true,true]", filled5);
  // 内核告警原样回显（未知键/越界/交叉校验——本仓最反感静默）
  const issueShown = b5.probe(`(()=>{const old=DATA.budgetView.issues; DATA.budgetView.issues=["budget.nope（未知阈值键）"];
    const s=budgetZonePaper(); DATA.budgetView.issues=old; return JSON.stringify([s.includes("阈值告警"), s.includes("budget.nope")]);})()`);
  ok("OS-02 内核阈值告警原样回显（未知键/越界不静默）", issueShown === "[true,true]", issueShown);
  // 落盘形状：阈值必须作为**嵌套键**写进 项目配置.json（不是拍平成一堆顶层键）
  const nest = probe(`JSON.stringify({read:String(readBudgetForm).includes("data-budget-key"), save:String(saveConfigFromForm).includes("阈值预算"), reset:typeof resetBudgetForm==="function"})`);
  ok("OS-02 阈值落盘为嵌套键「阈值预算」并可一键恢复出厂",
    nest.includes('"read":true') && nest.includes('"save":true') && nest.includes('"reset":true'), nest);
}

console.log(`\n${page}\n  ${pass}/${pass + fail} passed`);
if (gaps.length) console.log("  已知缺口：\n   - " + gaps.join("\n   - "));
process.exit(fail ? 1 : 0);
