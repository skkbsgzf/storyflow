// 口径统一 P0.2：agent 两契约（capability-manifest@1 / beat-plan@1）在 core schema 装载器的注册证明。
// 文件按 <id>.schema.json 命名被 loadAjv 发现；断言缺文件/非法样本会以 SchemaViolation 显式失败。
import { describe, expect, it } from "vitest";
import { assertSchema, schemaLoaded } from "../src/schema.ts";

describe("agent 契约注册（capability-manifest@1 / beat-plan@1）", () => {
  it("core schema 装载器已就绪", () => {
    expect(schemaLoaded()).toBe(true);
  });

  it("capability-manifest@1：合法清单通过", () => {
    assertSchema("capability-manifest", {
      format: "capability-manifest@1",
      capabilities: [
        { id: "calc_evaluate", kind: "query", model_tier: "lite", knowledge: ["manuscript"] },
        { id: "world_lookup", desc: "查询世界书条目", domain: "world" },
      ],
    });
  });

  it("capability-manifest@1：坏 id / 多余键 / 缺 format 被拒", () => {
    expect(() =>
      assertSchema("capability-manifest", { format: "capability-manifest@1", capabilities: [{ id: "Bad-Id" }] }),
    ).toThrow();
    expect(() =>
      assertSchema("capability-manifest", {
        format: "capability-manifest@1",
        capabilities: [{ id: "ok_id", execute: "not-serializable" }],
      }),
    ).toThrow();
    expect(() => assertSchema("capability-manifest", { capabilities: [{ id: "ok_id" }] })).toThrow();
  });

  it("beat-plan@1：合法节拍计划通过", () => {
    assertSchema("beat-plan", {
      responseObligation: "回应质询",
      causalSteps: ["密信曝光"],
      characterMoves: [{ character: "县令", action: "拍案", result: "当堂质问师爷" }],
      revealOrChange: "县令知道密信存在",
      endCondition: "县令当堂质问师爷",
      targetChars: 300,
    });
  });

  it("beat-plan@1：缺必填 / 超限 / 多余键被拒", () => {
    expect(() => assertSchema("beat-plan", { causalSteps: [], revealOrChange: "x", endCondition: "y" })).toThrow();
    expect(() =>
      assertSchema("beat-plan", {
        responseObligation: "o",
        causalSteps: ["1", "2", "3", "4", "5"],
        revealOrChange: "r",
        endCondition: "e",
      }),
    ).toThrow();
    expect(() =>
      assertSchema("beat-plan", {
        responseObligation: "o",
        causalSteps: [],
        revealOrChange: "r",
        endCondition: "e",
        schemaVersion: 1,
      }),
    ).toThrow();
  });
});
