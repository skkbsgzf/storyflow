/**
 * preset 条件表达式求值（`when` / `disabled`）。
 *
 * 设计取舍：不用 `new Function`（preset 文件可能来自 user root，注入面不可控），
 * 也不复用 cond.ts 的 evalWhen（那是 flow 图的结构化谓词语言，语义不匹配）。
 * 这里实现一个极小的安全表达式子集：
 *   expr := and ("||" and)*
 *   and  := cmp ("&&" cmp)*
 *   cmp  := unary (("==="|"!=="|"=="|"!="|">="|"<="|">"|"<") unary)?
 *   unary:= "!" unary | primary
 *   primary := 'str' | "str" | 数字 | true | false | 标识符 | "(" expr ")"
 *
 * 可用标识符（求值上下文，未知名 = undefined）：
 *   nodeType / nodeId / pathClass / relPath / round / isChapter / hasWorldbook
 * 求值失败（语法错/类型错）一律 fail-open：safeEvalWhen 返回 true（断言保持启用）——
 * 与 DSH `disabled: !!js` 求值失败默认不禁用的口径一致。
 */

export class WhenParseError extends Error {}

interface Token {
  kind: "op" | "str" | "num" | "ident";
  value: string;
}

const OPS = ["===", "!==", "==", "!=", ">=", "<=", "&&", "||", ">", "<", "!", "(", ")"];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src.charAt(j) !== ch) {
        if (src.charAt(j) === "\\" && j + 1 < src.length) {
          s += src.charAt(j + 1);
          j += 2;
        } else {
          s += src.charAt(j);
          j++;
        }
      }
      if (j >= src.length) throw new WhenParseError(`字符串未闭合（位置 ${i}）`);
      out.push({ kind: "str", value: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ kind: "num", value: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ kind: "ident", value: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new WhenParseError(`非法字符 "${ch}"（位置 ${i}）`);
    out.push({ kind: "op", value: op });
    i += op.length;
  }
  return out;
}

function coerce(t: Token): unknown {
  if (t.kind === "num") return Number(t.value);
  if (t.kind === "ident") {
    if (t.value === "true") return true;
    if (t.value === "false") return false;
    if (t.value === "undefined") return undefined;
    if (t.value === "null") return null;
  }
  return t.value;
}

function compare(l: unknown, op: string, r: unknown): boolean {
  switch (op) {
    case "===":
    case "==":
      return l === r;
    case "!==":
    case "!=":
      return l !== r;
    case ">":
      return (l as number) > (r as number);
    case ">=":
      return (l as number) >= (r as number);
    case "<":
      return (l as number) < (r as number);
    case "<=":
      return (l as number) <= (r as number);
    default:
      throw new WhenParseError(`未知比较符 ${op}`);
  }
}

class Parser {
  private pos = 0;
  constructor(
    private readonly toks: Token[],
    private readonly ctx: Record<string, unknown>,
  ) {}
  private peek(): Token | undefined {
    return this.toks[this.pos];
  }
  private eat(expect?: string): Token {
    const t = this.toks[this.pos];
    if (!t) throw new WhenParseError(`表达式意外结束${expect ? `（期望 ${expect}）` : ""}`);
    if (expect && t.value !== expect) throw new WhenParseError(`期望 ${expect}，得 ${t.value}`);
    this.pos++;
    return t;
  }
  /** 是否已消费全部 token（供顶层校验尾部冗余）。 */
  atEnd(): boolean {
    return this.pos >= this.toks.length;
  }
  expr(): unknown {
    let left = this.and();
    while (this.peek()?.value === "||") {
      this.eat("||");
      const right = this.and();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }
  private and(): unknown {
    let left = this.cmp();
    while (this.peek()?.value === "&&") {
      this.eat("&&");
      const right = this.cmp();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }
  private cmp(): unknown {
    const left = this.unary();
    const t = this.peek();
    if (t?.kind === "op" && ["===", "!==", "==", "!=", ">=", "<=", ">", "<"].includes(t.value)) {
      this.eat();
      const right = this.unary();
      return compare(left, t.value, right);
    }
    return left;
  }
  private unary(): unknown {
    if (this.peek()?.value === "!") {
      this.eat("!");
      return !this.unary();
    }
    return this.primary();
  }
  private primary(): unknown {
    const t = this.peek();
    if (!t) throw new WhenParseError("表达式意外结束");
    if (t.value === "(") {
      this.eat("(");
      const v = this.expr();
      this.eat(")");
      return v;
    }
    this.eat();
    if (t.kind === "ident" && !["true", "false", "undefined", "null"].includes(t.value)) {
      return this.ctx[t.value];
    }
    return coerce(t);
  }
}

/** 求值条件表达式；语法/求值错误抛 WhenParseError（由调用方决定 fail-open）。 */
export function evalWhenExpr(expr: string, ctx: Record<string, unknown>): unknown {
  const p = new Parser(tokenize(expr), ctx);
  const v = p.expr();
  if (!p.atEnd()) throw new WhenParseError("表达式尾部有多余内容");
  return v;
}

/** fail-open 口径：任何解析/求值错误都返回 true（断言保持启用）。 */
export function safeEvalWhen(expr: string | undefined, ctx: Record<string, unknown>): boolean {
  if (!expr || !expr.trim()) return true;
  try {
    return Boolean(evalWhenExpr(expr, ctx));
  } catch {
    return true;
  }
}
