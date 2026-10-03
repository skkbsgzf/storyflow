/** 正文选区 → 会话上下文卡片（工单-20261002 批1.5 · 对标 Trae/Workbuddy 选中即上下文）。
 *  卡片在会话输入框上方以小卡条展示；发送时由 formatContextCards 拼成引用块随 prompt 进 kit turn。 */

export interface SelectionCard {
  id: string;
  /** 来源文件相对路径 */
  sourcePath: string;
  /** 行号范围（source 模式有，如 "L12-L30"）；preview 渲染模式无行号 = null */
  range: string | null;
  /** 摘录（≤ SELECTION_EXCERPT_CAP 字，超长截断标注） */
  excerpt: string;
}

export const SELECTION_EXCERPT_CAP = 1200;

let cardSeq = 0;
export function newSelectionCardId(): string {
  cardSeq += 1;
  return `selcard-${Date.now().toString(36)}-${cardSeq}`;
}

export function truncateExcerpt(text: string): string {
  const t = text.replace(/[ \t]+\n/g, "\n").trim();
  if (t.length <= SELECTION_EXCERPT_CAP) return t;
  return `${t.slice(0, SELECTION_EXCERPT_CAP)}…（摘录截断，原文 ${t.length} 字）`;
}

/** 发送时把卡片拼成引用块，置于用户消息之前；无卡片返回空串。 */
export function formatContextCards(cards: SelectionCard[]): string {
  if (!cards.length) return "";
  const blocks = cards.map((card) => {
    const head = `【引用 · ${card.sourcePath}${card.range ? ` ${card.range}` : ""}】`;
    return `${head}\n${card.excerpt}\n【/引用】`;
  });
  return `${blocks.join("\n\n")}\n\n`;
}
