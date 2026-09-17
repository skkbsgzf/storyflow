import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAestheticAsserts, cnEpisodeToInt } from "../src/aesthetic.js";

function beat(no: number, hook: string, sec: number, opts: { trio?: boolean; tail?: boolean; dlgLen?: number } = {}): string {
  const trio = opts.trio ?? true;
  const tail = opts.tail ?? true;
  const dlg = opts.dlgLen ?? 160;
  return [
    `**B${String(no).padStart(4, "0")}｜${hook}｜${sec}秒**`,
    ``,
    `【0-3秒】理发店的钟指向第十分钟。`,
    trio ? `分镜：王拾推门，全店抬头。\n行动：他把工具包放下，一样一样摆好。` : `开场画面：王拾推门。`,
    `台词：王拾（平静）："${"慢工出细活，剪子有剪子的道理。".slice(0, 10)}${"这把剪刀跟了我二十年，它比我更有耐心，今天你们都得等它说完这句话才算完。".repeat(Math.max(1, Math.ceil(dlg / 40))).slice(0, dlg)}"`,
    trio ? `表演：王拾不急不慢，店长脸色发青。` : ``,
    tail ? `尾钩→ 全店的钟同时停了。` : ``,
    ``,
  ].join("\n");
}

function ep(cn: string, title: string, beats: string[]): string {
  return [`## 第${cn}集《${title}》`, ``, ...beats, ``].join("\n");
}

const GOOD_TEXT = [
  "# 小纲 · 测试夹具",
  ``,
  ep("四", "进店", [beat(1, "反常", 10), beat(2, "冲突", 12)]),
  ep("五", "较量", [beat(3, "危险", 9), beat(4, "悬念", 14)]),
  ep("六", "收网", [beat(5, "承诺", 8), beat(6, "冲突", 15)]),
  ``,
  `集末卡点体检：为什么看下一集？`,
].join("\n");

const BAD_TEXT = [
  "# 小纲 · 违规夹具",
  ``,
  ep("四", "进店", [beat(1, "铺垫", 30, { trio: false, tail: false, dlgLen: 400 })]), // 钩型违规+时长越界+缺三件套+缺尾钩+密度越界
  ep("七", "跳跃", [beat(2, "悬念", 8)]), // 缺第五六集（断档）+ 第7集超大纲范围
  ``,
  `王楚钦也来剪头了。`, // 合规违禁词
].join("\n");

describe("aesthetic · check_aesthetic_asserts 内核实现", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniflow-ae-"));
  const projectDir = path.join(root, "projects", "p-ae");
  const outlineRel = "对外交付/02-大纲.md";

  beforeAll(() => {
    fs.mkdirSync(path.join(projectDir, "对外交付"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, outlineRel),
      ["# 分集编排", "", "| 集 | 功能 |", "| --- | --- |", "| 1 | 建立 |", "| 2-3 | 立威 |", "| 4-6 | 递进 |"].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(projectDir, "词汇表.json"),
      JSON.stringify({ project: "p-ae", own: ["王拾"], banned: ["王楚钦"] }),
      "utf-8",
    );
  });

  it("中文集数解析", () => {
    expect(cnEpisodeToInt("四")).toBe(4);
    expect(cnEpisodeToInt("十")).toBe(10);
    expect(cnEpisodeToInt("十四")).toBe(14);
    expect(cnEpisodeToInt("二十三")).toBe(23);
  });

  it("合规产物：无 block", () => {
    fs.writeFileSync(path.join(projectDir, "good.md"), GOOD_TEXT, "utf-8");
    const r = runAestheticAsserts(projectDir, "good.md");
    const blocks = r.filter((x) => x.status === "block");
    expect(blocks).toEqual([]);
  });

  it("违规产物：block 级与 major 级分层拦截", () => {
    fs.writeFileSync(path.join(projectDir, "bad.md"), BAD_TEXT, "utf-8");
    const r = runAestheticAsserts(projectDir, "bad.md");
    const blocks = r.filter((x) => x.status === "block").map((x) => x.name);
    const warns = r.filter((x) => x.status === "warn").map((x) => x.name);
    // block 级（断言表 level:block——清零才收稿）
    expect(blocks).toContain("AE-HOOK-EVENT");
    expect(blocks).toContain("AE-STRUCT-CAUSE#tailhook");
    expect(blocks).toContain("AE-CHOREO-GAP");
    expect(blocks).toContain("AE-CHOREO-BOUNDS");
    expect(blocks).toContain("AE-COMPLIANCE");
    // major 级（记录在案，不阻塞交付）
    expect(warns).toContain("AE-BEAT-FORMAT");
    expect(warns).toContain("AE-BEAT-FORMAT#dur");
    expect(warns).toContain("AE-DENSITY-WORDS");
  });

  it("非拍级产物跳过（转红方视角层）", () => {
    fs.writeFileSync(path.join(projectDir, "梗卡.md"), "# 梗卡\n\n主梗：快剪 vs 慢工。\n", "utf-8");
    const r = runAestheticAsserts(projectDir, "梗卡.md");
    expect(r[0].name).toBe("AE-SKIP-NON-BEAT");
    expect(r[0].status).toBe("warn");
  });

  it("无大纲时编排表范围检查降级跳过", () => {
    const dir2 = path.join(root, "projects", "p-ae2");
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, "x.md"), GOOD_TEXT, "utf-8");
    const r = runAestheticAsserts(dir2, "x.md");
    expect(r.some((x) => x.name === "AE-CHOREO-BOUNDS")).toBe(false);
    expect(r.some((x) => x.name === "AE-CHOREO-GAP")).toBe(true); // 连续性检查仍生效
  });
});
