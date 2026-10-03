#!/usr/bin/env node
/** 插件壳打包（工单-20261002 批5）：
 *  kitapp 静态导出（next build → out/）→ panel/extension-dist/ + MV3 manifest。
 *  用法：node panel/make-extension.mjs   （先 cd panel/kitapp && npx next build）
 *  加载：chrome://extensions → 开发者模式 → 加载已解压 → 选 panel/extension-dist/
 *  前提：本机 kit 协议面 8431（host_permissions 已授权 8421/8431）。
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "kitapp", "out");
const distDir = join(here, "extension-dist");

if (!existsSync(join(outDir, "index.html"))) {
  console.error("缺 kitapp/out/index.html —— 先运行: cd panel/kitapp && npx next build");
  process.exit(1);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(outDir, distDir, { recursive: true });

// MV3 manifest：扩展页内联整站静态资源（script-src 'self' 天然放行包内 ES module）；
// 跨源只对 127.0.0.1:8421/8431（kit 内核与协议面）开放。
const manifest = {
  manifest_version: 3,
  name: "StoryFlow Panel",
  version: "1.0.0",
  description: "StoryFlow 官方面板（pi-web 深度适配）：会话改写 / 世界书 / 知识库 / 大事记 / 生产线。需本机 kit harness 运行中。",
  minimum_chrome_version: "111",
  permissions: ["storage"],
  host_permissions: [
    "http://127.0.0.1:8421/*",
    "http://127.0.0.1:8431/*",
    "http://localhost:8421/*",
    "http://localhost:8431/*",
  ],
  action: {
    default_title: "StoryFlow Panel",
    default_popup: "launcher.html",
  },
  options_page: "index.html",
};

writeFileSync(join(distDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// launcher popup：点击图标给一个小入口页（整面板在新标签页全屏打开）
writeFileSync(
  join(distDir, "launcher.html"),
  `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
body{font-family:'Noto Serif SC',SimSun,serif;background:#f5f1e8;color:#2c2824;margin:0;padding:14px;width:260px}
a{display:block;text-align:center;padding:9px 0;border-radius:8px;background:#a5433a;color:#fff;text-decoration:none;font-size:14px;letter-spacing:2px}
p{font-size:11px;color:#8a8375;line-height:1.6;margin:10px 0 0}
</style></head><body>
<a href="index.html" target="_blank">📖 打开 StoryFlow Panel</a>
<p>需本机 kit 运行中（8431 协议面 / 8421 内核）。首次打开请确认地址栏的 harness 连接；基址可用 URL 参数 ?kit= 覆盖。</p>
</body></html>
`,
);

console.log("extension-dist 已就绪：", distDir);
console.log("加载：chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选此目录");
