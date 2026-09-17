#!/usr/bin/env node
// 数据质量校验：ID 级重复（必须为 0，抓取去重生效的证明）+ 标题级重复上架（平台行为，报告数量）
// 用法：node verify.mjs   （update.cmd 会在抓取后自动跑；也可单独执行）
// 退出码：0 = 通过；1 = 发现 ID 级重复或文件损坏

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(import.meta.dirname, 'data');
const readJsonl = (f) => readFileSync(join(DATA, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

let failed = false;

function check(name, file, keyFn, label) {
  if (!existsSync(join(DATA, file))) { console.log(`⚠ ${file} 不存在，跳过`); return null; }
  let rows;
  try { rows = readJsonl(file); } catch (e) { console.log(`❌ ${file} 解析失败: ${e.message}`); failed = true; return null; }
  const counts = new Map();
  for (const r of rows) {
    const k = String(keyFn(r) ?? '');
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const idDups = [...counts.entries()].filter(([, c]) => c > 1);
  if (idDups.length) {
    console.log(`❌ ${name}: ID 级重复 ${idDups.length} 组（唯一键 ${label}）`);
    idDups.slice(0, 5).forEach(([k, c]) => console.log(`     ${k} x${c}`));
    failed = true;
  } else {
    console.log(`✅ ${name}: ${rows.length} 行，${label} 无重复`);
  }
  return rows;
}

const scripts = check('剧本市场', 'scriptrawstone.jsonl', (r) => r.scriptRawstoneId, 'scriptRawstoneId');
check('编剧名录', 'scriptwriter.jsonl', (r) => r.memberId, 'memberId');
check('评剧本', 'scriptcomment.jsonl', (r) => r.aiScriptcommentId, 'aiScriptcommentId');
check('拉片', 'shortfilm.jsonl', (r) => r.aiShortfilmId, 'aiShortfilmId');

// 标题级重复上架：同一 剧名+市场 多个 ID（平台行为，不算数据错误，报告供知悉）
if (scripts) {
  const byTitle = new Map();
  for (const r of scripts) {
    const k = `${r.scriptName}|${r.regionType}`;
    (byTitle.get(k) ?? byTitle.set(k, []).get(k)).push(r);
  }
  const groups = [...byTitle.entries()].filter(([, v]) => v.length > 1);
  const extraRows = groups.reduce((n, [, v]) => n + v.length - 1, 0);
  if (groups.length) {
    console.log(`ℹ 剧本市场有 ${groups.length} 个剧目存在重复上架（多占 ${extraRows} 行，不同 ID/不同日期），browse.html 展示层已折叠为最新版`);
    groups.slice(0, 5).forEach(([k, v]) => console.log(`     ${k.replace('|', ' @')} x${v.length}`));
  } else {
    console.log('✅ 剧本市场无标题级重复上架');
  }
}

console.log(failed ? '\n❌ 校验未通过' : '\n✅ 校验通过');
process.exit(failed ? 1 : 0);
