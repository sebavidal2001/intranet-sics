// ─── Motore di formule sicuro per i template prodotti ────────────────────────
// Valuta espressioni tipo "(larghezza/1000)*n_gradini" o "IF(profondita>0, altezza/1000, 0)"
// SENZA usare eval(). Supporta: numeri, identificatori (slug), + - * / , parentesi,
// confronti (> < >= <= = == <> !=), AND/OR/NOT (&& || !), e funzioni
// IF(cond,a,b), AND(...), OR(...), MIN/MAX, ROUND/CEIL/FLOOR, ABS.
// I booleani sono coercizzati a 1/0.

export class FormulaError extends Error {}

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

const OPS2 = new Set([">=", "<=", "==", "!=", "<>", "&&", "||"]);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c >= "0" && c <= "9") {
      // Decimali con il punto; la virgola è SOLO separatore di argomenti.
      let j = i + 1;
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
      toks.push({ t: "num", v: parseFloat(s.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push({ t: "id", v: s.slice(i, j) });
      i = j; continue;
    }
    if (c === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp" }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma" }); i++; continue; }
    const two = s.slice(i, i + 2);
    if (OPS2.has(two)) { toks.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/<>=!".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    throw new FormulaError(`Carattere non valido: "${c}"`);
  }
  return toks;
}

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "un"; op: string; e: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] };

// Recursive-descent parser con precedenze.
class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok | undefined { return this.toks[this.p]; }
  private next(): Tok | undefined { return this.toks[this.p++]; }
  parse(): Node {
    const n = this.parseOr();
    if (this.p !== this.toks.length) throw new FormulaError("Espressione non valida");
    return n;
  }
  private parseOr(): Node {
    let a = this.parseAnd();
    while (this.isOp("||")) { this.next(); a = { k: "bin", op: "||", a, b: this.parseAnd() }; }
    return a;
  }
  private parseAnd(): Node {
    let a = this.parseCmp();
    while (this.isOp("&&")) { this.next(); a = { k: "bin", op: "&&", a, b: this.parseCmp() }; }
    return a;
  }
  private parseCmp(): Node {
    let a = this.parseAdd();
    while (this.isOp(">") || this.isOp("<") || this.isOp(">=") || this.isOp("<=") || this.isOp("=") || this.isOp("==") || this.isOp("!=") || this.isOp("<>")) {
      const op = (this.next() as { v: string }).v;
      a = { k: "bin", op, a, b: this.parseAdd() };
    }
    return a;
  }
  private parseAdd(): Node {
    let a = this.parseMul();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.next() as { v: string }).v;
      a = { k: "bin", op, a, b: this.parseMul() };
    }
    return a;
  }
  private parseMul(): Node {
    let a = this.parseUnary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.next() as { v: string }).v;
      a = { k: "bin", op, a, b: this.parseUnary() };
    }
    return a;
  }
  private parseUnary(): Node {
    if (this.isOp("-")) { this.next(); return { k: "un", op: "-", e: this.parseUnary() }; }
    if (this.isOp("+")) { this.next(); return this.parseUnary(); }
    if (this.isOp("!")) { this.next(); return { k: "un", op: "!", e: this.parseUnary() }; }
    return this.parsePrimary();
  }
  private parsePrimary(): Node {
    const tk = this.next();
    if (!tk) throw new FormulaError("Espressione incompleta");
    if (tk.t === "num") return { k: "num", v: tk.v };
    if (tk.t === "lp") {
      const e = this.parseOr();
      if (this.next()?.t !== "rp") throw new FormulaError("Parentesi non chiusa");
      return e;
    }
    if (tk.t === "id") {
      const up = tk.v.toUpperCase();
      // funzione?
      if (this.peek()?.t === "lp") {
        this.next(); // lp
        const args: Node[] = [];
        if (this.peek()?.t !== "rp") {
          args.push(this.parseOr());
          while (this.peek()?.t === "comma") { this.next(); args.push(this.parseOr()); }
        }
        if (this.next()?.t !== "rp") throw new FormulaError(`Argomenti di ${tk.v} non chiusi`);
        return { k: "call", name: up, args };
      }
      // costanti booleane / identificatori
      if (up === "TRUE") return { k: "num", v: 1 };
      if (up === "FALSE") return { k: "num", v: 0 };
      return { k: "var", name: tk.v };
    }
    throw new FormulaError("Token inatteso");
  }
  private isOp(v: string): boolean {
    const tk = this.peek();
    return !!tk && tk.t === "op" && tk.v === v;
  }
}

export type Scope = Record<string, number | boolean | string | null | undefined>;

