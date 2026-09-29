// 推演包入口（挂载表契约）：pages/deduce/page.ts 出壳，engine/deduce.ts 出 API。
// 底座注入经 currentPackCtx()（packctx.ts）；三纪律（打分=建议面/无私有账本/正文纯净）在引擎内，不在此层。
import { DEDUCE_HTML } from "./pages/deduce/page.js";
import { handleDeduceApi, type DeduceConfig } from "./engine/deduce.js";
import { currentPackCtx, type PackCtx } from "../../src/packctx.js";
import type http from "node:http";

export function render(): string {
  return DEDUCE_HTML;
}

export async function handle(
  ctx: PackCtx,
  res: http.ServerResponse,
  url: string,
  method: string,
  body: string,
  prefixLen: number,
): Promise<void> {
  await handleDeduceApi(res, ctx.cfg, url, method, body, prefixLen, (ctx.packCfg ?? {}) as DeduceConfig);
}
