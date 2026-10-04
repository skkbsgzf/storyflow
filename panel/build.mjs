#!/usr/bin/env node
/** 面板双形态构建编排（工单-20261002 批5.1）：
 *  ① 根路径构建 → make-extension → panel/extension-dist/（MV3 插件，资源在扩展根）
 *  ② PAGES_BASE_PATH=/panel 构建 → kitapp/out/（8431 /panel/ 自托管镜像，资源带前缀）
 *  用法：node panel/build.mjs
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const kitapp = join(here, "kitapp");

const run = (cmd, opts = {}) => {
  execSync(cmd, { stdio: "inherit", cwd: kitapp, ...opts });
};

console.log("[build] ① 根路径构建（插件形态）…");
run("npx next build");
console.log("[build] ② 打包 MV3 插件 → panel/extension-dist/");
run("node ../make-extension.mjs");

console.log("[build] ③ /panel 前缀构建（8431 自托管镜像）…");
run("npx next build", { env: { ...process.env, PAGES_BASE_PATH: "/panel" } });

console.log("[build] 完成：extension-dist=插件形态 ｜ kitapp/out=/panel 镜像形态（8431 直接托管）");
