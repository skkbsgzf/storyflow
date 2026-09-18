import { effectiveFlow3 } from "./src/modules.ts";
import fs from "node:fs";
const root = "D:/storymasterv4";
const flow3 = JSON.parse(fs.readFileSync(root + "/tools/__fixtures__/wo02-flow-good.json", "utf-8"));
const r = effectiveFlow3(root, flow3 as any, {});
const nodeCfg = Object.fromEntries(Object.keys(r.flow.graph.nodes).map(n => {
  const nd = r.flow.graph.nodes[n];
  return [n, { module: nd.module, gateRole: nd.gate_role, output: nd.output, skill: nd.skill, minitool: nd.minitool, nodeConfig: nd.config ?? {}, resolved: null }];
}));
const payload = {
  DATA: { project: "fixture-f3", flow: { id: flow3.id, title: flow3.title, version: flow3.version }, modules: r.modules, toolbox: { modules: {} }, files: {}, runstate: { nodes: Object.fromEntries(Object.keys(r.flow.graph.nodes).map((n, i) => [n, { status: i === 0 ? "done" : "none", round: 1 }])) }, deliverables: [], inputs: {}, annos: {}, projects: [] },
  EFF: { format: "effective@2", policy: { link_default: "auto", adapt: "propose" }, links: r.links, composition: r.modules, nodes: r.flow.graph.nodes, edges: r.flow.graph.edges, nodeConfig: nodeCfg },
  OVERLAY: { format: "flow-overlay@1", patches: [], policy: {} },
  OPTIMIZE: { proposals: [], pending: [] },
  METRICS: { byNode: {}, byTool: {}, knowledge: [], links: {}, window: {}, events: 0 },
};
const page = fs.readFileSync(root + "/tools/workflow-page-template.html", "utf-8");
const html = page.replace("__PAYLOAD__", JSON.stringify(payload).replaceAll("</", "<\/")).replace("__TITLE__", "fixture flow@3");
fs.mkdirSync(root + "/tmp-fixture-page", { recursive: true });
fs.writeFileSync(root + "/tmp-fixture-page/workflow.html", html);
console.log("written");
