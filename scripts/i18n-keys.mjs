// Lists every translation key in src: string literals passed to t(), t.plural() and msg().
// `node scripts/i18n-keys.mjs` prints them; `--missing` prints only those without a French translation.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");

export function collectKeys(dir = path.join(root, "src")) {
  const keys = new Set();
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !p.includes(`${path.sep}i18n${path.sep}`)) files.push(p);
    }
  };
  walk(dir);
  const strings = (n, out) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isConditionalExpression(n)) {
      strings(n.whenTrue, out);
      strings(n.whenFalse, out);
    } else if (ts.isParenthesizedExpression(n)) strings(n.expression, out);
    return out;
  };
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!/\b(t|msg)\(|\.plural\(/.test(src)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText(sf);
        if ((callee === "t" || callee === "msg") && n.arguments[0]) strings(n.arguments[0], []).forEach((k) => keys.add(k));
        if (/(^|\.)t\.plural$/.test(callee) || callee === "t.plural") for (const a of n.arguments.slice(1, 3)) strings(a, []).forEach((k) => keys.add(k));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return [...keys].sort();
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const keys = collectKeys();
  let out = keys;
  if (process.argv.includes("--missing")) {
    // One dictionary per app in src/i18n/fr/ (index.ts only gathers them).
    const dir = path.join(root, "src", "i18n", "fr");
    const fr = {};
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
      const src = ts.transpileModule(fs.readFileSync(path.join(dir, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
      Object.assign(fr, ...Object.values(await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`)));
    }
    out = keys.filter((k) => !(k in fr));
  }
  console.log(JSON.stringify(out, null, 1));
  console.error(`${out.length} keys`);
}
