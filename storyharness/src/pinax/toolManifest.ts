// 能力清单 → pi-agent 工具转换接口（kit 缺位补齐）。
// 字段刻意对齐 storyflow-kit 的 KitOp（kit@1：skill/script/title/desc/kind/model_tier/knowledge）——
// kit 侧只有 flow 编排的节点描述符，没有「能力清单 → LLM 工具 schema」的运行时接口；
// 本转换器补上这一层：任何 KitOp 形状的能力清单（含 Pinax 原生能力）都可直接注册为 agent 工具。
import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface CapabilityManifest {
  /** 工具名（进入模型的工具目录） */
  id: string;
  title?: string;
  /** 工具描述——模型据此决定何时调用（KitOp.desc 同位） */
  desc?: string;
  /** KitOp.kind 同位：produce/review/query（信息性） */
  kind?: string;
  /** KitOp.model_tier 同位：high/lite（信息性，不影响路由——模型只有一份） */
  model_tier?: string;
  /** KitOp.knowledge 同位：本能力依赖的资料域（信息性；数据由资源快照供给） */
  knowledge?: string[];
  /** 数据域（快照键）：声明本工具从哪个快照域取数；域空时注册器跳过暴露 */
  domain?: string;
  /** 工具入参 JSON schema；缺省 = 单字符串 query */
  parameters?: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export function manifestToAgentTool(m: CapabilityManifest): AgentTool<any> {
  return {
    name: m.id,
    label: m.title || m.id,
    description: [m.desc, m.knowledge?.length ? `（资料域：${m.knowledge.join("、")}）` : ""].filter(Boolean).join(""),
    parameters: m.parameters || { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    execute: async (_id: string, p: unknown) => {
      let out = await m.execute((p || {}) as Record<string, unknown>);
      if (out.length > 4200) {
        try {
          const payload = JSON.parse(out);
          const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.hits) ? payload.hits : null;
          if (!items) throw new Error("unbounded-tool-result");
          payload.warnings = ["result-truncated"];
          while (items.length && JSON.stringify(payload).length > 4200) items.pop();
          out = JSON.stringify(payload);
          if (out.length > 4200) throw new Error("unbounded-tool-result");
        } catch { out = JSON.stringify({ ok: false, error: "tool-result-too-large" }); }
      }
      return { content: [{ type: "text" as const, text: out }], details: undefined } as never;
    },
  };
}

/** 能力清单批量注册（去重：后注册覆盖同名）。 */
export function registerCapabilities(manifests: CapabilityManifest[]): AgentTool<any>[] {
  const byId = new Map<string, AgentTool<any>>();
  for (const m of manifests) byId.set(m.id, manifestToAgentTool(m));
  return [...byId.values()];
}

// —— 确定性算术求值（「算数值」工具的复算纪律镜像）：只允许数字与 + - * / ( )，
// 递归下降解析，禁 eval/Function——与 Pinax 证据计算「可复算算式」合同同口径。 ——

type CalcToken = { type: "num" | "op" | "paren"; value: string };

function tokenizeCalc(input: string): CalcToken[] {
  const tokens: CalcToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j += 1;
      tokens.push({ type: "num", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/".includes(ch)) { tokens.push({ type: "op", value: ch }); i += 1; continue; }
    if (ch === "(" || ch === ")") { tokens.push({ type: "paren", value: ch }); i += 1; continue; }
    throw new Error(`非法字符：${ch}`);
  }
  return tokens;
}

function evaluateCalcTokens(tokens: CalcToken[]): number {
  let pos = 0;
  const peek = () => tokens[pos];
  const parseExpr = (): number => {
    let left = parseTerm();
    while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = peek()!.value;
      pos += 1;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = (): number => {
    let left = parseFactor();
    while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/")) {
      const op = peek()!.value;
      pos += 1;
      const right = parseFactor();
      if (op === "/" && right === 0) throw new Error("除以零");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  const parseFactor = (): number => {
    const t = peek();
    if (t?.type === "op" && (t.value === "+" || t.value === "-")) { pos += 1; const value = parseFactor(); return t.value === "-" ? -value : value; }
    if (!t) throw new Error("算式不完整");
    if (t.type === "paren" && t.value === "(") {
      pos += 1;
      const v = parseExpr();
      if (!peek() || peek().value !== ")") throw new Error("括号不匹配");
      pos += 1;
      return v;
    }
    if (t.type === "num") {
      pos += 1;
      const n = Number(t.value);
      if (!Number.isFinite(n)) throw new Error(`非法数字：${t.value}`);
      return n;
    }
    throw new Error(`意外的记号：${t.value}`);
  };
  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("算式有多余内容");
  return result;
}

/** 安全算术求值：白名单字符 + 递归下降，无 eval。非法输入抛错（调用方回落错误信封）。 */
export function safeCalcEval(expression: string): number {
  const expr = String(expression || "").trim();
  if (expr.length > 512) throw new Error("算式过长");
  if (!expr) throw new Error("算式为空");
  if (/[^0-9.+\-*/()\s]/.test(expr)) throw new Error("算式只允许数字与 + - * / ( )");
  const result = evaluateCalcTokens(tokenizeCalc(expr));
  if (!Number.isFinite(result)) throw new Error("结果非有限数");
  return result;
}