function toNum(v: number | boolean | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().toLowerCase();
  if (s === "si" || s === "sì" || s === "true" || s === "yes") return 1;
  if (s === "no" || s === "false") return 0;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function evalNode(n: Node, scope: Scope): number {
  switch (n.k) {
    case "num": return n.v;
    case "var": {
      if (!(n.name in scope)) throw new FormulaError(`Variabile sconosciuta: "${n.name}"`);
      return toNum(scope[n.name]);
    }
    case "un":
      return n.op === "-" ? -evalNode(n.e, scope) : (evalNode(n.e, scope) === 0 ? 1 : 0);
    case "bin": {
      if (n.op === "&&" || n.op === "||") {
        const a = evalNode(n.a, scope) !== 0, b = evalNode(n.b, scope) !== 0;
        return (n.op === "&&" ? a && b : a || b) ? 1 : 0;
      }
      const a = evalNode(n.a, scope), b = evalNode(n.b, scope);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? 0 : a / b;
        case ">": return a > b ? 1 : 0;
        case "<": return a < b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case "=": case "==": return a === b ? 1 : 0;
        case "!=": case "<>": return a !== b ? 1 : 0;
        default: throw new FormulaError(`Operatore non supportato: ${n.op}`);
      }
    }
    case "call": {
      const A = n.args.map((x) => evalNode(x, scope));
      switch (n.name) {
        case "IF": return n.args.length >= 3 ? (evalNode(n.args[0], scope) !== 0 ? evalNode(n.args[1], scope) : evalNode(n.args[2], scope)) : 0;
        case "AND": return A.every((x) => x !== 0) ? 1 : 0;
        case "OR": return A.some((x) => x !== 0) ? 1 : 0;
        case "NOT": return A[0] === 0 ? 1 : 0;
        case "MIN": return A.length ? Math.min(...A) : 0;
        case "MAX": return A.length ? Math.max(...A) : 0;
        case "ROUND": return A.length >= 2 ? Math.round(A[0] * 10 ** A[1]) / 10 ** A[1] : Math.round(A[0] ?? 0);
        case "CEIL": return Math.ceil(A[0] ?? 0);
        case "FLOOR": return Math.floor(A[0] ?? 0);
        case "ABS": return Math.abs(A[0] ?? 0);
        default: throw new FormulaError(`Funzione sconosciuta: ${n.name}`);
      }
    }
  }
}

/** Valuta una singola formula con uno scope di variabili. Ritorna un numero. */
export function evalFormula(expr: string, scope: Scope): number {
  if (!expr || !expr.trim()) return 0;
  const ast = new Parser(tokenize(expr)).parse();
  return evalNode(ast, scope);
}

/** Estrae gli identificatori (variabili) referenziati in una formula. */
export function formulaDeps(expr: string): string[] {
  if (!expr || !expr.trim()) return [];
  const deps = new Set<string>();
  const reserved = new Set(["IF","AND","OR","NOT","MIN","MAX","ROUND","CEIL","FLOOR","ABS","TRUE","FALSE"]);
  for (const tk of tokenize(expr)) {
    if (tk.t === "id" && !reserved.has(tk.v.toUpperCase())) deps.add(tk.v);
  }
  return [...deps];
}

/** Verifica sintassi + dipendenze ammesse. Ritorna {ok, error?, deps}. */
export function validateFormula(expr: string, allowed: Set<string>): { ok: boolean; error?: string; deps: string[] } {
  try {
    const deps = formulaDeps(expr);
    const unknown = deps.filter((d) => !allowed.has(d));
    if (unknown.length) return { ok: false, error: `Riferimenti sconosciuti: ${unknown.join(", ")}`, deps };
    new Parser(tokenize(expr)).parse();
    return { ok: true, deps };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Errore di sintassi", deps: [] };
  }
}

/**
 * Risolve le quantità di righe il cui valore dipende da parametri e/o da altre
 * righe (per slug). Valutazione iterativa con risoluzione delle dipendenze:
 * fino a N passate finché i valori si stabilizzano (gestisce riferimenti incrociati
 * semplici tipo tubo = fiancate*2 dove fiancate è un'altra riga).
 */
export function risolviQuantita(
  righe: { slug: string | null; qta_formula: string | null; qta_manuale: number }[],
  parametri: Scope
): Map<string, number> {
  const out = new Map<string, number>(); // per indice
  const valori: Scope = { ...parametri };
  // inizializza con manuali / 0
  righe.forEach((r, idx) => {
    const key = r.slug || `__r${idx}`;
    const v = r.qta_formula ? 0 : (r.qta_manuale ?? 0);
    valori[key] = v;
    out.set(String(idx), v);
  });
  // itera per propagare dipendenze tra righe
  for (let pass = 0; pass < righe.length + 2; pass++) {
    let changed = false;
    righe.forEach((r, idx) => {
      if (!r.qta_formula) return;
      const key = r.slug || `__r${idx}`;
      let v: number;
      try { v = evalFormula(r.qta_formula, valori); } catch { v = 0; }
      if (valori[key] !== v) { valori[key] = v; out.set(String(idx), v); changed = true; }
    });
    if (!changed) break;
  }
  return out;
}
