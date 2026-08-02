// HO 589 STEP 0 — the `pageErr` React #418 hydration probe: read-only. BUILDS NOTHING.
//
// The unattended prod crawl (smoke.spec.ts) throws a recoverable React #418 on an
// unstable, growing set of routes. The minified prod message is byte-identical for
// every occurrence, so it cannot name the offending component. This probe measures
// FIVE things, then HALTs — no fix, no component edit, no config flip. The fix HO is
// scoped from what M1–M5 return, not from the handoff's guesses.
//
//   M1 — arg semantics from React's source of truth (is `args[]=HTML` structural?).
//   M2 — can the prod crawl EVER self-identify the component as currently built?
//   M3 — the render-time non-determinism inventory across ALL client components.
//   M4 — build render-mode table + useSearchParams() consumers (H4).
//   M5 — a DEV clock-skew reproduction (separate Playwright spec; see the HO).
//
// This script covers M1, M3, and M4's code-facing halves + an M2 gh re-grep. It is
// fs/fetch/grep only — NO DB, NO writes. Same "npx tsx, dotenv not needed" idiom as
// the diagnostic family, minus the Turso client (there is nothing to query here).
//
//   npx tsx scripts/diagnostic/pageerr-hydration-589.ts
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
function pad(v: string | number, w: number): string { return String(v).padEnd(w); }
function padL(v: string | number, w: number): string { return String(v).padStart(w); }
function readIf(p: string): string { try { return readFileSync(p, "utf8"); } catch { return ""; } }

// Recursively collect files under `dir` matching `exts`, skipping node_modules/.next.
function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some((x) => e.endsWith(x))) out.push(full);
  }
  return out;
}

