// G1 · 会话附件（composer 上传 → 落项目 内部/uploads/<sid>/，agent 经 mf_attach_read 读取）。
//   形状与 sessions.ts 同构：目录 = <projectDir>/内部/uploads/<清洗后 sid>，文件名清洗后落盘。
//   口径：附件是对话输入素材，不是产物——只进 内部/uploads/，绝不混进故事正文目录（铁律 9）。
//   图片走视觉模型通路的旋钮另议（盘点 G1 备注）：本模块存字节流并标 kind，读侧对文本类直读、其余显式回说明。
import * as fs from "node:fs";
import path from "node:path";
import type { KernelClient } from "./kernel.js";

const CAP = 16_000;                    // 文本读出上限（与 tools.ts 同宽，防一口吞大文件）
const MAX_BYTES = 32 * 1024 * 1024;    // 单附件 32MB 上限（素材级够用，防磁盘滥用）
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

export interface AttachmentMeta {
  name: string;       // 清洗后的落盘名
  original: string;   // 上传时的原始名（展示用）
  file: string;       // 项目内相对路径（agent 直接可 fs_read / mf_attach_read）
  bytes: number;
  mime: string;
  kind: "text" | "image" | "other";
  at: string;         // ISO 时间
}

/** sid/文件名清洗：先剥路径段（防穿越），再只留 字母/数字（含中文）/._-，前导点剥光，截 120 字符。
 *  \p{L}\p{N} 而非 \w——素材名多是中文，ASCII-only 清洗会把「素材.md」洗成「__.md」。 */
const clean = (s: string, fallback: string) => {
  const base = path.basename(String(s || "").replace(/\\/g, "/"));
  const t = base.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "").slice(0, 120);
  return t || fallback;
};

const kindOf = (name: string, mime: string): AttachmentMeta["kind"] => {
  const ext = path.extname(name).toLowerCase();
  if (mime.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (mime.startsWith("text/") || /\.(txt|md|json|jsonl|csv|tsv|ya?ml|xml|html?|py|js|ts|mjs|log)$/i.test(ext)) return "text";
  return "other";
};

export function uploadsDirOf(kernel: KernelClient, project: string, sid: string): string {
  return path.join(kernel.projectDir(project), "内部", "uploads", clean(sid, "nosid"));
}

/** 落盘一个附件（base64 输入，经 JSON 通道传输——serve 现有体读逻辑只收文本，multipart 另议）。
 *  同名去重：追加 -1/-2…；返回相对项目根的 file 路径，前端与 agent 都用这一个坐标。 */
export function saveAttachment(kernel: KernelClient, project: string, sid: string, original: string, dataBase64: string, mime: string): AttachmentMeta {
  kernel.materializeProject(project);   // S5 · 附件写面落工作区：包内模板项目不被写脏
  const dir = uploadsDirOf(kernel, project, sid);
  fs.mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(String(dataBase64 || ""), "base64");
  if (!buf.length) throw new Error("附件为空（base64 解码后 0 字节）");
  if (buf.length > MAX_BYTES) throw new Error(`附件超 ${Math.round(MAX_BYTES / 1024 / 1024)}MB 上限：${buf.length} 字节`);
  const want = clean(original, "attachment.bin");
  const ext = path.extname(want);
  const stem = want.slice(0, want.length - ext.length);
  let name = want, i = 1;
  while (fs.existsSync(path.join(dir, name))) name = `${stem}-${i++}${ext}`;
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, buf);
  return {
    name, original: String(original || name),
    file: path.relative(kernel.projectDir(project), abs).replace(/\\/g, "/"),
    bytes: buf.length, mime: String(mime || "application/octet-stream"),
    kind: kindOf(name, String(mime || "")), at: new Date().toISOString(),
  };
}

export function listAttachments(kernel: KernelClient, project: string, sid: string): AttachmentMeta[] {
  const dir = uploadsDirOf(kernel, project, sid);
  let items: string[] = [];
  try { items = fs.readdirSync(dir); } catch { return []; }
  return items
    .map((f) => {
      try {
        const st = fs.statSync(path.join(dir, f));
        if (!st.isFile()) return null;
        return { name: f, original: f, file: path.relative(kernel.projectDir(project), path.join(dir, f)).replace(/\\/g, "/"), bytes: st.size, mime: "", kind: kindOf(f, ""), at: st.mtime.toISOString() } as AttachmentMeta;
      } catch { return null; }
    })
    .filter((x): x is AttachmentMeta => !!x)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** 读附件内容供 agent 消费：文本类直读（UTF-8，超 CAP 截断）；docx/pdf/epub 给「已落盘+建议工具」说明；
 *  图片给「视觉通路未接」说明（旋钮另议，不冒充能看图）。file 只认本会话 uploads 内的清洗名。 */
export function readAttachment(kernel: KernelClient, project: string, sid: string, name: string): string {
  const dir = uploadsDirOf(kernel, project, sid);
  const safe = clean(name, "");
  if (!safe) throw new Error("附件名非法");
  const abs = path.join(dir, safe);
  if (!fs.existsSync(abs)) {
    const avail = listAttachments(kernel, project, sid).map((a) => a.name);
    throw new Error(`附件不存在：${name}${avail.length ? `（本会话在档：${avail.join("、")}）` : "（本会话还没上传过附件）"}`);
  }
  const kind = kindOf(safe, "");
  const st = fs.statSync(abs);
  if (kind === "image") return `[图片附件] ${safe}（${st.size} 字节，绝对路径 ${abs}）。当前生图/视觉模型通路未接入（盘点 G1：旋钮另议），不能直接读像素——需要内容时请用户转述，或说明需要接入视觉后端。`;
  if (kind === "other") {
    const ext = path.extname(safe).toLowerCase();
    if (ext === ".docx") return `[docx 附件] ${safe}（${st.size} 字节，${abs}）。底座有二进制预览（B13），文本抽取可用语料仓工具或 fs 读取后由宿主解析——本工具不冒充能解析 docx 字节流。`;
    if (ext === ".pdf") return `[pdf 附件] ${safe}（${st.size} 字节，${abs}）。pdf 解析未接文本抽取通路，同上如实说明。`;
    return `[二进制附件] ${safe}（${st.size} 字节，${abs}，类型 ${kind}）。非文本文件，读出字节流无意义——需要解析时如实告诉用户缺哪条通路。`;
  }
  const t = fs.readFileSync(abs, "utf-8");
  return t.length > CAP ? t.slice(0, CAP) + `\n…(截断，全长 ${t.length} 字符，剩余可用 fs_read 分段读)` : t;
}
