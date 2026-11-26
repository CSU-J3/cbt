// HO 835 § 1 — attribute each store statement a probe load logged to the reader that
// issued it, by matching its SQL against the source, and credit it through the call
// graph to the unstable_cache reader(s) that reach it. Read-only: it reads the probe's
// JSONL, the source tree (parsed with the repo's own TypeScript compiler API,
// createSourceFile only, no type checking), scripts/migrate.ts's table names and
// vercel.json's crons, and writes a JSON and a text report at <out-prefix>. No store,
// no server, no network. Nothing is guessed: a statement no source literal matches is
// listed as unmatched, and a statement more than one reader reaches is listed with
// every reader and marked ambiguous.
//
//   node scripts/diagnostic/home-cold-plan-835-attribute.mjs <probe.jsonl> <out-prefix>
//        [--group name=readerA,readerB,...]... [--resolve 'reader::regex']...
//
// --resolve records a resolution made by reading the code: a statement still ambiguous on
// the route whose SQL matches the regex goes to that reader, which must be one of its
// on-route candidates (otherwise the script stops). The report keeps every candidate.
//
// How:
//   1. Every .ts/.tsx file in lib/, components/ and app/ (plus the root auth.ts) is
//      parsed. Every `unstable_cache(callback, keyParts, options)` call is indexed: its
//      callback's span, its first keyParts string literal (or the keyParts text if it
//      has none), revalidate and tags as written, and the name it is declared as (the
//      variable it is assigned to, else the named function that returns it).
//   2. Every string and template literal holding SELECT or WITH is indexed at its
//      file:line with its nearest enclosing named function and the innermost
//      unstable_cache callback that encloses it, if any. Each ${…} hole is a wildcard,
//      except a hole that names a module-level `const` string (in the same file, or
//      imported from one): that text is inlined, so a composed statement matches its
//      whole source.
//   3. A call graph over every top-level declaration (functions, consts, classes) and
//      every unstable_cache callback: an edge for each identifier or JSX tag that
//      resolves (same file, or through an import or re-export) to another declaration.
//      Calls inside a nested unstable_cache callback belong to that callback, so the
//      walk from one reader stops at the next reader: the innermost cache is the one
//      whose miss runs the SQL.
//   4. Matching (unchanged from the first cut): a statement matches a literal when the
//      literal, as a pattern, matches the whole statement (full), or when every fixed
//      piece of it of at least 30 characters is found inside the statement (part). A
//      full match always beats a part match (parts are tried only when no literal
//      matches fully). Within a kind the higher score wins: a full match's fixed
//      characters, a part match's characters in its pieces of 30 or more. Ties are all
//      kept.
//   5. A literal inside a cached callback is that reader's. A literal in an uncached
//      helper is credited to every reader whose callback reaches the helper, and to
//      "uncached: <helper>" when the page reaches the helper with no cache between.
//      Candidates are then narrowed to what the logged page request's route reaches
//      from app/<route>/page.tsx and its layouts (static reach: every branch counts).
//      Statuses: single (one candidate at all), route-resolved (several, one on the
//      route, with the path as evidence), code-resolved (several on the route, settled by
//      a --resolve flag), ambiguous (several on the route, all listed), unreached (none on
//      the route, all listed), unmatched.
//   6. Each store request goes to the reader of its statements; the timeline gives each
//      reader's first start and last end, and the longest serial chain: from the request
//      that ends last, back to the request that ended latest at or before its start,
//      within 5 ms, and so on. Two more readings beside it: the longest such chain from
//      any request, and the same walk with no 5 ms bound, each gap over 5 ms named (time
//      the load spent off the store). --group repeats the readings inside a named set of
//      readers.
//   7. Tag expiry: every expireTag / revalidateTag / updateTag call (and a parameter
//      defaulted to expireTag) in lib/, app/ and scripts/ outside scripts/diagnostic/,
//      with the routes that reach it and their vercel.json schedules, and every script
//      literal that POSTs /api/revalidate?tag=…, plus (skeptic pass) every script fetch()
//      of REVALIDATE_URL with no ?tag=, credited to the route's default tag.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");

const argv = process.argv.slice(2);
const positional = argv.filter((a, i) => !a.startsWith("--") && !["--group", "--resolve"].includes(argv[i - 1]));
const groups = [];
const resolutions = [];
argv.forEach((a, i) => {
  const g = a === "--group" ? argv[i + 1] : a.startsWith("--group=") ? a.slice(8) : null;
  if (g) {
    const [name, list] = g.split("=");
    groups.push({ name, readers: (list ?? "").split(",").map((s) => s.trim()).filter(Boolean) });
  }
  const r = a === "--resolve" ? argv[i + 1] : a.startsWith("--resolve=") ? a.slice(10) : null;
  if (r) {
    const k = r.indexOf("::");
    if (k < 0) throw new Error(`--resolve wants 'reader::regex', got ${r}`);
    resolutions.push({ reader: r.slice(0, k), re: new RegExp(r.slice(k + 2)), spec: r, used: 0 });
  }
});
const [logPath, outPrefix] = positional;
if (!logPath || !outPrefix) throw new Error("usage: home-cold-plan-835-attribute.mjs <probe.jsonl> <out-prefix> [--group name=a,b]");

const rel = (abs) => path.relative(ROOT, abs).replace(/\\/g, "/");
const collapse = (s) => s.replace(/\s+/g, " ").trim();
const walkDir = (d, keep) =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return e.name === "node_modules" || e.name === ".next" ? [] : walkDir(p, keep);
        return keep(p) ? [p] : [];
      })
    : [];
