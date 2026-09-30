import type { ArtifactEntry } from "./types.js";
import { readJson, writeJsonAtomic } from "./abstraction/jsonio.js";
import { nodeFs, nodePath } from "./abstraction/defaults.js";
import type { IFileSystem, IFsPath } from "./abstraction/fs.js";
import { assertSchema } from "./schema.js";
import { registryPath, snapshotsDir } from "./state.js";
import { sha12, contentSha12, nowIso } from "./ids.js";

interface RegistryFile {
  artifacts: ArtifactEntry[];
}

function loadRegistry(projectDir: string, fs: IFileSystem, path: IFsPath): RegistryFile {
  const reg = readJson<RegistryFile>(registryPath(projectDir, path), fs);
  return reg?.artifacts ? reg : { artifacts: [] };
}

function saveRegistry(projectDir: string, reg: RegistryFile, fs: IFileSystem, path: IFsPath): void {
  writeJsonAtomic(registryPath(projectDir, path), reg, undefined, fs);
}

export function registerArtifact(projectDir: string, entry: ArtifactEntry, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): ArtifactEntry {
  assertSchema("artifact", entry);
  const reg = loadRegistry(projectDir, fs, path);
  reg.artifacts.push(entry);
  saveRegistry(projectDir, reg, fs, path);
  return entry;
}

export function listArtifacts(projectDir: string, opts: { node?: string; latest?: boolean } = {}, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): ArtifactEntry[] {
  let arts = loadRegistry(projectDir, fs, path).artifacts;
  if (opts.node) arts = arts.filter((a) => a.node === opts.node);
  if (opts.latest) {
    const last = new Map<string, ArtifactEntry>();
    for (const a of arts) last.set(a.path, a); // 后者覆盖前者 = 每路径最新
    arts = [...last.values()];
  }
  return arts;
}

export function findRegistered(projectDir: string, relPath: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): ArtifactEntry | undefined {
  return loadRegistry(projectDir, fs, path).artifacts.find((a) => a.path === relPath);
}

export function readRegisteredText(projectDir: string, relPath: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): string | undefined {
  const entry = findRegistered(projectDir, relPath, fs, path);
  if (!entry) return undefined; // 未注册 = 不可读
  try {
    return fs.readText(path.join(projectDir, relPath));
  } catch {
    return undefined;
  }
}

/** 输入指纹：{相对路径: 正文指纹前 12 位}——头部元数据不入指纹（规范 R4 §二）。 */
export function inputFingerprint(projectDir: string, files: string[], fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Record<string, string | null> {
  const fp: Record<string, string | null> = {};
  for (const f of files) {
    try {
      fp[f] = contentSha12(fs.readText(path.join(projectDir, f)));
    } catch {
      fp[f] = null;
    }
  }
  return fp;
}

export function makeArtifact(
  projectDir: string,
  partial: Omit<ArtifactEntry, "ts" | "sha1" | "round"> & { round?: number },
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): ArtifactEntry {
  const abs = path.join(projectDir, partial.path);
  const sha1 = contentSha12(fs.readText(abs));
  const entry: ArtifactEntry = { ...partial, round: partial.round ?? 1, sha1, ts: nowIso() };
  return registerArtifact(projectDir, entry, fs, path);
}

// ---------- 快照（与 tools/snapshot.py 的 index.json 完全同源） ----------

export interface SnapshotEntry {
  round: number;
  ts: string;
  note: string;
  files: Record<string, { hash: string | null; path: string | null }>;
}

function snapshotIndexPath(projectDir: string, path: IFsPath): string {
  return path.join(snapshotsDir(projectDir, path), "index.json");
}

/** 文本产物不可变副本；index.json 与 python 端同构互读。 */
export function captureSnapshot(
  projectDir: string,
  node: string,
  files: Record<string, string>, // {项目内相对路径: 文本内容}
  note = "",
  fs: IFileSystem = nodeFs,
  path: IFsPath = nodePath,
): SnapshotEntry {
  const idx = readJson<{ snapshots: Record<string, SnapshotEntry[]>; inputs: Record<string, unknown> }>(
    snapshotIndexPath(projectDir, path), fs,
  ) ?? { snapshots: {}, inputs: {} };
  const snaps = (idx.snapshots[node] ??= []);
  const round = snaps.length ? (snaps[snaps.length - 1]?.round ?? 0) + 1 : 1;
  const outDir = path.join(snapshotsDir(projectDir, path), node, `r${round}`);
  fs.mkdir(outDir, { recursive: true });
  const entryFiles: Record<string, { hash: string | null; path: string | null }> = {};
  for (const [name, content] of Object.entries(files)) {
    const safe = name.replaceAll("\\", "/").replace(/^projects\/[^/]+\//, "");
    const dst = path.join(outDir, safe);
    fs.mkdir(path.dirname(dst), { recursive: true });
    fs.writeText(dst, content);
    entryFiles[safe] = { hash: contentSha12(content), path: `snapshots/${node}/r${round}/${safe}` };
  }
  const entry: SnapshotEntry = { round, ts: nowIso(), note, files: entryFiles };
  snaps.push(entry);
  writeJsonAtomic(snapshotIndexPath(projectDir, path), idx, undefined, fs);
  return entry;
}

export function readSnapshots(projectDir: string, node: string, fs: IFileSystem = nodeFs, path: IFsPath = nodePath): Array<SnapshotEntry & { content?: Record<string, string> }> {
  const idx = readJson<{ snapshots: Record<string, SnapshotEntry[]> }>(snapshotIndexPath(projectDir, path), fs);
  const snaps = idx?.snapshots[node] ?? [];
  return snaps.map((s) => {
    const content: Record<string, string> = {};
    for (const [name, meta] of Object.entries(s.files)) {
      if (!meta.path) continue;
      try {
        content[name] = fs.readText(path.join(snapshotsDir(projectDir, path), node, `r${s.round}`, name));
      } catch {
        /* missing file */
      }
    }
    return { ...s, content };
  });
}
