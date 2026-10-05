// 推演包唯一源部署器：v4-full-pack/ → 双宿主 packs/deduce（镜像，含清理陈文件）。
// 为什么不用 fs.cpSync：本机实测源路径含 CJK 时 node 静默 exit 127（见 storyflow-kit packs.ts
// copyProjectTree 注释与 docs/收据-波14批2-cpSync崩溃定位.md），故只用实测无害的三原语：
// readdirSync(withFileTypes) + mkdirSync + copyFileSync（+ ASCII 路径上的 rmSync）。
// safeProject 已收编入包（engine/safe-project.ts），双宿主部署=纯拷贝，零 per-host 改写。
// 用法：node v4-full-pack/tools/deploy.mjs [--only storymasterv4|storyflow-kit]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOSTS = {
  storymasterv4: "D:/storymasterv4/storyharness/packs/deduce",
  "storyflow-kit": "D:/storyflow-kit/storyharness/packs/deduce",
};
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const targets = Object.entries(HOSTS).filter(([k]) => !only || k === only);

const walk = (dir, pre = "") => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), `${pre}${e.name}/`));
    else out.push(`${pre}${e.name}`);
  }
  return out;
};
const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
};

let fail = 0;
for (const [name, dst] of targets) {
  try {
    const before = fs.existsSync(dst) ? walk(dst) : [];
    const want = walk(SRC);
    fs.rmSync(dst, { recursive: true, force: true });
    copyTree(SRC, dst);
    const after = walk(dst);
    const stale = before.filter((f) => !want.includes(f));
    const missing = want.filter((f) => !after.includes(f));
    const sizeOk = want.every((f) => fs.statSync(path.join(SRC, f)).size === fs.statSync(path.join(dst, f)).size);
    console.log(`[${name}] ${dst}`);
    console.log(`  files: ${after.length} | stale-removed: ${stale.length}${stale.length ? " -> " + stale.join(", ") : ""} | missing: ${missing.length} | size-verified: ${sizeOk}`);
    if (missing.length || !sizeOk) fail++;
  } catch (e) {
    console.error(`[${name}] DEPLOY FAIL: ${e.message}`);
    fail++;
  }
}
process.exit(fail ? 1 : 0);