const isTs = (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts");
const SQL_ROOTS = ["lib", "components", "app"];
const sqlFiles = new Set(SQL_ROOTS.flatMap((r) => walkDir(path.join(ROOT, r), isTs)).map(rel));
const extra = ["auth.ts"].filter((f) => fs.existsSync(path.join(ROOT, f)));
const scriptFiles = walkDir(path.join(ROOT, "scripts"), (p) => /\.(ts|mts|mjs|js|cjs)$/.test(p))
  .map(rel)
  .filter((f) => !f.startsWith("scripts/diagnostic/"));
const allFiles = [...new Set([...sqlFiles, ...extra, ...scriptFiles])];

// ---- pass 1: parse, imports, exports, top-level declarations ------------------------------
const F = new Map(); // rel -> file info
const declById = new Map();
const hasMod = (n, kind) => !!(ts.canHaveModifiers?.(n) ? ts.getModifiers(n) : n.modifiers)?.some((m) => m.kind === kind);
function resolveModule(fromRel, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(ROOT, path.dirname(fromRel), spec);
  else return null;
  const b = rel(base).replace(/\.(js|mjs)$/, "");
  for (const c of [b, `${b}.ts`, `${b}.tsx`, `${b}/index.ts`, `${b}/index.tsx`, `${b}.mjs`, `${b}.js`]) if (F.has(c)) return c;
  return null;
}
for (const f of allFiles) {
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  const kind = f.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.(mjs|js|cjs)$/.test(f) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kind);
  F.set(f, { rel: f, sf, text, decls: new Map(), imports: new Map(), nsImports: new Map(), exportsMap: new Map(), stars: [], cacheNames: new Set(), nextCacheNames: new Map(), sql: sqlFiles.has(f) || extra.includes(f) });
}
const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
function addDecl(fi, name, node, span, kind, extraProps = {}) {
  const id = `decl:${fi.rel}#${name}`;
  const d = { id, file: fi.rel, name, node, span, kind, line: lineOf(fi.sf, node.getStart(fi.sf)), ...extraProps };
  fi.decls.set(name, d);
  declById.set(id, d);
  return d;
}
for (const fi of F.values()) {
  for (const st of fi.sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      const ic = st.importClause;
      if (!ic) continue;
      if (spec === "next/cache") {
        if (ic.namedBindings && ts.isNamedImports(ic.namedBindings))
          for (const el of ic.namedBindings.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (imported === "unstable_cache") fi.cacheNames.add(el.name.text);
            fi.nextCacheNames.set(el.name.text, imported);
          }
        continue;
      }
      const from = resolveModule(fi.rel, spec);
      if (!from) continue;
      if (ic.name) fi.imports.set(ic.name.text, { from, imported: "default" });
      if (ic.namedBindings) {
        if (ts.isNamespaceImport(ic.namedBindings)) fi.nsImports.set(ic.namedBindings.name.text, from);
        else for (const el of ic.namedBindings.elements) fi.imports.set(el.name.text, { from, imported: (el.propertyName ?? el.name).text });
      }
    } else if (ts.isExportDeclaration(st)) {
      const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? resolveModule(fi.rel, st.moduleSpecifier.text) : null;
      if (!st.exportClause) { if (from) fi.stars.push(from); continue; }
      if (ts.isNamedExports(st.exportClause))
        for (const el of st.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text;
          fi.exportsMap.set(el.name.text, from ? { from, imported: local } : local);
        }
    } else if (ts.isFunctionDeclaration(st)) {
      const isDefault = hasMod(st, ts.SyntaxKind.DefaultKeyword);
      const name = st.name?.text ?? "default";
      addDecl(fi, name, st, st, "function");
      if (hasMod(st, ts.SyntaxKind.ExportKeyword)) fi.exportsMap.set(isDefault ? "default" : name, name);
    } else if (ts.isClassDeclaration(st) && st.name) {
      addDecl(fi, st.name.text, st, st, "class");
      if (hasMod(st, ts.SyntaxKind.ExportKeyword)) fi.exportsMap.set(hasMod(st, ts.SyntaxKind.DefaultKeyword) ? "default" : st.name.text, st.name.text);
    } else if (ts.isVariableStatement(st)) {
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const vd of st.declarationList.declarations) {
        if (!ts.isIdentifier(vd.name)) continue;
        addDecl(fi, vd.name.text, vd, vd.initializer ?? vd, "var", { isConst });
        if (hasMod(st, ts.SyntaxKind.ExportKeyword)) fi.exportsMap.set(vd.name.text, vd.name.text);
      }
    } else if (ts.isExportAssignment(st)) {
      if (ts.isIdentifier(st.expression)) fi.exportsMap.set("default", st.expression.text);
      else { addDecl(fi, "default", st, st.expression, "var"); fi.exportsMap.set("default", "default"); }
    }
  }
}
function resolveExport(file, exported, seen = new Set()) {
  const key = `${file}#${exported}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const fi = F.get(file);
  if (!fi) return [];
  const e = fi.exportsMap.get(exported);
  if (typeof e === "string") return resolveRef(file, e, seen);
  if (e) return resolveExport(e.from, e.imported, seen);
  if (exported !== "default") for (const s of fi.stars) { const r = resolveExport(s, exported, seen); if (r.length) return r; }
  return [];
}
function resolveRef(file, name, seen = new Set()) {
  const fi = F.get(file);
  if (!fi) return [];
  if (fi.decls.has(name)) return [fi.decls.get(name).id];
  const imp = fi.imports.get(name);
  if (imp) return resolveExport(imp.from, imp.imported, seen);
  return [];
}

// ---- pass 2: cache sites, literals, references, edges --------------------------------------
const sites = [];
const siteById = new Map();
const literals = [];
const edges = new Map(); // ownerId -> Map(targetId -> "file:line")
const expiries = [];
const revalidatePosts = [];
const addEdge = (from, to, where) => {
  if (!from || !to || from === to) return;
  if (!edges.has(from)) edges.set(from, new Map());
  const m = edges.get(from);
  if (!m.has(to)) m.set(to, where);
};
const unwrap = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n)) || ts.isTypeAssertionExpression?.(n))) n = n.expression;
  return n;
};
function constString(file, expr, depth) {
  expr = unwrap(expr);
  if (!expr || !ts.isIdentifier(expr) || depth > 5) return null;
  const ids = resolveRef(file, expr.text);
  if (ids.length !== 1) return null;
  const d = declById.get(ids[0]);
  if (!d || d.kind !== "var" || !d.isConst || !d.node.initializer) return null;
  const init = unwrap(d.node.initializer);
  const r = litParts(init, d.file, depth + 1);
  return r ? { ...r, inlined: [`${d.name} (${d.file}:${d.line})`, ...r.inlined] } : null;
}
function litParts(node, file, depth = 0) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { parts: [node.text], inlined: [] };
  if (ts.isTemplateExpression(node)) {
    const parts = [node.head.text];
    const inlined = [];
    for (const span of node.templateSpans) {
      const c = constString(file, span.expression, depth);
      if (c) {
        parts[parts.length - 1] += c.parts[0];
        parts.push(...c.parts.slice(1));
        inlined.push(...c.inlined);
      } else parts.push("");
      parts[parts.length - 1] += span.literal.text;
    }
    return { parts, inlined };
  }
  return null;
}
const DECL_NAME_PARENTS = new Set([
  ts.SyntaxKind.VariableDeclaration, ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.Parameter, ts.SyntaxKind.BindingElement, ts.SyntaxKind.PropertyAssignment, ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.PropertySignature, ts.SyntaxKind.MethodSignature, ts.SyntaxKind.EnumMember,
  ts.SyntaxKind.TypeAliasDeclaration, ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.TypeParameter, ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.ImportClause, ts.SyntaxKind.NamespaceImport, ts.SyntaxKind.ExportSpecifier, ts.SyntaxKind.LabeledStatement,
  ts.SyntaxKind.JsxAttribute, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor, ts.SyntaxKind.EnumDeclaration,
]);
function isReference(id) {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p)) return false;
  if (DECL_NAME_PARENTS.has(p.kind) && p.name === id) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isExpressionWithTypeArguments(p)) return false;
  return true;
}
function fnNameOf(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) return node.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parent) {
    const p = node.parent;
    if ((ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) && ts.isIdentifier(p.name)) return p.name.text;
  }
  return null;
}
function declaredNameOf(call) {
  for (let p = call.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
    const n = fnNameOf(p);
    if (n) return n;
  }
  return "(anonymous)";
}
const isExpireDecl = (id) => id === "decl:lib/cache/expire-tag.ts#expireTag";
// Skeptic pass (HO 835): a script that POSTs REVALIDATE_URL with no `?tag=` still expires
// a tag, the route's default (`searchParams.get("tag") ?? "bills"`). Read that default
// and its line from the route, so a tagless POST is credited to it instead of missed.
const REVALIDATE_DEFAULT = (() => {
  const fi = F.get("app/api/revalidate/route.ts");
  const m = fi && /searchParams\.get\(\s*["']tag["']\s*\)\s*\?\?\s*["']([a-z0-9-]+)["']/.exec(fi.text);
  return m ? { tag: m[1], at: `app/api/revalidate/route.ts:${fi.text.slice(0, m.index).split("\n").length}` } : null;
})();
const enclosingFnText = (node, sf) => {
  for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent)
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isMethodDeclaration(p)) return p.getText(sf);
  return sf.text;
};
function walkFile(fi) {
  const sf = fi.sf;
  const where = (n) => `${fi.rel}:${lineOf(sf, n.getStart(sf))}`;
  const expireAliases = new Set(); // parameter names defaulted to expireTag (lib/general-ballot.ts `expire`)
  function visit(node, ctx) {
    const owner = ctx.site ? ctx.site.id : ctx.top ? ctx.top.id : null;
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(unwrap(node.initializer))) {
      if (resolveRef(fi.rel, unwrap(node.initializer).text).some(isExpireDecl)) expireAliases.add(node.name.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      const a0 = node.arguments[0];
      const isExpire =
        resolveRef(fi.rel, callee).some(isExpireDecl) ||
        (["revalidateTag", "updateTag"].includes(fi.nextCacheNames.get(callee)) && fi.rel !== "lib/cache/expire-tag.ts") ||
        expireAliases.has(callee);
      if (isExpire && a0) {
        const tag = ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0) ? a0.text : null;
        expiries.push({ file: fi.rel, line: lineOf(sf, node.getStart(sf)), callee, tag, argText: collapse(a0.getText(sf)), top: ctx.top?.id ?? null, fn: ctx.fnName });
      }
      // A tagless POST: fetch(<id>, …) where <id> is `process.env.REVALIDATE_URL` in the
      // enclosing function (a `?tag=` template is caught by the literal scan below).
      if (!fi.sql && callee === "fetch" && a0 && ts.isIdentifier(a0) && REVALIDATE_DEFAULT) {
        const decl = new RegExp(`\\b(?:const|let|var)\\s+${a0.text}\\s*=\\s*process\\.env\\.REVALIDATE_URL\\b`);
        if (decl.test(enclosingFnText(node, sf)))
          revalidatePosts.push({ file: fi.rel, line: lineOf(sf, node.getStart(sf)), tag: REVALIDATE_DEFAULT.tag, how: `fetch() POST with no ?tag= when the script runs (the route defaults to "${REVALIDATE_DEFAULT.tag}", ${REVALIDATE_DEFAULT.at})` });
      }
      if (fi.sql && fi.cacheNames.has(callee)) {
        const [cb, kp, opt] = node.arguments;
        let keyFirst = null;
        let keyText = kp ? collapse(kp.getText(sf)) : "(none)";
        if (kp && ts.isArrayLiteralExpression(kp)) {
          const e0 = kp.elements[0];
          if (e0 && (ts.isStringLiteral(e0) || ts.isNoSubstitutionTemplateLiteral(e0))) keyFirst = e0.text;
        }
        let revalidate = "(none)", tags = "(none)";
        if (opt && ts.isObjectLiteralExpression(opt)) {
          for (const pr of opt.properties) {
            const nm = pr.name && (ts.isIdentifier(pr.name) || ts.isStringLiteral(pr.name)) ? pr.name.text : null;
            const val = ts.isPropertyAssignment(pr) ? collapse(pr.initializer.getText(sf)) : ts.isShorthandPropertyAssignment(pr) ? pr.name.text : null;
            if (nm === "revalidate") revalidate = val;
            if (nm === "tags") tags = val;
          }
        } else if (opt) revalidate = tags = `(options: ${collapse(opt.getText(sf))})`;
        const line = lineOf(sf, node.getStart(sf));
        const declName = declaredNameOf(node);
        const site = {
          id: `site:${fi.rel}:${line}`, file: fi.rel, line, declName, keyFirst, keyText, revalidate, tags,
          display: keyFirst && keyFirst !== declName ? `${declName} [key "${keyFirst}"]` : declName,
          cbStart: cb ? cb.getStart(sf) : -1, cbEnd: cb ? cb.getEnd() : -1, parentSite: ctx.site?.id ?? null, top: ctx.top?.id ?? null,
        };
        sites.push(site);
        siteById.set(site.id, site);
        addEdge(owner, site.id, where(node));
        visit(node.expression, ctx);
        node.arguments.forEach((a, i) => visit(a, i === 0 ? { ...ctx, site, fnName: `${declName} (cached callback)` } : ctx));
        return;
      }
    }
    let next = ctx;
    const fname = fnNameOf(node);
    if (fname) next = { ...ctx, fnName: fname };
    if (fi.sql && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))) {
      const r = litParts(node, fi.rel);
      if (r && /\b(SELECT|WITH)\b/i.test(r.parts.join(" ")) && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
        const parts = r.parts.map(collapse);
        literals.push({
          file: fi.rel, line: lineOf(sf, node.getStart(sf)), raw: r.parts.join(" \u2026 "), parts,
          fixed: parts.join("").replace(/\s+/g, "").length, inlined: r.inlined,
          fn: ctx.fnName ?? "(module level)", site: ctx.site?.id ?? null, top: ctx.top?.id ?? null,
        });
      }
    }
    if (!fi.sql && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))) {
      const r = litParts(node, fi.rel);
      const m = r && /\?tag=([a-z0-9-]+)/.exec(r.parts.join("${}"));
      if (m) {
        let p = node.parent;
        while (p && (ts.isTemplateSpan(p) || ts.isBinaryExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
        const viaFetch = p && ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "fetch";
        revalidatePosts.push({ file: fi.rel, line: lineOf(sf, node.getStart(sf)), tag: m[1], how: viaFetch ? "fetch() POST when the script runs" : "printed instruction (a human runs it)" });
      }
    }
    if (ts.isIdentifier(node) && owner && isReference(node)) {
      for (const t of resolveRef(fi.rel, node.text)) addEdge(owner, t, where(node));
    } else if (ts.isPropertyAccessExpression(node) && owner && ts.isIdentifier(node.expression) && fi.nsImports.has(node.expression.text)) {
      for (const t of resolveExport(fi.nsImports.get(node.expression.text), node.name.text)) addEdge(owner, t, where(node));
    }
    ts.forEachChild(node, (c) => visit(c, next));
  }
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const vd of st.declarationList.declarations) {
        const top = ts.isIdentifier(vd.name) ? fi.decls.get(vd.name.text) : null;
        visit(vd, { top, fnName: top?.name ?? null, site: null });
      }
    } else if (ts.isFunctionDeclaration(st) || (ts.isClassDeclaration(st) && st.name)) {
      const top = fi.decls.get(st.name?.text ?? "default");
      visit(st, { top, fnName: top?.name ?? null, site: null });
    } else if (ts.isExportAssignment(st)) {
      const top = fi.decls.get("default") ?? null;
      visit(st, { top, fnName: "default", site: null });
    } else if (!ts.isImportDeclaration(st)) visit(st, { top: null, fnName: null, site: null });
  }
}
for (const fi of F.values()) walkFile(fi);

// ---- reach ---------------------------------------------------------------------------------
// reach(site): declarations its callback reaches without passing another reader.
const reachCache = new Map();
function reachOf(siteId) {
  if (reachCache.has(siteId)) return reachCache.get(siteId);
  const seen = new Set();
  const nested = new Set();
  const q = [siteId];
  while (q.length) {
    const cur = q.shift();
    for (const t of (edges.get(cur) ?? new Map()).keys()) {
      if (t.startsWith("site:")) { if (t !== siteId) nested.add(t); continue; }
      if (!seen.has(t)) { seen.add(t); q.push(t); }
    }
  }
  const r = { decls: seen, nested };
  reachCache.set(siteId, r);
  return r;
}
const sitesReaching = new Map(); // declId -> Set(siteId)
for (const s of sites) for (const d of reachOf(s.id).decls) {
  if (!sitesReaching.has(d)) sitesReaching.set(d, new Set());
  sitesReaching.get(d).add(s.id);
}

// The route the probe loaded, from the page request id ("2 GET /electoral").
const rawLines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const reqs = rawLines.filter((l) => l.kind === "store" || l.kind === "store-error");
const routes = [...new Set(reqs.map((r) => (r.req ?? "").split(" ").slice(2).join(" ").split("?")[0]))].filter(Boolean);
const route = routes[0] ?? "/";
const segs = route.split("/").filter(Boolean);
const entryFiles = [];
for (let i = 0; i <= segs.length; i++) {
  const dir = ["app", ...segs.slice(0, i)].join("/");
  for (const n of ["layout.tsx", "template.tsx"]) if (F.has(`${dir}/${n}`)) entryFiles.push(`${dir}/${n}`);
}
entryFiles.push(`${["app", ...segs].join("/")}/page.tsx`);
const entries = [];
for (const ef of entryFiles) {
  if (!F.has(ef)) continue;
  for (const n of ["default", "generateMetadata", "generateViewport"]) entries.push(...resolveExport(ef, n));
}
function bfs(starts, throughSites) {
  const parent = new Map();
  const q = [];
  for (const s of starts) { parent.set(s, null); q.push(s); }
  while (q.length) {
    const cur = q.shift();
    if (cur.startsWith("site:") && !throughSites && !starts.includes(cur)) continue;
    for (const [t, w] of edges.get(cur) ?? new Map()) {
      if (parent.has(t)) continue;
      parent.set(t, { from: cur, where: w });
      q.push(t);
    }
  }
  return parent;
}
const routeAll = bfs(entries, true);
const routeUncached = bfs(entries, false);
const nameOf = (id) => (id.startsWith("site:") ? `${siteById.get(id).display} (cached, ${id.slice(5)})` : `${declById.get(id)?.name} (${declById.get(id)?.file}:${declById.get(id)?.line})`);
function pathTo(parent, id) {
  const hops = [];
  for (let cur = id; cur && parent.has(cur); ) {
    const p = parent.get(cur);
    if (!p) { hops.push(nameOf(cur)); break; }
    hops.push(`${nameOf(cur)} <- ${p.where}`);
    cur = p.from;
  }
  return hops.reverse().join(" \u2192 ");
}

// ---- match ---------------------------------------------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
for (const L of literals) {
  L.full = new RegExp("^\\s*" + L.parts.map(esc).join("[\\s\\S]*?") + "\\s*;?\\s*$", "i");
  L.pieces = L.parts.filter((p) => p.replace(/\s+/g, "").length >= 30);
}
// A helper is an uncached reader somewhere when an app/ declaration (a page, layout or
// route) reaches it with no cache between, or when no cached reader reaches it at all.
const appUncached = bfs([...declById.values()].filter((d) => d.file.startsWith("app/")).map((d) => d.id), false);
function candidatesOf(L) {
  if (L.site) return { all: [L.site], why: "inside the callback" };
  if (!L.top) return { all: [], why: "module level, outside any declaration" };
  const all = [...(sitesReaching.get(L.top) ?? [])];
  if (appUncached.has(L.top) || !all.length) all.push(`uncached:${L.top}`);
  return { all, why: `in ${declById.get(L.top)?.name}, reached through the call graph` };
}
const occ = new Map(); // sql -> {count, reqIdx:Set}
reqs.forEach((l, idx) => (l.sql ?? []).forEach((q) => { const o = occ.get(q) ?? { count: 0, reqIdx: new Set() }; o.count++; o.reqIdx.add(idx); occ.set(q, o); }));
const display = (c) => {
  if (c.startsWith("site:")) return siteById.get(c).display;
  if (c.startsWith("uncached:")) return `uncached: ${declById.get(c.slice(9))?.name}`;
  return c;
};
const statements = [];
for (const [q, o] of occ) {
  const full = literals.filter((L) => L.full.test(q));
  let best = full.map((L) => ({ L, kind: "full", score: L.fixed }));
  if (!best.length) best = literals.filter((L) => L.pieces.length && L.pieces.every((p) => q.toLowerCase().includes(p.toLowerCase()))).map((L) => ({ L, kind: "part", score: L.pieces.join("").replace(/\s+/g, "").length }));
  best.sort((a, b) => b.score - a.score);
  const top = best.filter((b) => b.score === best[0]?.score);
  const all = new Set();
  for (const b of top) for (const c of candidatesOf(b.L).all) all.add(c);
  // On the route: a cached reader the route reaches; an uncached helper the route reaches
  // with no cache between (routeUncached).
  const onRoute = [...all].filter((c) => (c.startsWith("site:") ? routeAll.has(c) : c.startsWith("uncached:") ? routeUncached.has(c.slice(9)) : false));
  let status = !top.length ? "unmatched" : all.size === 1 && onRoute.length === 1 ? "single" : onRoute.length === 1 ? "route-resolved" : onRoute.length > 1 ? "ambiguous" : "unreached";
  let readers = onRoute.length ? onRoute : [...all];
  let resolvedBy = null;
  if (status === "ambiguous") {
    const r = resolutions.find((x) => x.re.test(q));
    if (r) {
      const hit = onRoute.find((c) => display(c) === r.reader || (c.startsWith("site:") && siteById.get(c).declName === r.reader));
      if (!hit) throw new Error(`--resolve ${r.spec}: ${r.reader} is not an on-route candidate of: ${q.slice(0, 120)} (candidates: ${onRoute.map(display).join(" | ")})`);
      r.used++;
      readers = [hit];
      status = "code-resolved";
      resolvedBy = r.spec;
    }
  }
  statements.push({
    sql: q, count: o.count, requests: o.reqIdx.size, reqIdx: [...o.reqIdx], match: top.length ? top[0].kind : "none", score: top[0]?.score ?? 0,
    sources: top.map((b) => ({ at: `${b.L.file}:${b.L.line}`, fn: b.L.fn, callback: b.L.site ? siteById.get(b.L.site).display : null, inlined: b.L.inlined })),
    candidatesAll: [...all].map(display), candidatesOnRoute: onRoute.map(display), status, resolvedBy,
    key: status === "unmatched" ? "(unattributed)" : readers.length === 1 ? readers[0] : `AMBIGUOUS{${readers.map(display).join(" | ")}}`,
    evidence: onRoute.map((c) => `${display(c)}: ${c.startsWith("site:") ? pathTo(routeAll, c) : pathTo(routeUncached, c.slice(9))}`),
  });
}
for (const r of resolutions) if (!r.used) console.log(`note: --resolve ${r.spec} matched no ambiguous statement`);

// ---- tables --------------------------------------------------------------------------------
const migrate = fs.existsSync(path.join(ROOT, "scripts/migrate.ts")) ? fs.readFileSync(path.join(ROOT, "scripts/migrate.ts"), "utf8") : "";
const KNOWN = new Set([...migrate.matchAll(/CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()));
const tablesOf = (q) => [...new Set([...q.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()).filter((t) => KNOWN.has(t)))];

// ---- rows ----------------------------------------------------------------------------------
const stmtByKey = new Map();
for (const s of statements) { if (!stmtByKey.has(s.key)) stmtByKey.set(s.key, []); stmtByKey.get(s.key).push(s); }
const keyOfStmt = new Map(statements.map((s) => [s.sql, s.key]));
const reqKey = reqs.map((r) => {
  const ks = [...new Set((r.sql ?? []).map((q) => keyOfStmt.get(q)))];
  return ks.length === 1 ? ks[0] : `MIXED{${ks.map((k) => display(k)).join(" + ")}}`;
});
const rows = [];
const allKeys = new Set([...stmtByKey.keys(), ...reqKey]);
for (const k of allKeys) {
  const ss = stmtByKey.get(k) ?? [];
  const idx = reqKey.map((rk, i) => (rk === k ? i : -1)).filter((i) => i >= 0);
  const site = k.startsWith("site:") ? siteById.get(k) : null;
  const rq = idx.map((i) => reqs[i]);
  rows.push({
    key: k, reader: display(k), site: site ? `${site.file}:${site.line}` : k.startsWith("uncached:") ? `${declById.get(k.slice(9))?.file}:${declById.get(k.slice(9))?.line}` : "-",
    statements: ss.reduce((a, s) => a + s.count, 0), distinct: ss.length, counts: ss.map((s) => s.count).sort((a, b) => a - b),
    callsDerived: ss.length ? Math.min(...ss.map((s) => s.count)) : 0, storeRequests: idx.length,
    revalidate: site ? site.revalidate : k.startsWith("uncached:") ? "(uncached)" : "-", tags: site ? site.tags : "-", keyParts: site ? site.keyText : "-",
    tables: [...new Set(ss.flatMap((s) => tablesOf(s.sql)))].sort(),
    firstStart: rq.length ? Math.min(...rq.map((r) => r.rel0)) : null, lastEnd: rq.length ? Math.max(...rq.map((r) => r.rel1)) : null,
    storeMs: rq.reduce((a, r) => a + (r.ms ?? 0), 0),
  });
}
rows.sort((a, b) => b.statements - a.statements || a.reader.localeCompare(b.reader));

// ---- timeline and chains -------------------------------------------------------------------
const TOL = 5;
// From request `start` (default: the one that ends last), walk back to the request that
// ended latest at or before the current one's start, within `tol` ms (Infinity: no bound;
// each gap over TOL is then named). Ties on the end go to the earliest start.
function chainOf(idxs, tol = TOL, start = null) {
  if (!idxs.length) return { links: [], stop: null, storeMs: 0, gaps: [] };
  let cur = start ?? idxs.reduce((a, b) => (reqs[b].rel1 > reqs[a].rel1 ? b : a));
  const links = [cur];
  const gaps = [];
  let stop = null;
  for (;;) {
    const c0 = reqs[cur].rel0;
    const cands = idxs.filter((i) => !links.includes(i) && reqs[i].rel1 <= c0 && reqs[i].rel1 >= c0 - tol);
    if (!cands.length) {
      const before = idxs.filter((i) => reqs[i].rel1 <= c0 && !links.includes(i));
      const prev = before.length ? before.reduce((a, b) => (reqs[b].rel1 > reqs[a].rel1 ? b : a)) : null;
      stop = { at: c0, prevEnd: prev === null ? null : reqs[prev].rel1, gap: prev === null ? c0 : c0 - reqs[prev].rel1, prevReader: prev === null ? null : display(reqKey[prev]) };
      break;
    }
    const bestEnd = Math.max(...cands.map((i) => reqs[i].rel1));
    const ties = cands.filter((i) => reqs[i].rel1 === bestEnd).sort((a, b) => reqs[a].rel0 - reqs[b].rel0);
    if (c0 - bestEnd > TOL) gaps.push({ from: bestEnd, to: c0, ms: c0 - bestEnd, before: display(reqKey[ties[0]]), after: display(reqKey[cur]) });
    cur = ties[0];
    links.push(cur);
  }
  links.reverse();
  gaps.reverse();
  const out = links.map((i) => ({ idx: i, reader: display(reqKey[i]), rel0: reqs[i].rel0, rel1: reqs[i].rel1, ms: reqs[i].ms, n: reqs[i].n }));
  return { links: out, stop, storeMs: out.reduce((a, l) => a + l.ms, 0), gaps, gapMs: gaps.reduce((a, g) => a + g.ms, 0) };
}
// The longest chain the 5 ms walk finds from any request (by store time, then links).
function longestStrict(idxs) {
  let best = null;
  for (const i of idxs) {
    const c = chainOf(idxs, TOL, i);
    if (!best || c.storeMs > best.storeMs || (c.storeMs === best.storeMs && c.links.length > best.links.length)) best = c;
  }
  return best ?? { links: [], stop: null, storeMs: 0, gaps: [] };
}
const allIdx = reqs.map((_, i) => i);
const mainChain = chainOf(allIdx);
const mainLongest = longestStrict(allIdx);
const mainOpen = chainOf(allIdx, Infinity);
const groupOut = groups.map((g) => {
  const want = new Set(g.readers);
  const idxs = allIdx.filter((i) => {
    const k = reqKey[i];
    const base = k.startsWith("site:") ? siteById.get(k).declName : k.startsWith("uncached:") ? declById.get(k.slice(9))?.name : display(k);
    return want.has(base) || want.has(display(k));
  });
  const first = idxs.length ? Math.min(...idxs.map((i) => reqs[i].rel0)) : null;
  const last = idxs.length ? Math.max(...idxs.map((i) => reqs[i].rel1)) : null;
  const strict = chainOf(idxs);
  const open = chainOf(idxs, Infinity);
  return {
    name: g.name, readers: g.readers, requests: idxs.length, statements: idxs.reduce((a, i) => a + reqs[i].n, 0),
    firstStart: first, lastEnd: last, wall: first === null ? null : last - first, storeMsAll: idxs.reduce((a, i) => a + reqs[i].ms, 0),
    chain: strict, longest: longestStrict(idxs), open,
  };
});

// ---- tag expiry ----------------------------------------------------------------------------
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const schedule = new Map((vercel.crons ?? []).map((c) => [c.path, c.schedule]));
const routeOfFile = (f) => { const m = /^app\/(api\/.+)\/route\.ts$/.exec(f); return m ? `/${m[1]}` : null; };
const routeDecls = [...declById.values()].filter((d) => routeOfFile(d.file) && ["GET", "POST", "PUT", "DELETE"].includes(d.name));
function whoRuns(e) {
  const r = routeOfFile(e.file);
  if (r) return [`${r} (${schedule.has(r) ? `cron ${schedule.get(r)}` : "no cron entry"})`];
  if (e.file.startsWith("scripts/")) return [`script ${e.file} (by hand)`];
  const out = [];
  for (const rd of routeDecls) {
    const p = bfs([rd.id], true);
    if (e.top && p.has(e.top)) { const rr = routeOfFile(rd.file); out.push(`${rr} (${schedule.has(rr) ? `cron ${schedule.get(rr)}` : "no cron entry"})`); }
  }
  for (const d of declById.values()) if (d.file.startsWith("scripts/") && e.top && (edges.get(d.id)?.has(e.top))) out.push(`script ${d.file} (by hand)`);
  return [...new Set(out)];
}
const expiryOut = expiries.filter((e) => !e.file.startsWith("scripts/diagnostic/")).map((e) => ({ ...e, runs: whoRuns(e) }));
// /api/revalidate's allowed tags: the string literals in its ALLOWED_TAGS initializer.
const allowed = new Set();
const rv = F.get("app/api/revalidate/route.ts")?.decls.get("ALLOWED_TAGS");
if (rv?.node.initializer) (function lit(n) { if (ts.isStringLiteral(n)) allowed.add(n.text); ts.forEachChild(n, lit); })(rv.node.initializer);
const tagsOfText = (t) => [...String(t).matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
const routeTags = [...new Set(rows.flatMap((r) => tagsOfText(r.tags)))].sort();
const byTag = routeTags.map((tag) => ({
  tag,
  calls: expiryOut.filter((e) => e.tag === tag).map((e) => `${e.file}:${e.line} (${e.callee}) ← ${e.runs.join("; ") || "-"}`),
  revalidateRoute: allowed.has(tag),
  scripts: revalidatePosts.filter((p) => p.tag === tag).map((p) => `${p.file}:${p.line} (${p.how})`),
  readers: rows.filter((r) => tagsOfText(r.tags).includes(tag)).map((r) => r.reader),
}));

// ---- write ---------------------------------------------------------------------------------
const totals = {
  route, entryFiles: entryFiles.filter((f) => F.has(f)), storeRequests: reqs.length, statements: reqs.reduce((a, l) => a + (l.n ?? 0), 0), distinctStatements: occ.size,
  matchedFull: statements.filter((s) => s.match === "full").length, matchedPart: statements.filter((s) => s.match === "part").length,
  unmatched: statements.filter((s) => s.status === "unmatched").length, single: statements.filter((s) => s.status === "single").length,
  routeResolved: statements.filter((s) => s.status === "route-resolved").length, codeResolved: statements.filter((s) => s.status === "code-resolved").length,
  ambiguous: statements.filter((s) => s.status === "ambiguous").length, unreached: statements.filter((s) => s.status === "unreached").length,
  literalsIndexed: literals.length, cacheSites: sites.length, filesParsed: F.size,
  sumRowStatements: rows.reduce((a, r) => a + r.statements, 0), sumRowRequests: rows.reduce((a, r) => a + r.storeRequests, 0),
};
const siteList = sites.map((s) => ({ id: s.id, display: s.display, declName: s.declName, keyFirst: s.keyFirst, keyText: s.keyText, revalidate: s.revalidate, tags: s.tags, onRoute: routeAll.has(s.id), nestedReaders: [...reachOf(s.id).nested].map((n) => siteById.get(n).display) }));
const requestsOut = reqs.map((r, i) => ({ i, rel0: r.rel0, rel1: r.rel1, ms: r.ms, n: r.n, reader: display(reqKey[i]), key: reqKey[i] }));
fs.writeFileSync(outPrefix + ".json", JSON.stringify({ totals, resolutions: resolutions.map((r) => ({ spec: r.spec, used: r.used })), rows, statements, requests: requestsOut, chain: mainChain, longestStrictChain: mainLongest, openChain: mainOpen, groups: groupOut, sites: siteList, expiries: expiryOut, revalidatePosts, revalidateAllowedTags: [...allowed], byTag }, null, 2));

const T = [];
T.push(`attribution of ${rel(path.resolve(logPath))}`);
T.push(JSON.stringify(totals));
T.push(`entries for ${route}: ${entries.map(nameOf).join("; ")}`);
T.push("");
T.push("| reader | statements | distinct | counts per distinct statement | calls (min count) | store requests | revalidate | tags | site | first start | last end | store ms | tables |");
T.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) T.push(`| ${r.reader} | ${r.statements} | ${r.distinct} | ${r.counts.join(",")} | ${r.callsDerived} | ${r.storeRequests} | ${r.revalidate} | ${r.tags} | ${r.site} | ${r.firstStart} | ${r.lastEnd} | ${r.storeMs} | ${r.tables.join(", ")} |`);
T.push(`| **sum** | ${totals.sumRowStatements} | | | | ${totals.sumRowRequests} | | | | | | | |`);
T.push("");
T.push(`statements (${statements.length} distinct):`);
for (const s of [...statements].sort((a, b) => a.key.localeCompare(b.key) || b.count - a.count)) {
  T.push(`- ${s.count} × [${s.status}${s.match !== "none" ? `, ${s.match} ${s.score}` : ""}] ${display(s.key)} :: ${s.sql.slice(0, 140)}`);
  for (const src of s.sources) T.push(`    source ${src.at} in ${src.fn}${src.callback ? `, inside ${src.callback}'s callback` : ""}${src.inlined.length ? `; inlined ${src.inlined.join(", ")}` : ""}`);
  if (s.status !== "single") T.push(`    candidates (all): ${s.candidatesAll.join(" | ") || "-"}; on route: ${s.candidatesOnRoute.join(" | ") || "-"}${s.resolvedBy ? `; resolved by --resolve '${s.resolvedBy}'` : ""}`);
  for (const e of s.evidence) T.push(`    path: ${e}`);
}
T.push("");
T.push(`unmatched (${totals.unmatched}):`);
for (const s of statements.filter((x) => x.status === "unmatched")) T.push(`  ${s.count} × ${s.sql}`);
T.push("");
T.push("more than one reader reaches it (all candidates; how each was settled):");
for (const s of statements.filter((x) => x.candidatesAll.length > 1)) T.push(`  ${s.count} × [${s.status}] ${s.sql.slice(0, 110)} → all: ${s.candidatesAll.join(" | ")}; on route: ${s.candidatesOnRoute.join(" | ")}${s.status === "code-resolved" || s.status === "route-resolved" ? ` ⇒ ${display(s.key)}` : ""}`);
T.push("");
T.push("still ambiguous (more than one reader on the route, no --resolve):");
for (const s of statements.filter((x) => x.status === "ambiguous")) T.push(`  ${s.count} × ${s.sql.slice(0, 120)} → ${s.candidatesOnRoute.join(" | ")}`);
T.push("");
T.push("unreached (no candidate reachable from the route; all listed):");
for (const s of statements.filter((x) => x.status === "unreached")) T.push(`  ${s.count} × ${s.sql.slice(0, 120)} → ${s.candidatesAll.join(" | ")}`);
T.push("");
T.push("timeline (each reader's first start and last end, ms from the page request's start):");
for (const r of [...rows].sort((a, b) => a.firstStart - b.firstStart)) T.push(`  ${String(r.firstStart).padStart(5)} – ${String(r.lastEnd).padStart(5)}  ${r.reader} (${r.storeRequests} req, ${r.statements} stmts)`);
T.push("");
const showChain = (c) => {
  const gapAt = new Map((c.gaps ?? []).map((g) => [g.to, g]));
  for (const l of c.links) {
    const g = gapAt.get(l.rel0);
    if (g) T.push(`      (off the store ${g.ms} ms: ${g.from}–${g.to})`);
    T.push(`    ${l.reader}  ${l.rel0}–${l.rel1}  ${l.ms} ms${l.n > 1 ? ` (${l.n} stmts)` : ""}`);
  }
  if (c.stop && c.stop.prevEnd !== null) T.push(`    stops at ${c.stop.at} ms: the latest earlier end is ${c.stop.prevEnd}${c.stop.prevReader ? ` (${c.stop.prevReader})` : ""}, a gap of ${c.stop.gap} ms > ${TOL}`);
  else if (c.stop) T.push(`    stops at ${c.stop.at} ms: nothing ended before it (the first ${c.stop.at} ms are before any store request)`);
};
const chainHead = (label, c) => `${label}: ${c.links.length} round trips, store ${c.storeMs} ms${c.gaps?.length ? `, ${c.gaps.length} gaps over ${TOL} ms totalling ${c.gapMs} ms` : ""}${c.links.length ? `, ${c.links[0].rel0}–${c.links[c.links.length - 1].rel1}` : ""}`;
T.push(chainHead(`longest serial chain from the request that ends last (walk back within ${TOL} ms)`, mainChain));
showChain(mainChain);
T.push("");
T.push(chainHead(`the longest ${TOL} ms chain from any request`, mainLongest));
showChain(mainLongest);
T.push("");
T.push(chainHead("the same walk from the last request with no 5 ms bound (each gap named)", mainOpen));
showChain(mainOpen);
for (const g of groupOut) {
  T.push("");
  T.push(`group ${g.name} (${g.readers.join(", ")}): ${g.requests} req, ${g.statements} stmts; first start ${g.firstStart}, last end ${g.lastEnd}, wall ${g.wall} ms; store ms summed over all its requests ${g.storeMsAll}`);
  T.push(chainHead(`  chain from its last request within ${TOL} ms`, g.chain));
  showChain(g.chain);
  T.push(chainHead(`  longest ${TOL} ms chain inside it`, g.longest));
  showChain(g.longest);
  T.push(chainHead("  walk with no bound (gaps named)", g.open));
  showChain(g.open);
}
T.push("");
T.push("tag expiry calls (lib/, app/, scripts/ outside scripts/diagnostic/):");
for (const e of expiryOut) T.push(`  ${e.tag ?? `(${e.argText})`} ← ${e.callee}() at ${e.file}:${e.line} in ${e.fn ?? "-"}; runs from: ${e.runs.join("; ") || "-"}`);
T.push(`scripts that name /api/revalidate?tag=…, or POST REVALIDATE_URL with no tag (the route's default, ${REVALIDATE_DEFAULT ? `"${REVALIDATE_DEFAULT.tag}" at ${REVALIDATE_DEFAULT.at}` : "not found"}):`);
for (const p of revalidatePosts) T.push(`  ${p.tag} ← ${p.file}:${p.line}, ${p.how}`);
T.push(`/api/revalidate's allowed tags: ${[...allowed].join(", ")}`);
T.push("");
T.push(`by tag, for the tags this route's readers carry:`);
for (const b of byTag) {
  T.push(`  ${b.tag} (readers: ${b.readers.join(", ")})`);
  for (const c of b.calls) T.push(`    expire: ${c}`);
  T.push(`    POST /api/revalidate?tag=${b.tag}: ${b.revalidateRoute ? "allowed" : "NOT in the allowed list"}${b.scripts.length ? `; scripts: ${b.scripts.join("; ")}` : ""}`);
  if (!b.calls.length && !b.revalidateRoute) T.push("    no code expires it: entries age out at revalidate only");
}
fs.writeFileSync(outPrefix + ".txt", T.join("\n") + "\n");
console.log(T.slice(0, 3).join("\n"));
console.log(`rows ${rows.length}; sums ${totals.sumRowStatements} stmts / ${totals.sumRowRequests} req; single ${totals.single}, route-resolved ${totals.routeResolved}, code-resolved ${totals.codeResolved}, ambiguous ${totals.ambiguous}, unreached ${totals.unreached}, unmatched ${totals.unmatched}`);
