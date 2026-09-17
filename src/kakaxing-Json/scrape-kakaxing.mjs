#!/usr/bin/env node
// 咔咔猩（kakaxing.com）公开数据抓取脚本
// 只抓无需登录的开放接口（网关 gateway.kakaxing.com），限速串行请求，带重试。
// 用法：node scrape-kakaxing.mjs          全量刷新（约 2-3 分钟）
//       node scrape-kakaxing.mjs --inc    增量更新（列表按上架时间倒序，遇到整页旧数据即停，日常几十秒）
// 输出写到同目录 data/ 下；JSONL 追加去重，可随时中断重跑。
// 合规：仅抓元数据用于竞品分析/题材研究；策划案文案是平台确权内容，勿原文用于对外商业产品。

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const INC = process.argv.includes('--inc');
const GATEWAY = 'https://gateway.kakaxing.com';
const ORIGIN = 'https://www.kakaxing.com';
const OUT_DIR = import.meta.dirname;
const DATA_DIR = join(OUT_DIR, 'data');

const PAGE_SIZE = 100;      // 实测放行；若被限可调回 50
const DELAY_MS = 700;       // 每请求间隔
const MAX_RETRY = 4;
const INC_STOP_PAGES = 2;   // 增量模式：连续 N 个整页全是旧数据即停止

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Content-Type': 'application/json',
  'Origin': ORIGIN,
  'Referer': `${ORIGIN}/`,
  'Accept': 'application/json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, attempt = 1) {
  try {
    const res = await fetch(GATEWAY + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.resultCode !== 'SUCCESS') throw new Error(`${json.errorCode}: ${json.errorCodeDes ?? ''}`);
    return json;
  } catch (e) {
    if (attempt >= MAX_RETRY) throw new Error(`${path} 重试 ${MAX_RETRY} 次仍失败: ${e.message}`);
    console.warn(`  ! ${path} 第 ${attempt} 次失败（${e.message}），${1500 * attempt}ms 后重试`);
    await sleep(1500 * attempt);
    return post(path, body, attempt + 1);
  }
}

function readJsonlIds(file, idKey) {
  const ids = new Set();
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const o = JSON.parse(line); if (o[idKey]) ids.add(o[idKey]); } catch { /* 忽略半行 */ }
    }
  }
  return ids;
}

/** 分页拉取 {series, totalCount} 型接口，追加写 JSONL（按 idKey 去重，可断点续跑）；增量模式遇整页旧数据提前停止 */
async function scrapePagedJsonl(path, body, outFile, idKey) {
  const file = join(DATA_DIR, outFile);
  const seen = readJsonlIds(file, idKey);
  mkdirSync(DATA_DIR, { recursive: true });

  const first = await post(path, { ...body, pageNum: 1, pageSize: PAGE_SIZE });
  const total = first.totalCount ?? first.series?.length ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  console.log(`▶ ${path}: total=${total}, ${totalPages} 页（已有 ${seen.size} 条，跳过重复）`);
  appendFileSync(file, first.series.filter((it) => !seen.has(it[idKey]) && seen.add(it[idKey])).map((it) => JSON.stringify(it)).join('\n') + (first.series.length ? '\n' : ''));

  let staleRun = 0;
  for (let p = 2; p <= totalPages; p++) {
    await sleep(DELAY_MS);
    const page = await post(path, { ...body, pageNum: p, pageSize: PAGE_SIZE });
    const rows = page.series ?? [];
    const fresh = rows.filter((it) => !seen.has(it[idKey]) && seen.add(it[idKey]));
    if (fresh.length) appendFileSync(file, fresh.map((it) => JSON.stringify(it)).join('\n') + '\n');
    process.stdout.write(`  页 ${p}/${totalPages} +${fresh.length} (累计 ${seen.size})\n`);
    if (INC) {
      staleRun = fresh.length === 0 ? staleRun + 1 : 0;
      if (staleRun >= INC_STOP_PAGES) { console.log(`  连续 ${INC_STOP_PAGES} 页无新数据，增量提前结束`); break; }
    }
  }
  return { total, scraped: seen.size };
}

/** 分页拉取 {data: [...]} 型接口（无 total，翻到空页/短页为止），整体写一个 JSON */
async function scrapeUntilEmpty(path, body, outFile, pageSize = 50) {
  const all = [];
  for (let p = 1; ; p++) {
    const res = await post(path, { ...body, pageNum: p, pageSize });
    const rows = res.data ?? [];
    all.push(...rows);
    console.log(`  ${path} 页 ${p}: +${rows.length}`);
    if (rows.length < pageSize) break;
    await sleep(DELAY_MS);
  }
  writeFileSync(join(DATA_DIR, outFile), JSON.stringify(all, null, 1));
  return all.length;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  console.log(INC ? '〰️ 增量模式 --inc' : '⏬ 全量模式');
  const startedAt = new Date().toISOString();
  const meta = { source: 'kakaxing.com 公开接口', gateway: GATEWAY, startedAt, datasets: {} };

  // 1) 剧本原石市场（主数据集）
  meta.datasets.scriptrawstone = await scrapePagedJsonl(
    '/web/data/scriptrawstone/page', {}, 'scriptrawstone.jsonl', 'scriptRawstoneId',
  );

  // 2) 全站分类体系（题材标签/评级/集数/市场 带计数）
  writeFileSync(join(DATA_DIR, 'queryConditions.json'), JSON.stringify((await post('/web/data/scriptrawstone/queryConditions', {})).data, null, 1));
  meta.datasets.queryConditions = 'taxonomy';

  // 3) 编剧名录
  meta.datasets.scriptwriter = await scrapePagedJsonl(
    '/web/data/scriptwriter/page', {}, 'scriptwriter.jsonl', 'memberId',
  );

  // 4) 短剧快讯
  meta.datasets.news = await scrapeUntilEmpty('/web/data/news/list', {}, 'news.json');

  // 5) 评剧本市场 + 拉片市场（列表元数据）
  meta.datasets.scriptcomment = await scrapePagedJsonl(
    '/web/data/scriptcomment/releasePage', {}, 'scriptcomment.jsonl', 'aiScriptcommentId',
  );
  meta.datasets.shortfilm = await scrapePagedJsonl(
    '/web/data/shortfilm/releasePage', {}, 'shortfilm.jsonl', 'aiShortfilmId',
  );

  // 6) 画风预设 / 模型目录（各一页全量）
  for (const [ep, name] of [['style/list', 'style-list.json'], ['model/list', 'model-list.json']]) {
    writeFileSync(join(DATA_DIR, name), JSON.stringify((await post(`/web/data/${ep}`, {})).data, null, 1));
    meta.datasets[name.replace('.json', '')] = 'catalog';
  }

  meta.finishedAt = new Date().toISOString();
  writeFileSync(join(DATA_DIR, '_meta.json'), JSON.stringify(meta, null, 2));
  console.log('\n✅ 完成，输出目录:', DATA_DIR);
  console.log(JSON.stringify(meta.datasets, null, 2));
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