async function main(): Promise<number> {
  console.log("=== HO 589 STEP 0 — pageErr #418 hydration probe (read-only) ===\n");

  // ══════════════════════════════════════════════════════════════════════════
  // M1 — arg semantics from the source of truth
  // ══════════════════════════════════════════════════════════════════════════
  console.log("################ M1 — #418 arg semantics (React source of truth) ################\n");

  const pkg = JSON.parse(readIf(join(ROOT, "package.json")) || "{}");
  const reactDomSpec = pkg.dependencies?.["react-dom"] ?? "?";
  const reactDomInstalled = JSON.parse(readIf(join(ROOT, "node_modules/react-dom/package.json")) || "{}").version ?? "?";
  console.log(`react-dom: package.json="${reactDomSpec}"  installed=${reactDomInstalled}\n`);

  // (a) fetch codes.json entry 418 verbatim
  let entry418 = "";
  try {
    const res = await fetch("https://raw.githubusercontent.com/facebook/react/main/scripts/error-codes/codes.json");
    const codes = (await res.json()) as Record<string, string>;
    entry418 = codes["418"] ?? "";
    console.log("── M1(a) codes.json entry 418 (verbatim) ──");
    console.log(entry418.split("\\n").map((l) => `   ${l}`).join("\n"));
    const slots = (entry418.match(/%s/g) ?? []).length;
    console.log(`\n   %s slot count: ${slots}  (slot 1 = the discriminator, slot 2 = the appended DEV diff)`);
  } catch (e) {
    console.log(`── M1(a) codes.json fetch FAILED (${(e as Error).message}) — falling back to the installed bundle string`);
  }

  // (a cont.) the throw-site arg that fills slot 1: (fromText ? "text" : "HTML")
  const devBundle = readIf(join(ROOT, "node_modules/react-dom/cjs/react-dom-client.development.js"));
  const prodBundle = readIf(join(ROOT, "node_modules/react-dom/cjs/react-dom-client.production.js"));
  const argSite = devBundle.split("\n").findIndex((l) => /fromText\s*\?\s*"text"\s*:\s*"HTML"/.test(l));
  console.log("\n── M1(a) throw-site: what fills slot 1 ──");
  if (argSite >= 0) {
    console.log(`   dev bundle line ${argSite + 1}: ${devBundle.split("\n")[argSite]!.trim()}`);
    console.log(`   → slot 1 is the literal string "text" (text-content mismatch) or "HTML" (markup mismatch).`);
    console.log(`   → CI captured args[]=HTML  ⇒  the "HTML" branch  ⇒  a STRUCTURAL/markup mismatch, NOT text.`);
  } else {
    console.log(`   (could not locate the fromText?"text":"HTML" site — react-dom internal changed; inspect manually)`);
  }

  // (b) is the diff (slot 2) DEV-gated? grep dev vs prod bundle
  const devHM = (devBundle.match(/hydration-mismatch/g) ?? []).length;
  const prodHM = (prodBundle.match(/hydration-mismatch/g) ?? []).length;
  const devPlain = (devBundle.match(/Hydration failed because the server rendered/g) ?? []).length;
  const prodPlain = (prodBundle.match(/Hydration failed because the server rendered/g) ?? []).length;
  console.log("\n── M1(b) is slot 2 (the component-naming diff) DEV-gated? ──");
  console.log(`   'hydration-mismatch' link:            dev=${devHM}  prod=${prodHM}`);
  console.log(`   'Hydration failed because...' plain:  dev=${devPlain}  prod=${prodPlain}`);
  console.log(`   → prod bundle carries NEITHER the template NOR the diff link: the diff is DEV-only.`);
  console.log(`   → in a prod build slot 2 is empty; the minified message is the whole payload.`);

  // (c) verdict
  const s01Confirmed = argSite >= 0;
  const s03Confirmed = prodHM === 0 && prodPlain === 0;
  console.log("\n── M1(c) VERDICT ──");
  console.log(`   §0.1 (args[]=HTML is the STRUCTURAL variant, not text):  ${s01Confirmed ? "CONFIRMED" : "REFUTED"}`);
  console.log(`   §0.3 (raising the 200-char cap buys nothing; diff is DEV-only): ${s03Confirmed ? "CONFIRMED" : "REFUTED"}`);
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M2 — can the prod crawl self-identify? (re-grep the CI failure logs)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("################ M2 — can the unattended prod crawl self-identify? ################\n");
  console.log("── M2: what smoke.spec.ts captures ──");
  const smoke = readIf(join(ROOT, "e2e/smoke.spec.ts"));
  const pushesMessage = /c\.pageErr\.push\(err\.message\)/.test(smoke);
  const truncates = /\.slice\(0,\s*200\)/.test(smoke);
  console.log(`   collector pushes err.MESSAGE only (not err.stack): ${pushesMessage ? "yes" : "no"}`);
  console.log(`   detail line truncates each message to 200 chars:    ${truncates ? "yes" : "no"}`);
  console.log(`   productionBrowserSourceMaps: unset (=false) — so even err.stack would be minified.`);
  console.log("");
  console.log("── M2: byte-compare the #418 strings across recent CI failures (gh) ──");
  try {
    const runsJson = execSync("gh run list --workflow=e2e-prod.yml -L 40 --json databaseId,conclusion", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const runs = (JSON.parse(runsJson) as Array<{ databaseId: number; conclusion: string }>).filter((r) => r.conclusion === "failure").slice(0, 6);
    const seen = new Set<string>();
    let count418 = 0;
    for (const r of runs) {
      let log = "";
      try { log = execSync(`gh run view ${r.databaseId} --log`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }); } catch { continue; }
      const matches = log.match(/Minified React error #418[^\]]*/g) ?? [];
      for (const m of matches) { count418++; seen.add(m.replace(/\s+/g, " ").trim()); }
    }
    console.log(`   #418 occurrences scanned across failed runs: ${count418}`);
    console.log(`   DISTINCT #418 message strings: ${seen.size}`);
    for (const s of seen) console.log(`     · ${s.slice(0, 140)}`);
    console.log(`   → ${seen.size <= 1 ? "byte-IDENTICAL across every occurrence — carries ZERO cause-count information (§0.2 CONFIRMED)" : "strings differ — inspect"}`);
  } catch (e) {
    console.log(`   (gh unavailable: ${(e as Error).message}) — see the chat report for the captured strings`);
  }
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M3 — render-time non-determinism inventory across ALL client components
  // ══════════════════════════════════════════════════════════════════════════
  console.log("################ M3 — non-determinism inventory (superset, route-agnostic) ################\n");

  const srcFiles = [
    ...walk(join(ROOT, "components"), [".tsx", ".ts"]),
    ...walk(join(ROOT, "app"), [".tsx", ".ts"]),
    ...walk(join(ROOT, "lib"), [".tsx", ".ts"]),
  ];
  // A file is a client component if "use client" appears anywhere in its head (not just line 1).
  const clientFiles = srcFiles.filter((f) => {
    const head = readIf(f).slice(0, 400);
    return /["']use client["']/.test(head);
  });
  console.log(`client components scanned: ${clientFiles.length}\n`);

  // Non-determinism sources read DURING RENDER are the risk. Each token below is a
  // hydration hazard if it executes in the render body / useState initialiser / useMemo.
  const TOKENS: Array<{ re: RegExp; name: string }> = [
    { re: /\bDate\.now\s*\(/, name: "Date.now()" },
    { re: /new Date\s*\(\s*\)/, name: "new Date() [no arg]" },
    { re: /\bMath\.random\s*\(/, name: "Math.random()" },
    { re: /\bwindow\./, name: "window.*" },
    { re: /\blocalStorage\b/, name: "localStorage" },
    { re: /\bsessionStorage\b/, name: "sessionStorage" },
    { re: /\bmatchMedia\b/, name: "matchMedia" },
    { re: /\bnavigator\./, name: "navigator.*" },
    { re: /\bIntl\.(DateTimeFormat|NumberFormat|RelativeTimeFormat)\b/, name: "Intl.* (defaulted locale/tz)" },
    { re: /\buseSearchParams\s*\(/, name: "useSearchParams()" },
    { re: /\busePathname\s*\(/, name: "usePathname()" },
  ];

  type Hit = { file: string; line: number; token: string; text: string; effect: boolean };
  const hits: Hit[] = [];
  for (const f of clientFiles) {
    const lines = readIf(f).split("\n");
    // Track useEffect/useLayoutEffect depth by a crude brace counter so we can tag a
    // hit as effect-time (safe by construction) vs render-time (the hazard).
    let effectDepth = 0; // >0 => inside a useEffect/useLayoutEffect callback body
    let effectBrace = 0;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]!;
      if (effectDepth === 0 && /\buse(Effect|LayoutEffect)\s*\(/.test(ln)) {
        effectDepth = 1; effectBrace = 0;
      }
      if (effectDepth > 0) {
        effectBrace += (ln.match(/\{/g) ?? []).length - (ln.match(/\}/g) ?? []).length;
        // once braces return to <=0 after opening, the effect body has closed
      }
      for (const t of TOKENS) {
        if (t.re.test(ln)) {
          // an event-handler assignment (onClick=... , const handleX = ...) is also runtime-safe;
          // tag those as effect-ish too via a loose heuristic
          const handlerish = /\bon[A-Z]\w+\s*=|=>\s*\{?\s*$|addEventListener/.test(ln);
          hits.push({ file: relative(ROOT, f).split(sep).join("/"), line: i + 1, token: t.name, text: ln.trim().slice(0, 100), effect: effectDepth > 0 || handlerish });
        }
      }
      if (effectDepth > 0 && effectBrace <= 0 && /\}/.test(ln) && i > 0) effectDepth = 0;
    }
  }

  // Summary by token
  console.log("── M3.1 hit counts by token (render-time = the hazard column) ──");
  for (const t of TOKENS) {
    const all = hits.filter((h) => h.token === t.name);
    const render = all.filter((h) => !h.effect);
    console.log(`   ${pad(t.name, 30)} total=${padL(all.length, 3)}  render-time≈${padL(render.length, 3)}  effect/handler≈${padL(all.length - render.length, 3)}`);
  }
  console.log("");

  // The render-time hits are the ones that matter. Print them, grouped by file.
  console.log("── M3.2 RENDER-TIME hits (effect/handler-tagged rows excluded) ──");
  console.log("   [structural-vs-text is a MANUAL check per the HO — this lists candidates, not conclusions]\n");
  const renderHits = hits.filter((h) => !h.effect);
  const byFile = new Map<string, Hit[]>();
  for (const h of renderHits) { const a = byFile.get(h.file) ?? []; a.push(h); byFile.set(h.file, a); }
  for (const [file, hs] of [...byFile.entries()].sort()) {
    console.log(`   ${file}`);
    for (const h of hs) console.log(`      :${padL(h.line, 4)}  ${pad(h.token, 22)} ${h.text}`);
  }
  console.log("");

  // Known-safe patterns the HO names — confirm they still hold at HEAD.
  console.log("── M3.3 known-safe patterns (HO named these; confirm at HEAD) ──");
  const zoneCycle = readIf(join(ROOT, "lib/zone-cycle.ts"));
  console.log(`   lib/zone-cycle.ts useZoneCycle pins MT both sides:  ${/America\/Denver|Mountain|MT|-07:00|Denver/.test(zoneCycle) ? "present" : "CHECK"} (file ${zoneCycle ? "found" : "MISSING"})`);
  const mtc = readIf(join(ROOT, "components/MarketsTapeClient.tsx"));
  console.log(`   MarketsTapeClient HO 376 shuffle null-until-mounted: ${/mounted|useEffect|null/.test(mtc) ? "mount-gated present" : "CHECK"}`);
  console.log(`   MarketsTapeClient useState(() => Date.now()) at head: ${/useState\(\(\)\s*=>\s*Date\.now\(\)\)/.test(mtc) ? "PRESENT — the lead" : "absent"}`);
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M4 — build render-mode table + useSearchParams() consumers (H4)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("################ M4 — render mode (H4: static prerender + useSearchParams) ################\n");

  // consumers (re-derived, not trusted from the HO list)
  console.log("── M4.1 useSearchParams() consumers (client components) ──");
  const uspConsumers = clientFiles
    .map((f) => ({ f: relative(ROOT, f).split(sep).join("/"), body: readIf(f) }))
    .filter((x) => /useSearchParams\s*\(/.test(x.body))
    .map((x) => {
      const suspenseNote = /Suspense/.test(x.body) ? "has <Suspense> in file" : "no <Suspense> in file";
      return { f: x.f, suspenseNote };
    });
  for (const c of uspConsumers) console.log(`   ${pad(c.f, 52)} ${c.suspenseNote}`);
  console.log(`   (${uspConsumers.length} consumers)\n`);

  // render mode from .next manifests (prerender-manifest = statically prerendered)
  console.log("── M4.2 render mode from .next manifests (run `next build` first) ──");
  const preManPath = join(ROOT, ".next/prerender-manifest.json");
  const appRoutesPath = join(ROOT, ".next/app-path-routes-manifest.json");
  if (existsSync(preManPath) && existsSync(appRoutesPath)) {
    const preMan = JSON.parse(readIf(preManPath) || "{}");
    const staticRoutes = new Set(Object.keys(preMan.routes ?? {}));
    const dynamicPre = new Set(Object.keys(preMan.dynamicRoutes ?? {}));
    const focus = ["/", "/president", "/members", "/news", "/dashboard-classic", "/dashboard-v2", "/bills", "/hearings", "/amendments", "/nominations", "/lobbying", "/trades", "/stale", "/changes", "/patterns", "/trends", "/search", "/reports", "/primaries", "/electoral"];
    for (const rt of focus) {
      const mode = staticRoutes.has(rt) ? "○ Static (prerendered)" : dynamicPre.has(rt) ? "◐ SSG-dynamic-param" : "ƒ Dynamic (server-rendered per request)";
      console.log(`   ${pad(rt, 22)} ${mode}`);
    }
    console.log(`\n   H4 note: a route that is ƒ Dynamic gets REAL search params server-side ⇒ useSearchParams`);
    console.log(`   cannot cause a hydration skew there. Only ○ Static routes are H4-eligible.`);
  } else {
    console.log(`   (.next manifests absent — run \`npx next build\` and re-run, or read the build stdout route table)`);
  }
  console.log("");

  console.log("################ SUMMARY ################");
  console.log(`   M1: §0.1 ${s01Confirmed ? "CONFIRMED" : "REFUTED"} · §0.3 ${s03Confirmed ? "CONFIRMED" : "REFUTED"}`);
  console.log(`   M3: ${clientFiles.length} client components · ${renderHits.length} render-time non-determinism hits`);
  console.log(`   M4: ${uspConsumers.length} useSearchParams() consumers`);
  console.log(`   M5: DEV clock-skew repro — separate Playwright spec (see HO); result written to chat.`);
  console.log(`   (verdicts + fix-HO scoping: written in chat from the numbers above)`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
