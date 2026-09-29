/**
 * 世界书 GraphHyperRAG（2026-09-22 用户拍板：强制插入 + 归纳/查看/调用三面）——调用层回归。
 *
 *   ① worldbook_search 命中：标题等值 > 含串 > tag > 摘要；多词任一命中即计分
 *   ② 一跳关系扩展：命中词条沿 graph.json 关系边带出邻接词条（weight 降序）
 *   ③ 索引缺失不静默：NO_WORLDBOOK 报错并指路 tools/worldbook_index.py
 *   ④ 归纳层形状：tools/worldbook_index.py 产物 = worldbook-graph@1（声明边 + 互涉边可解析）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel.js";

function tmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-search-"));
  const wb = path.join(dir, "世界书");
  fs.mkdirSync(wb, { recursive: true });
  fs.writeFileSync(
    path.join(wb, "graph.json"),
    JSON.stringify({
      format: "worldbook-graph@1",
      built_at: "2026-09-22 00:00",
      entries: [
        { id: "w-power", cat: "设定", title: "神恩体系", status: "active", tags: ["力量体系", "神恩"], links: ["w-price"], summary: "力量从诸神租借，代价由契约记账。", path: "世界书/设定/w-power.md" },
        { id: "w-price", cat: "设定", title: "契约代价", status: "active", tags: ["代价"], links: ["w-power"], summary: "每分力量都在契约上记账，逾期即收息。", path: "世界书/设定/w-price.md" },
        { id: "w-hero", cat: "人物", title: "主角", status: "active", tags: ["神恩持有者"], links: [], summary: "从诸神处租借力量的少年。", path: "世界书/人物/w-hero.md" },
      ],
      relations: [
        { a: "w-power", b: "w-price", src: "link+mention", weight: 6 },
        { a: "w-hero", b: "w-power", src: "mention", weight: 2 },
      ],
    }),
    "utf-8",
  );
  return dir;
}

describe("世界书 GraphHyperRAG · worldbook_search（CLI/HTTP/MCP 三面同一动词）", () => {
  it("①② 命中与一跳扩展（以盘上真实目录验证）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wb-root-"));
    const pid = "p-wb-demo";
    fs.mkdirSync(path.join(root, "projects"), { recursive: true });
    fs.renameSync(tmpProject(), path.join(root, "projects", pid));
    const k = new Kernel({ root });
    const r = k.worldbookSearch(pid, { q: "神恩体系" }) as {
      hits: { id: string; score: number; relations: { with: string }[] }[];
      expansion: { id: string }[];
    };
    expect(r.hits[0].id).toBe("w-power");
    expect(r.hits[0].score).toBeGreaterThanOrEqual(20); // 标题等值
    expect(r.hits[0].relations.some((x) => x.with === "w-price")).toBe(true);
    expect(r.expansion.some((x) => x.id === "w-price")).toBe(true); // 一跳扩展
  });

  it("① cat 过滤：限定人物时设定词条不入命中", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wb-root-"));
    const pid = "p-wb-demo";
    fs.mkdirSync(path.join(root, "projects"), { recursive: true });
    fs.renameSync(tmpProject(), path.join(root, "projects", pid));
    const k = new Kernel({ root });
    const r = k.worldbookSearch(pid, { q: "神恩", cat: "人物" }) as { hits: { id: string }[] };
    expect(r.hits.every((h) => h.id !== "w-power")).toBe(true);
  });

  it("③ 索引缺失 → NO_WORLDBOOK（报错指路归纳入口，不静默空结果）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wb-root-"));
    const pid = "p-wb-none";
    fs.mkdirSync(path.join(root, "projects", pid), { recursive: true });
    const k = new Kernel({ root });
    expect(() => k.worldbookSearch(pid, { q: "任意" })).toThrow(/worldbook_index/);
  });

  it("④ 归纳层形状：tools/worldbook_index.py 对样例世界书产出 worldbook-graph@1（子进程）", () => {
    // 该用例不打子进程（保持 vitest 纯内核）：改锁生成器 Python 侧在 tools/tests；
    // 这里锁 graph.json 的 format 字段被内核原样透出（版本漂移可被检知）。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wb-root-"));
    const pid = "p-wb-demo";
    fs.mkdirSync(path.join(root, "projects"), { recursive: true });
    fs.renameSync(tmpProject(), path.join(root, "projects", pid));
    const k = new Kernel({ root });
    const r = k.worldbookSearch(pid, { q: "契约" }) as { graph: { format: string } };
    expect(r.graph.format).toBe("worldbook-graph@1");
  });
});
