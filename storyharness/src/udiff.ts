// B组 · 工单 B12（波9）：unified diff 内核——把 tools/snapshot.py 的 diff 口径复刻到 TS。
// 为什么复刻而不是调 python：底座（storyharness）不许把 UI 面板押在宿主 Python 上；
// 为什么用 jsdiff 之类现成库不行：它们走 Myers，与 difflib 的 Ratcliff/Obershelp 分段不同，
// 同一文件同一版本会给出不同的 hunk——而「面板 diff 与快照 diff 一致」正是本单的验收条。
// 因此本文件逐条照抄 CPython 3.13 Lib/difflib.py 的 SequenceMatcher（含 autojunk）与
// unified_diff/get_grouped_opcodes/_format_range_unified，等同时性由
// test/udiff-parity.test.ts（固定语料逐字节）+ test/verify/snapshot-diff-parity.mjs（真项目快照对 python）证明。
// 口径边界：isjunk 恒为 None（difflib.unified_diff 就是这么调的），所以 bjunk 空、只有 autojunk。

/** Python str.splitlines() 的切点集合（\r 与 \r\n 已由调用方先归一为 \n）。 */
const LINE_SEP = /[\n\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/;

/** 与 Path.read_text(encoding="utf-8") + str.splitlines() 同口径：\r\n 与裸 \r 都算一行结束，
 *  行尾分隔符不产生空尾行（"a\n" → ["a"]，"" → []）。 */
export function splitLines(text: string): string[] {
  const norm = text.replace(/\r\n?/g, "\n");
  if (!norm) return [];
  const parts = norm.split(LINE_SEP);
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

interface Match {
  i: number;
  j: number;
  size: number;
}

/** difflib.SequenceMatcher 的忠实移植（isjunk=null，autojunk=true）。 */
export class SequenceMatcher {
  private a: string[] = [];
  private b: string[] = [];
  private b2j = new Map<string, number[]>();
  private matchingBlocks: Match[] | null = null;
  private opcodes: [string, number, number, number, number][] | null = null;

  constructor(a: string[], b: string[], private autojunk = true) {
    this.setSeq1(a);
    this.setSeq2(b);
  }

  private setSeq1(a: string[]): void {
    this.a = a;
    this.matchingBlocks = null;
    this.opcodes = null;
  }

  private setSeq2(b: string[]): void {
    this.b = b;
    const b2j = new Map<string, number[]>();
    b.forEach((elt, i) => {
      const idxs = b2j.get(elt);
      if (idxs) idxs.push(i);
      else b2j.set(elt, [i]);
    });
    // autojunk：b 长 ≥200 时，出现次数 > n/100+1 的元素从 b2j 里剔除（不再参与匹配起点）
    if (this.autojunk && b.length >= 200) {
      const ntest = Math.floor(b.length / 100) + 1;
      for (const [elt, idxs] of [...b2j]) {
        if (idxs.length > ntest) b2j.delete(elt);
      }
    }
    this.b2j = b2j;
    this.matchingBlocks = null;
    this.opcodes = null;
  }

  findLongestMatch(alo = 0, ahi?: number, blo = 0, bhi?: number): Match {
    const a = this.a;
    const b = this.b;
    const b2j = this.b2j;
    const hi = ahi ?? a.length;
    const hj = bhi ?? b.length;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < hi; i++) {
      const newj2len = new Map<number, number>();
      const js = b2j.get(a[i]);
      if (js) {
        for (const j of js) {
          if (j < blo) continue;
          if (j >= hj) break;
          const k = (j2len.get(j - 1) ?? 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }
    // bjunk 为空（isjunk=null），四段扩展里只有前两段（非 junk 两侧延伸）会生效，后两段恒不成立
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < hi &&
      bestj + bestsize < hj &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }
    return { i: besti, j: bestj, size: bestsize };
  }

  getMatchingBlocks(): Match[] {
    if (this.matchingBlocks) return this.matchingBlocks;
    const la = this.a.length;
    const lb = this.b.length;
    const queue: [number, number, number, number][] = [[0, la, 0, lb]];
    const matching: Match[] = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      if (x.size) {
        matching.push(x);
        if (alo < x.i && blo < x.j) queue.push([alo, x.i, blo, x.j]);
        if (x.i + x.size < ahi && x.j + x.size < bhi) queue.push([x.i + x.size, ahi, x.j + x.size, bhi]);
      }
    }
    matching.sort((p, q) => p.i - q.i || p.j - q.j || p.size - q.size);
    const nonAdjacent: Match[] = [];
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    for (const { i: i2, j: j2, size: k2 } of matching) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
      else {
        if (k1) nonAdjacent.push({ i: i1, j: j1, size: k1 });
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push({ i: i1, j: j1, size: k1 });
    nonAdjacent.push({ i: la, j: lb, size: 0 });
    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  getOpcodes(): [string, number, number, number, number][] {
    if (this.opcodes) return this.opcodes;
    const answer: [string, number, number, number, number][] = [];
    let i = 0;
    let j = 0;
    for (const { i: ai, j: bj, size } of this.getMatchingBlocks()) {
      let tag = "";
      if (i < ai && j < bj) tag = "replace";
      else if (i < ai) tag = "delete";
      else if (j < bj) tag = "insert";
      if (tag) answer.push([tag, i, ai, j, bj]);
      i = ai + size;
      j = bj + size;
      if (size) answer.push(["equal", ai, i, bj, j]);
    }
    this.opcodes = answer;
    return answer;
  }

  /** difflib get_grouped_opcodes：把长段 equal 按 n 行上下文切断，返回若干 hunk 组。 */
  getGroupedOpcodes(n = 3): [string, number, number, number, number][][] {
    const codes: [string, number, number, number, number][] = this.getOpcodes().map((c) => [...c]);
    if (!codes.length) codes.push(["equal", 0, 1, 0, 1]);
    if (codes[0][0] === "equal") {
      const [, i1, i2, j1, j2] = codes[0];
      codes[0] = ["equal", Math.max(i1, i2 - n), i2, Math.max(j1, j2 - n), j2];
    }
    if (codes[codes.length - 1][0] === "equal") {
      const [, i1, i2, j1, j2] = codes[codes.length - 1];
      codes[codes.length - 1] = ["equal", i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)];
    }
    const nn = n + n;
    const groups: [string, number, number, number, number][][] = [];
    let group: [string, number, number, number, number][] = [];
    for (const [tag, i1, i2, j1, j2] of codes) {
      if (tag === "equal" && i2 - i1 > nn) {
        group.push([tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)]);
        groups.push(group);
        group = [];
        const ni1 = Math.max(i1, i2 - n);
        const nj1 = Math.max(j1, j2 - n);
        group.push([tag, ni1, i2, nj1, j2]);
        continue;
      }
      group.push([tag, i1, i2, j1, j2]);
    }
    if (group.length && !(group.length === 1 && group[0][0] === "equal")) groups.push(group);
    return groups;
  }
}

/** difflib._format_range_unified。 */
function formatRange(start: number, stop: number): string {
  let beginning = start + 1;
  const length = stop - start;
  if (length === 1) return `${beginning}`;
  if (!length) beginning -= 1;
  return `${beginning},${length}`;
}

export interface DiffStat {
  text: string;
  adds: number;
  dels: number;
  hunks: number;
}

/** difflib.unified_diff(a, b, fromfile, tofile, n=3, lineterm="") 后 "\n".join(...) 的同口径实现。
 *  无变更（没有 hunk 组）→ 空串，与 "\n".join([]) 一致。 */
export function unifiedDiffLines(
  a: string[],
  b: string[],
  fromfile = "",
  tofile = "",
  n = 3,
): DiffStat {
  const out: string[] = [];
  let started = false;
  let adds = 0;
  let dels = 0;
  let hunks = 0;
  for (const group of new SequenceMatcher(a, b).getGroupedOpcodes(n)) {
    if (!started) {
      started = true;
      out.push(`--- ${fromfile}`);
      out.push(`+++ ${tofile}`);
    }
    const first = group[0];
    const last = group[group.length - 1];
    hunks += 1;
    out.push(`@@ -${formatRange(first[1], last[2])} +${formatRange(first[3], last[4])} @@`);
    for (const [tag, i1, i2, j1, j2] of group) {
      if (tag === "equal") {
        for (const line of a.slice(i1, i2)) out.push(` ${line}`);
        continue;
      }
      if (tag === "replace" || tag === "delete") {
        for (const line of a.slice(i1, i2)) {
          out.push(`-${line}`);
          dels += 1;
        }
      }
      if (tag === "replace" || tag === "insert") {
        for (const line of b.slice(j1, j2)) {
          out.push(`+${line}`);
          adds += 1;
        }
      }
    }
  }
  return { text: out.join("\n"), adds, dels, hunks };
}

/** 文本进、diff 出（snapshot.py diff_text 的对应物：默认标签 previous/current）。 */
export function diffText(aText: string, bText: string, fromfile = "previous", tofile = "current"): DiffStat {
  return unifiedDiffLines(splitLines(aText), splitLines(bText), fromfile, tofile);
}
