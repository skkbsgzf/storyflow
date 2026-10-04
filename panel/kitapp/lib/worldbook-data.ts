/** 世界书数据层（批A · 统一 tab 工作台）：graph.json 拉取缓存 + 类型 + 分类色。 */

export interface WbEntry {
  id: string;
  cat: string;
  title: string;
  tags: string[];
  links: string[];
  summary: string;
  path: string;
}
export interface WbRelation { a: string; b: string; src: string; weight: number }
export interface WbGraph {
  entries: WbEntry[];
  relations: WbRelation[];
  stats?: Record<string, unknown>;
  project?: string;
}

export const CAT_PALETTE: Record<string, string> = {
  "人物": "#c96f4a", "地点": "#5b7fa6", "势力": "#8a6fb0", "规则": "#5f9c7a",
  "总览": "#b09a5f", "物品": "#a06a8a", "事件": "#6a9aa0",
};
export const catColorOf = (e: WbEntry) => CAT_PALETTE[e.cat] ?? "#8a8375";

let graphPromise: Promise<WbGraph> | null = null;

/** graph.json 全量（模块级缓存——多 tab 共享一份数据）。 */
export function fetchWbGraph(): Promise<WbGraph> {
  graphPromise ??= fetch("/api/kit/worldbook-graph")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((g: WbGraph) => g)
    .catch((e) => {
      graphPromise = null;
      throw e;
    });
  return graphPromise;
}
