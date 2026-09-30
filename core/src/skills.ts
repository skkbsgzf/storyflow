/**
 * skill-overlay@1 · 提示词补丁层（A组 W-05）
 *
 * skill 提示词是负反馈的优化对象之一，但提示词改动**永远进拍板清单**：
 * patches 只有 status:"applied" 的参与装载（buildTaskPackage），proposed/rejected 不生效。
 * 补丁语义：section 缺省 = 全文末尾追加；section 给定 + op:append = 小节末尾追加；
 * section + op:replace = 整节替换（从该节标题到下一节标题之前）。
 */
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import { nodeFs, nodePath } from "./abstraction/defaults.js";
import { assertSchema } from "./schema.js";

export interface SkillPatch {
  id: string;
  target: string;
  section?: string;
  op: "append" | "replace";
  text: string;
  status: "proposed" | "applied" | "rejected";
  reason: string;
  origin?: "user" | "miner" | "agent";
  createdAt?: string;
  appliedAt?: string;
}

export interface SkillOverlay {
  format: "skill-overlay@1";
  version: 1;
  note?: string;
  patches: SkillPatch[];
}

/** 规范相对路径（posix 形态常量）。模块顶层的 path.join 无法注入，且 win32 下会产出反斜杠形值；
 *  写死 "/" 分隔后由注入的 path.join 归一——node 适配器与 posix/mock 适配器拼出的绝对路径与原先一致。 */
export const SKILL_OVERLAY_FILE = "skills/skill-overlay.json";

export function skillOverlayPath(root: string, path: IFsPath = nodePath): string {
  return path.join(root, SKILL_OVERLAY_FILE);
}

/** 读补丁层；文件缺失 = 空层（无补丁），损坏 = 显式报错（不静默降级） */
export function loadSkillOverlay(root: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): SkillOverlay {
  const p = skillOverlayPath(root, path);
  if (!fs.exists(p)) return { format: "skill-overlay@1", version: 1, patches: [] };
  const raw = JSON.parse(fs.readText(p)) as SkillOverlay;
  assertSchema("skill-overlay", raw);
  return raw;
}

/** 只取「对某个 skill 生效」的已应用补丁（proposed/rejected 不参与装载） */
export function appliedPatchesFor(root: string, skillName: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): SkillPatch[] {
  const ov = loadSkillOverlay(root, fs, path);
  return ov.patches.filter((p) => p.target === skillName && p.status === "applied");
}

/** 在 markdown 里定位 `## <section>` 小节的起点；找不到返回 -1 */
function sectionStart(text: string, section: string): number {
  const re = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const m = re.exec(text);
  return m ? m.index : -1;
}

/** 小节的结束位置（下一个 `## ` 标题，或全文末尾） */
function sectionEnd(text: string, start: number): number {
  const next = text.indexOf("\n## ", start + 1);
  return next === -1 ? text.length : next + 1;
}

/** 对 skill 全文应用一张已批准补丁；目标小节缺失时返回原文并记原因（由调用方回显） */
export function applyOnePatch(skillText: string, patch: SkillPatch): { text: string; miss?: string } {
  if (!patch.section) {
    // 全文末尾追加
    return { text: skillText.replace(/\s*$/, "") + "\n\n" + patch.text.trim() + "\n" };
  }
  const start = sectionStart(skillText, patch.section);
  if (start === -1) return { text: skillText, miss: `小节不存在: ${patch.section}` };
  if (patch.op === "replace") {
    const end = sectionEnd(skillText, start);
    const lineEnd = skillText.indexOf("\n", start);
    return { text: skillText.slice(0, lineEnd + 1) + patch.text.trim() + "\n\n" + skillText.slice(end).replace(/^\n+/, "") };
  }
  // append：插到小节末尾（下一节标题之前）
  const end = sectionEnd(skillText, start);
  return { text: skillText.slice(0, end).replace(/\s*$/, "") + "\n\n" + patch.text.trim() + "\n" + skillText.slice(end) };
}

/** 装载入口：对 skill 全文按序应用已批准补丁；未命中的补丁原样返回并收集 miss 供显式回显 */
export function applySkillOverlay(skillText: string, skillName: string, patches: SkillPatch[]): { text: string; misses: string[] } {
  const misses: string[] = [];
  let text = skillText;
  for (const p of patches.filter((x) => x.status === "applied")) {
    const r = applyOnePatch(text, p);
    if (r.miss) misses.push(`${p.id}: ${r.miss}`);
    else text = r.text;
  }
  return { text, misses };
}

/**
 * 补丁生命周期（W-05 CLI 背书）：add=proposed（提示词改动永远先提案）；
 * approve=proposed→applied（批准时校验目标小节存在）；reject=proposed→rejected。
 */
export function skillPatch(
  root: string,
  req:
    | { action: "add"; target: string; text: string; reason: string; section?: string; op?: "append" | "replace"; origin?: SkillPatch["origin"] }
    | { action: "approve" | "reject"; id: string }
    | { action: "list"; target?: string },
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): SkillPatch[] {
  const p = skillOverlayPath(root, path);
  const ov = loadSkillOverlay(root, fs, path);
  if (req.action === "add") {
    const skillFile = path.join(root, "skills", `${req.target}.md`);
    if (!fs.exists(skillFile)) throw new Error(`目标 skill 不存在: skills/${req.target}.md`);
    const id = `sp-${String(ov.patches.length + 1).padStart(3, "0")}`;
    ov.patches.push({
      id,
      target: req.target,
      section: req.section,
      op: req.op ?? (req.section ? "append" : "append"),
      text: req.text,
      status: "proposed",
      reason: req.reason,
      origin: req.origin ?? "user",
      createdAt: new Date().toISOString(),
    });
  } else if (req.action === "approve") {
    const patch = ov.patches.find((x) => x.id === req.id);
    if (!patch) throw new Error(`补丁不存在: ${req.id}`);
    if (patch.status !== "proposed") throw new Error(`补丁 ${req.id} 状态为 ${patch.status}，仅 proposed 可批准`);
    if (patch.section) {
      const raw = fs.readText(path.join(root, "skills", `${patch.target}.md`));
      if (sectionStart(raw, patch.section) === -1) throw new Error(`目标小节不存在: ${patch.target} § ${patch.section}`);
    }
    patch.status = "applied";
    patch.appliedAt = new Date().toISOString();
  } else if (req.action === "reject") {
    const patch = ov.patches.find((x) => x.id === req.id);
    if (!patch) throw new Error(`补丁不存在: ${req.id}`);
    if (patch.status !== "proposed") throw new Error(`补丁 ${req.id} 状态为 ${patch.status}，仅 proposed 可驳回`);
    patch.status = "rejected";
  }
  fs.mkdir(path.dirname(p), { recursive: true });
  fs.writeText(p, JSON.stringify(ov, null, 2) + "\n");
  return ov.patches;
}
