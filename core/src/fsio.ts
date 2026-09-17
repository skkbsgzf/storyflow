import fs from "node:fs";
import path from "node:path";

/** 原子写文本：tmp + rename（Windows rename 失败先删后写）。 */
export function atomicWriteText(file: path.ParsedPath | string, text: string): void {
  const f = typeof file === "string" ? file : path.format(file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
  fs.writeFileSync(tmp, text, "utf-8");
  try {
    fs.renameSync(tmp, f);
  } catch {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
    fs.renameSync(tmp, f);
  }
}

export function writeJsonAtomic(file: string, obj: unknown, validate?: (o: unknown) => void): void {
  if (validate) validate(obj); // 落盘前 schema 复验（v3 纪律：磁盘快照永远合法）
  atomicWriteText(file, JSON.stringify(obj, null, 2) + "\n");
}

export function readJson<T = unknown>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

export function appendJsonl(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf-8");
}

/** 坏行容错读 jsonl（v3 纪律：一行坏不炸整读）。 */
export function readJsonl<T = unknown>(file: string): T[] {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as T);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

/** 尽力锁（lockdir，无依赖）：单写者纪律的软保障。 */
export class LockDir {
  private dir: string;
  constructor(file: string, private staleMs = 30000) {
    this.dir = file + ".lock";
  }
  acquire(): boolean {
    fs.mkdirSync(path.dirname(this.dir), { recursive: true });
    try {
      fs.mkdirSync(this.dir);
      fs.writeFileSync(path.join(this.dir, "owner"), String(process.pid), "utf-8");
      return true;
    } catch {
      const st = fs.statSync(this.dir);
      if (Date.now() - st.mtimeMs > this.staleMs) {
        try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* ignore */ }
        try {
          fs.mkdirSync(this.dir);
          return true;
        } catch { return false; }
      }
      return false;
    }
  }
  release(): void {
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
