#!/usr/bin/env node
// 把 data/products.json 内嵌进 template.html，产出单文件 index.html（双击即看，离线可用）。
// 用法：node build.mjs   （编辑 JSON 或模板后重跑即可）

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dirname;
const products = JSON.parse(readFileSync(join(DIR, 'data', 'products.json'), 'utf8'));
const template = readFileSync(join(DIR, 'template.html'), 'utf8');

const ids = new Set();
for (const p of products) {
  if (ids.has(p.id)) throw new Error(`重复商品 id: ${p.id}`);
  ids.add(p.id);
  for (const k of ['id', 'type', 'title', 'status', 'edition', 'price', 'pitch', 'cover', 'license', 'changelog']) {
    if (p[k] === undefined) throw new Error(`商品 ${p.id} 缺字段: ${k}`);
  }
  if (!['script', 'short', 'novel', 'tool'].includes(p.type)) throw new Error(`商品 ${p.id} 类型非法: ${p.type}`);
  if (!['on-sale', 'preorder', 'free'].includes(p.status)) throw new Error(`商品 ${p.id} 状态非法: ${p.status}`);
}

// split/join 而非 replace：避免 JSON 内容里出现 $ 等替换模式字符时被误解释
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const html = template
  .split('/*__PRODUCTS__*/[]').join(JSON.stringify(products))
  .split('__BUILD__').join(stamp);

const out = join(DIR, 'index.html');
writeFileSync(out, html);
const kb = (statSync(out).size / 1024).toFixed(1);
console.log(`built index.html: ${products.length} products, ${kb} KB`);
