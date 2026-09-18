// 只读实验：导出 flow 的默认生效编排（flow.json ⊕ 出厂overlay ⊕ kit边界派生，无项目 overlay）
// 用法: npx tsx scripts-dump-effective.ts <flowId> [...]
import fs from "node:fs";
import path from "node:path";
import { effectiveFlow } from "./src/overlay.js";
import type { FlowDescriptor } from "../src/types.js";

const ROOT = path.resolve(process.cwd(), "..");

for (const flowId of process.argv.slice(2)) {
  const flow = JSON.parse(
    fs.readFileSync(path.join(ROOT, "flows", flowId, "flow.json"), "utf-8"),
  ) as FlowDescriptor;
  const eff = effectiveFlow(ROOT, flow);
  const nodes = eff.flow.graph.nodes as Record<string, any>;
  const edges = eff.flow.graph.edges as any[];
  const edgeLine = (id: string) =>
    edges
      .filter((e) => e.to === id)
      .map((e) => `${e.from}→${id}${e.when ? `[when]` : ""}`)
      .join(", ");

  console.log(`\n########## ${flowId} (v${flow.version}) ##########`);
  console.log(`policy: ${JSON.stringify(eff.policy)}`);
  console.log(`overlayHash: ${eff.overlayHash} | 注入边界门: ${eff.boundaries.join(", ") || "无"}`);
  console.log(`composition:`);
  for (const n of eff.notes) console.log(`  - ${n}`);

  const stages = flow.stages ?? [];
  const staged = new Set<string>();
  for (const st of stages) {
    console.log(`\n== Stage ${st.id} ${st.name} (entry=${st.entry}${st.gate ? `, gate=${st.gate}` : ""})`);
    for (const id of st.nodes) {
      staged.add(id);
      const n = nodes[id] ?? {};
      const op = n.kit && n.op ? `${n.kit}.${n.op}` : n.kit ?? n.op ?? "";
      console.log(
        `   ${id.padEnd(12)} [${String(n.kind ?? "?").padEnd(9)}] ${op.padEnd(28)} ${n.title ?? ""}`,
      );
    }
  }
  const rest = Object.keys(nodes).filter((id) => !staged.has(id));
  if (rest.length) {
    console.log(`\n== 非stage节点（含注入边界门）`);
    for (const id of rest) {
      const n = nodes[id] ?? {};
      const op = n.kit && n.op ? `${n.kit}.${n.op}` : n.kit ?? n.op ?? "";
      console.log(
        `   ${id.padEnd(12)} [${String(n.kind ?? "?").padEnd(9)}] ${op.padEnd(28)} ${n.title ?? ""} | 入边: ${edgeLine(id) || "无"}`,
      );
    }
  }
}
