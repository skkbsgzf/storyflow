/**
 * 批次3d · 退化指纹扫描条款组回归（degeneration.ts，additive S 级直扩）：
 *  ① 复读：紧邻整段重复 + 长句全文重复（引号剥离后计）——台词复读不误报（pinax
 *     positive-quoted-repeat 语义移植：剥引号后不可见字不足 → 不报）；
 *  ② 截断：末段不以句末/收尾标点结束；
 *  ③ 占位符：硬词面（〔〕/括号省略/未完待续/英文 AI 腔）引号内也算，软信号
 *     （TODO/XXX/AI 自指/拒绝语）只看引号外——kit 适配：台词内「XXX系统掩码」不报；
 *  ④ 工程词泄漏：代码围栏/行内代码/HTML/JSON/表格行/行内强调 + 流水线术语（引号外计）；
 *  ⑤ additive 接线：runAestheticAsserts 正文路径同时返回既有 AE-PROSE-* / AE-WNF-HOOK
 *     与新增 AE-DEGEN-*（既有检查项输出形状零改动），状态一律 warn（证据优先不闸）；
 *  ⑥ 豁免面：frontmatter / # 标题行 / 空正文（warn 不适用，不冒充 pass）。
 * 全程合成 fixture，零 fs 依赖直测（除⑤走引擎真实读盘），LLM 零参与。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { degenerationAsserts, DEGEN_CHECK_NAMES } from "../src/degeneration.js";
import { runAestheticAsserts } from "../src/aesthetic.js";

function of(text: string) {
  return degenerationAsserts(text);
}
function find(validations: ReturnType<typeof degenerationAsserts>, name: string) {
  return validations.find((v) => v.name === name);
}

describe("退化扫描 · ① 复读（AE-DEGEN-REPEAT）", () => {
  it("紧邻整段重复（≥8 可见字）报 warn，detail 带行号与切片", () => {
    const v = find(of("莉娜把抄表册捆紧，塞进床底的木箱深处。\n莉娜把抄表册捆紧，塞进床底的木箱深处。\n码头的雾又涨上来了。"), "AE-DEGEN-REPEAT");
    expect(v?.status).toBe("warn");
    expect(v?.detail).toContain("L2");
    expect(v?.detail).toContain("紧邻整段重复");
    expect(v?.detail).toContain("莉娜把抄表册捆紧");
  });

  it("台词整段复读不误报（引号剥离后可见字不足——pinax positive-quoted-repeat 语义）", () => {
    const line = "“天黑了。”守卫沿着湿滑的石阶向上奔跑，灯笼在风里摇晃。";
    // 整行重复但重复段是引号台词开头的混排行：剥离引号后仍 ≥8 → 会报（与 pinax 一致）
    const mixed = find(of(`${line}\n${line}\n他数了三遍，灯芯确实是冷的。`), "AE-DEGEN-REPEAT");
    expect(mixed?.status).toBe("warn");
    // 纯台词整段复读：剥离后为空 → 不报
    const quoted = find(of("“天黑了。”\n“天黑了。”\n“天黑了。”"), "AE-DEGEN-REPEAT");
    expect(quoted?.status).toBe("pass");
  });

  it("长句全文重复（≥12 可见字 ×3 次）报一处首现位置并带次数", () => {
    const s = "守卫沿着湿滑的石阶向上奔跑，灯笼在风里摇晃";
    const text = [`${s}。`, "他推开门，看见灯室里空无一人，只有灰尘在光柱里漂浮。", `${s}。`, "他数了三遍，灯芯确实是冷的。", `${s}。`].join("\n");
    const v = find(of(text), "AE-DEGEN-REPEAT");
    expect(v?.status).toBe("warn");
    expect(v?.detail).toContain("长句复读×3");
    // 只报首处（同 pinax）：detail 里该切片只出现一次
    expect((v?.detail ?? "").split("守卫沿着湿滑的石阶").length - 1).toBe(1);
  });

  it("长句仅出现 2 次不报（阈值 ≥3）；正常无复读 pass", () => {
    const s = "守卫沿着湿滑的石阶向上奔跑，灯笼在风里摇晃";
    const twice = find(of(`${s}。\n他推开门。\n${s}。`), "AE-DEGEN-REPEAT");
    expect(twice?.status).toBe("pass");
    const clean = find(of("他推开门，看见灯室里空无一人。\n灰尘在光柱里漂浮。"), "AE-DEGEN-REPEAT");
    expect(clean?.status).toBe("pass");
  });
});

describe("退化扫描 · ② 截断（AE-DEGEN-TRUNCATED）", () => {
  it("末段句中断崖（无句末/收尾标点）报 warn", () => {
    const v = find(of("他推开门，看见灯室里空无一人。\n灰尘在光柱里漂浮，他伸手"), "AE-DEGEN-TRUNCATED");
    expect(v?.status).toBe("warn");
    expect(v?.detail).toContain("L2");
    expect(v?.detail).toContain("他伸手");
  });

  it("合法收尾标点不报：句号/引号闭/省略号/闭括号/闭书名号", () => {
    for (const tail of ["他吃完了饭，把碗洗了。", "“内心戏别太多，老实点！", "……", "（全场安静。）", "灯灭了。』", "这是第四章《雾》》"]) {
      expect(find(of(`他推开门。\n${tail}`), "AE-DEGEN-TRUNCATED")?.status, tail).toBe("pass");
    }
  });
});

describe("退化扫描 · ③ 占位符（AE-DEGEN-PLACEHOLDER）", () => {
  it("硬词面引号内也算：〔〕残留 /（此处省略）/未完待续", () => {
    const v = find(of("他推开门。\n她的契约书〔此处写能力设定〕摊在桌上。"), "AE-DEGEN-PLACEHOLDER");
    expect(v?.status).toBe("warn");
    expect(v?.detail).toContain("〔〕残留");
    const v2 = find(of("战斗过程（此处省略）。\n他收剑。"), "AE-DEGEN-PLACEHOLDER");
    expect(v2?.status).toBe("warn");
    expect(v2?.detail).toContain("括号省略");
  });

  it("kit 适配：台词内「XXX系统掩码」不报（软信号只看引号外）", () => {
    const v = find(of('虽然破绽百出，但由于这个系统世界没有“XXX断开网络连接”的提示，所以大家不会怀疑。'), "AE-DEGEN-PLACEHOLDER");
    expect(v?.status).toBe("pass");
  });

  it("引号外 TODO/XXX/AI 自指/生成拒绝语报 warn", () => {
    const todo = find(of("他推开门。\nTODO: 修改这段打斗。"), "AE-DEGEN-PLACEHOLDER");
    expect(todo?.status).toBe("warn");
    expect(todo?.detail).toContain("TODO/XXX");
    const ai = find(of("作为人工智能，我无法继续生成正文了。"), "AE-DEGEN-PLACEHOLDER");
    expect(ai?.status).toBe("warn");
    expect(ai?.detail).toContain("AI 自指");
    const refuse = find(of("我无法继续生成正文了，请稍后再试。"), "AE-DEGEN-PLACEHOLDER");
    expect(refuse?.status).toBe("warn");
  });

  it("pinax positive-placeholder-meta 语义移植：一行多类只报一处，细纲归工程词", () => {
    const text = "第三章 灯下\n他在本子上写下：本章的目标是交代细纲的第三段。（此处省略）作为AI我不能继续生成正文了。下一章再交代伏笔。";
    const ph = find(of(text), "AE-DEGEN-PLACEHOLDER");
    expect(ph?.status).toBe("warn");
    expect(ph?.detail).toContain("括号省略"); // 一行只报首处硬词面（同 pinax break 语义）
    const meta = find(of(text), "AE-DEGEN-METALEAK");
    expect(meta?.status).toBe("warn");
    expect(meta?.detail).toContain("细纲");
  });
});

describe("退化扫描 · ④ 工程词泄漏（AE-DEGEN-METALEAK）", () => {
  it("代码围栏/行内代码/HTML/JSON/表格行报 warn（引号外计）", () => {
    const fence = find(of("他推开门。\n```\nprint(1)\n```\n灯灭了。"), "AE-DEGEN-METALEAK");
    expect(fence?.status).toBe("warn");
    expect(fence?.detail).toContain("代码围栏");
    const json = find(of('屏幕上跳出：{"name": "系统"}，他愣住。'), "AE-DEGEN-METALEAK");
    expect(json?.status).toBe("warn");
    expect(json?.detail).toContain("JSON 对象");
    const html = find(of("他推开门。<br>灯灭了。"), "AE-DEGEN-METALEAK");
    expect(html?.status).toBe("warn");
    expect(html?.detail).toContain("HTML 标签");
    const table = find(of("| A | B |\n| --- | --- |\n| 1 | 2 |"), "AE-DEGEN-METALEAK");
    expect(table?.status).toBe("warn");
    expect(table?.detail).toContain("表格行");
  });

  it("台词内工程词不报（引号是角色话语空间）；# 标题行豁免", () => {
    const v = find(of("# 第3章 细纲之外\n“他口中说的细纲是什么？”她问。\n他摇头。"), "AE-DEGEN-METALEAK");
    expect(v?.status).toBe("pass");
  });
});

describe("退化扫描 · ⑤⑥ 接线与豁免面", () => {
  it("空正文：四组均 warn「不适用」，不冒充 pass", () => {
    const vs = of("# 只有标题\n\n---\n");
    for (const name of DEGEN_CHECK_NAMES) {
      const v = find(vs, name);
      expect(v?.status, name).toBe("warn");
      expect(v?.detail ?? "").toContain("不适用");
    }
  });

  it("additive 接线：runAestheticAsserts 正文路径同时返回既有检查与 AE-DEGEN-*，形状零改动", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-degen-"));
    fs.mkdirSync(path.join(dir, "章节正文"), { recursive: true });
    const text = [
      "---",
      "title: 合成章",
      "---",
      "",
      "# 第1章",
      "",
      "值得注意的是，她把那枚铜币按在柜台上，没有说话。",
      "TODO: 这段后面补一句过渡再进对话。",
      "他把铜币收进口袋，转身走进巷口。",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "章节正文", "第1章.md"), text, "utf-8");
    const r = runAestheticAsserts(dir, "章节正文/第1章.md");
    const names = r.map((v) => v.name);
    // 既有检查项仍在（additive 不减项），形状零改动
    expect(names).toContain("AE-PROSE-SLOP");
    expect(names).toContain("AE-WNF-HOOK");
    // 新增四名到场，全部 warn 级别家族（证据优先，不构成闸）；有指纹的两项真命中
    for (const name of DEGEN_CHECK_NAMES) {
      const v = r.find((x) => x.name === name);
      expect(v, name).toBeTruthy();
      expect(["pass", "warn"], name).toContain(v?.status);
    }
    expect(r.find((x) => x.name === "AE-DEGEN-PLACEHOLDER")?.status).toBe("warn");
    expect(r.find((x) => x.name === "AE-DEGEN-PLACEHOLDER")?.detail).toContain("L8");
    // 无退化指纹的组诚实 pass；frontmatter/标题行不触发误报
    expect(r.find((x) => x.name === "AE-DEGEN-REPEAT")?.detail).toContain("无复读");
    expect(r.find((x) => x.name === "AE-DEGEN-TRUNCATED")?.detail).toContain("无截断");
    expect(r.find((x) => x.name === "AE-DEGEN-METALEAK")?.detail).toContain("无工程词");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
