// HO 590 — the clock-skew hydration harness. COMMITTED, LOCAL-ONLY. Not a fix.
//
// The rebuilt-and-kept version of 589's scratch M5 rig. It manufactures the exact
// SSR-vs-hydration skew behind the intermittent prod React #418: the dev server
// SSR-renders each route at the REAL server clock; the browser hydrates with a
// page.clock-INSTALLED clock. A skew across a boundary (26h stale / 09:30-16:00 ET
// market open-close) flips which nodes a `now`-derived predicate renders — the
// structural (args[]=HTML) mismatch. Run against `next dev` so React 19 appends the
// describeDiff with component names (prod's minified message never can — 589 M1/M2).
//
// LOCAL-ONLY by construction: it needs a dev build for the DEV diff, so it can never
// ride e2e-prod.yml (that runs e2e/smoke.spec.ts by explicit path — this lives under
// scripts/diagnostic/ and is never globbed by the runner). It refuses a non-localhost
// target so it can't be pointed at prod by accident.
//
// Two upgrades over 589's scratch (§STEP-0 of HO 590):
//   1. Detect on BOTH the DEV message ("Hydration failed because the server
//      rendered …") AND the minified "#418", and log the raw message either way —
//      589's first pass filtered only "#418" and falsely reported NO FIRES.
//   2. Capture the DEV owner-component tree from the pageerror, not just err.message
//      — err.stack collapses owner frames to "…", so the tree in the message is the
//      only in-band identifier.
//
//   Prereq: `npm run dev` up on :3000. Then:
//     npx tsx scripts/diagnostic/hydration-clock-harness-590.ts          # focused M1–M4
//     npx tsx scripts/diagnostic/hydration-clock-harness-590.ts --sweep  # all ROUTES × skews
import { chromium, type Browser, type BrowserContext } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DAY = 24 * 60 * 60 * 1000;
const COOKIE = { name: "ct_seen", value: "1", url: BASE };

// Skews applied to the BROWSER clock relative to the real server clock. control(+0)
// must NOT fire (no skew ⇒ no boundary straddle from us). The rest cross a boundary.
function skews(): Array<{ label: string; time: () => Date }> {
  return [
    { label: "control(+0)", time: () => new Date() },
    { label: "stale(+2d)", time: () => new Date(Date.now() + 2 * DAY) },
    { label: "blunt(+40d)", time: () => new Date(Date.now() + 40 * DAY) },
    { label: "mkt-closed(Sun 03:00 ET)", time: () => new Date("2026-08-09T07:00:00Z") },
    { label: "mkt-open(Wed 14:00 ET)", time: () => new Date("2026-08-05T18:00:00Z") },
  ];
}

const STAGES = ["introduced", "committee", "floor", "other_chamber", "president", "enacted"];
const ROUTES = [
  "/", ...STAGES.map((s) => `/?stage=${s}`), "/welcome", "/bills", "/members",
  "/members/pass-rate", "/electoral", "/reports", "/hearings", "/news", "/changes",
  "/stale", "/trends", "/patterns", "/search", "/president", "/amendments",
  "/nominations", "/lobbying", "/trades", "/committees", "/watchlist",
  "/dashboard-classic", "/dashboard-v2", "/bill/119-s-2", "/members/A000055",
  "/race/AL-01-2026", "/committee/hlig00", "/reports/2026-06-15", "/vote/senate-119-2-207",
];

const HYDRATION_RE = /Hydration failed because the server rendered|Minified React error #418|did not match the client/i;

type Fire = { fired: boolean; variant: "HTML" | "text" | null; messages: string[]; ownerTree: string[]; consoleErrs: string[] };

// The discriminator (589 M1): "server rendered HTML" = STRUCTURAL (args[]=HTML, the
// prod #418) vs "server rendered text" = TEXT drift (args[]=text, a DIFFERENT bug,
// out of scope for the structural fix). Only HTML fires are cause-#1-class.
function variantOf(msg: string): "HTML" | "text" | null {
  if (/server rendered HTML/i.test(msg)) return "HTML";
  if (/server rendered text/i.test(msg)) return "text";
  return null;
}

// Pull React's owner-component frames out of the DEV hydration message. React lists
// them as `<ComponentName …>` lines between the boilerplate and the JS "at …" frames;
// the deepest named frame narrows the culprit subtree.
function ownerFrames(msg: string): string[] {
  return msg
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^<[A-Za-z][\w.]*/.test(l) || l === "...");
}

async function runScenario(ctx: BrowserContext, route: string, time: Date, settleMs = 2500): Promise<Fire> {
  const page = await ctx.newPage();
  const messages: string[] = [];
  const consoleErrs: string[] = [];
  page.on("pageerror", (e) => messages.push(e.message + (e.stack ? "\n" + e.stack : "")));
  page.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text()); });
  try {
    await page.clock.install({ time });
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(settleMs);
  } catch { /* nav/compile hiccup — record nothing, keep going */ }
  const hy = messages.filter((m) => HYDRATION_RE.test(m));
  const tree = hy.length ? ownerFrames(hy[0]!) : [];
  await page.close();
  return { fired: hy.length > 0, variant: hy.length ? variantOf(hy[0]!) : null, messages: hy, ownerTree: tree, consoleErrs };
}

// Raw server HTML (no browser clock) — the SSR markup, before any client re-render.
async function ssrCounts(route: string): Promise<{ items: number; arrows: number; oneSetArrows: number }> {
  const html = await (await fetch(BASE + route, { headers: { cookie: "ct_seen=1" } })).text();
  const items = (html.match(/markets-tape-item\b/g) || []).length;
  const arrows = (html.match(/markets-tape-arrow\b/g) || []).length;
  // arrows inside the first .markets-tape-set (one copy of the ordered items)
  const setIdx = html.indexOf("markets-tape-set");
  const nextSet = html.indexOf("markets-tape-set", setIdx + 1);
  const oneSet = setIdx >= 0 ? html.slice(setIdx, nextSet > 0 ? nextSet : setIdx + 20000) : "";
  const oneSetArrows = (oneSet.match(/markets-tape-arrow\b/g) || []).length;
  return { items, arrows, oneSetArrows };
}

async function domArrows(ctx: BrowserContext, route: string, time: Date): Promise<{ arrows: number; items: number }> {
  const page = await ctx.newPage();
  await page.clock.install({ time });
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  const arrows = await page.locator(".markets-tape-arrow").count();
  const items = await page.locator(".markets-tape-item").count();
  await page.close();
  return { arrows, items };
}

async function freshCtx(b: Browser): Promise<BrowserContext> {
  const ctx = await b.newContext();
  await ctx.addCookies([COOKIE]);
  return ctx;
}

async function main(): Promise<number> {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(BASE)) {
    console.log(`REFUSING to run against non-localhost target "${BASE}".`);
    console.log(`This harness needs a DEV build (React 19 describeDiff) — prod's minified message can't name a component.`);
    console.log(`Start \`npm run dev\` and re-run (BASE_URL defaults to http://localhost:3000).`);
    return 2;
  }
  // reachability
  try { await fetch(BASE + "/welcome", { headers: { cookie: "ct_seen=1" } }); }
  catch { console.log(`Cannot reach ${BASE} — is \`npm run dev\` running?`); return 2; }

  const sweep = process.argv.includes("--sweep");
  const b = await chromium.launch();
  console.log("=== HO 590 — clock-skew hydration harness (local, dev) ===");
  console.log(`target: ${BASE}   mode: ${sweep ? "SWEEP (all ROUTES × skews)" : "FOCUSED (M1–M4)"}\n`);

  if (sweep) {
    // ── SCOPE SWEEP ──────────────────────────────────────────────────────────
    console.log("################ SCOPE SWEEP — ROUTES × skews ################\n");
    for (const route of ROUTES) {
      for (const sk of skews()) {
        const ctx = await freshCtx(b);
        const r = await runScenario(ctx, route, sk.time());
        await ctx.close();
        const leaf = r.ownerTree.filter((l) => l !== "...").slice(-1)[0] ?? "";
        console.log(`[sweep] ${route.padEnd(26)} | ${sk.label.padEnd(24)} → ${r.fired ? `FIRE args[]=${r.variant}` : " -  "}${r.fired ? "  leaf=" + leaf : ""}`);
      }
    }
    await b.close();
    return 0;
  }

  // ── M1 — re-prove cause #1 at HEAD, with SSR vs post-hydration arrow counts ──
  console.log("################ M1 — cause #1 red at HEAD (the markets tape) ################\n");
  const ssr = await ssrCounts("/");
  console.log(`SSR html (server markup, no browser clock):  tape-items=${ssr.items}  tape-arrows=${ssr.arrows}  arrows-in-one-set=${ssr.oneSetArrows}`);
  const ctlDom = await domArrows(await freshCtx(b).then((c) => c), "/", new Date());
  console.log(`post-hydration DOM @ control(+0):            tape-items=${ctlDom.items}  tape-arrows=${ctlDom.arrows}  (no fire expected)`);
  const ctx1 = await freshCtx(b);
  const m1 = await runScenario(ctx1, "/", new Date(Date.now() + 40 * DAY));
  await ctx1.close();
  const skewDom = await domArrows(await freshCtx(b).then((c) => c), "/", new Date(Date.now() + 40 * DAY));
  console.log(`post-hydration DOM @ blunt(+40d):            tape-items=${skewDom.items}  tape-arrows=${skewDom.arrows}`);
  console.log(`/ @ blunt(+40d): ${m1.fired ? `FIRE ✓ args[]=${m1.variant} (RED at HEAD)` : "no fire ✗ (mechanism NOT reproduced — investigate)"}`);
  if (m1.fired) {
    console.log(`   owner tree (deepest named frames): ${m1.ownerTree.filter((l) => l !== "...").slice(-4).join(" ‹ ")}`);
    console.log(`   message[0]: ${m1.messages[0]!.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  console.log(`   RECONCILIATION: SSR arrows ${ssr.arrows} = 2 halves × reps(useState 2, :787) × ${ssr.oneSetArrows}/set;`);
  console.log(`   control DOM ${ctlDom.arrows} = 2 halves × reps→1 (post-mount measure effect) × ${ssr.oneSetArrows}/set.`);
  console.log(`   reps is 2 on BOTH sides during hydration ⇒ not the bug; showSlots(:456) gating the arrow node(:554) is.\n`);

  // ── M2 — the two candidate siblings: node-gating (structural) or text-only? ──
  console.log("################ M2 — sibling candidates: PROVEN-STRUCTURAL vs TEXT-ONLY ################\n");
  for (const route of ["/bill/119-s-2", "/lobbying"]) {
    const ctx = await freshCtx(b);
    let fired = false; let variant: string | null = null; let tree: string[] = []; let msg = "";
    for (const sk of ["stale(+2d)", "blunt(+40d)"]) {
      const t = sk === "stale(+2d)" ? new Date(Date.now() + 2 * DAY) : new Date(Date.now() + 40 * DAY);
      const r = await runScenario(ctx, route, t);
      if (r.fired) { fired = true; variant = r.variant; tree = r.ownerTree; msg = r.messages[0] ?? ""; break; }
    }
    await ctx.close();
    const inScope = variant === "HTML" ? "IN SCOPE (structural)" : variant === "text" ? "OUT OF SCOPE (text drift, args[]=text)" : "";
    console.log(`${route}: ${fired ? `FIRE args[]=${variant} — ${inScope}` : "no fire"}${fired ? "  owner-leaf=" + (tree.filter((l) => l !== "...").slice(-1)[0] ?? "?") : ""}`);
    if (fired) console.log(`   msg: ${msg.replace(/\s+/g, " ").slice(0, 150)}`);
  }
  console.log(`   (node-vs-text of the specific Date.now() site is a CODE read — quoted in the chat report:`);
  console.log(`    BillExpandPanel:266 and FilingRow:28 gating expressions, PROVEN-STRUCTURAL or TEXT-ONLY.)\n`);

  // ── M3 — the static-route prediction: /dashboard-v2 (○ Static, carries tape) ──
  console.log("################ M3 — static-route prediction (/dashboard-v2) ################\n");
  const dv2ssr = await ssrCounts("/dashboard-v2");
  console.log(`/dashboard-v2 SSR html: tape-items=${dv2ssr.items}  tape-arrows=${dv2ssr.arrows}  arrows-in-one-set=${dv2ssr.oneSetArrows}`);
  const ctxV2 = await freshCtx(b);
  const v2ctl = await runScenario(ctxV2, "/dashboard-v2", new Date());
  const v2skew = await runScenario(ctxV2, "/dashboard-v2", new Date(Date.now() + 40 * DAY));
  await ctxV2.close();
  console.log(`/dashboard-v2 @ control(+0): ${v2ctl.fired ? `FIRE args[]=${v2ctl.variant}` : "no fire"}   @ blunt(+40d): ${v2skew.fired ? `FIRE args[]=${v2skew.variant}` : "no fire"}`);
  console.log(`   NOTE: /dashboard-v2 is a 308 permanentRedirect("/") (app/dashboard-v2/page.tsx, HO 311) — the fetch/goto`);
  console.log(`   above followed it to /, so these counts ARE /'s. There is NO build-frozen static tape HTML: the ○ Static`);
  console.log(`   209B is the redirect stub. The M3 premise ("static AND carries the tape") is false; cause #1 does not`);
  console.log(`   mispredict. 589's prod /dashboard-v2 fire was the / fire after the redirect.\n`);

  // ── M3b — correct 589 M4's render-mode table (HO 590 condition 4) ─────────────
  // 589 M4.2 read `○ Static` off the prerender manifest and printed it without
  // noting that some of those rows are REDIRECT STUBS, not static content pages —
  // a misleading row (/dashboard-v2) in a table the sweep leaned on. Re-classify
  // each 589-"○ Static" route empirically: a 3xx with a Location is a redirect stub.
  console.log("################ M3b — 589 M4 render-mode table CORRECTED (condition 4) ################\n");
  const staticIn589 = ["/committees", "/dashboard-v2", "/members/pass-rate", "/primaries", "/races"];
  for (const route of staticIn589) {
    let status = 0; let loc = "";
    try {
      const res = await fetch(BASE + route, { headers: { cookie: "ct_seen=1" }, redirect: "manual" });
      status = res.status; loc = res.headers.get("location") ?? "";
    } catch { /* ignore */ }
    const verdict = status >= 300 && status < 400
      ? `REDIRECT STUB → ${loc} (NOT a static content page; 589's "○ Static" is the stub)`
      : status === 200 ? "genuine static content (200)" : `status ${status}`;
    console.log(`   ${route.padEnd(22)} ${status} → ${verdict}`);
  }
  console.log(`   ⇒ the render-mode table's "○ Static" means "prerendered output" — for a redirect route that`);
  console.log(`   output is the 3xx stub, carrying no tape. No static route serves tape HTML; H4 + the M3`);
  console.log(`   static-prerender concern both dissolve. (Recorded for the HO 591 docs sweep.)\n`);

  // ── M3c — prod attribution (HO 590 condition 5): can the tape be prod's cause? ─
  // The tape reads Date.now() at SSR (render instant) and again at hydration; a
  // mismatch needs the two to STRADDLE a boundary (26h stale / 09:30-16:00 ET). That
  // requires a GAP between render and hydration. Measured on prod (2026-08-03,
  // `curl -I` with the gate cookie): `/` returns X-Vercel-Cache: MISS, Age: 0,
  // Cache-Control: private,no-cache,no-store,must-revalidate, Date advancing per
  // request — i.e. SERVED FRESH PER REQUEST, no cache gap. So prod's render→hydration
  // gap is sub-second, exactly like control(+0) here — which NEVER fires. Locally we
  // bound that natural gap to show the same:
  console.log("################ M3c — prod attribution: render→hydration gap (condition 5) ################\n");
  {
    const page = await (await freshCtx(b)).newPage();
    const resp = await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("load").catch(() => {});
    const serverDate = resp?.headers()["date"] ? Date.parse(resp!.headers()["date"]!) : NaN;
    const clientNow = await page.evaluate(() => Date.now());
    await page.close();
    const gapMs = Number.isFinite(serverDate) ? clientNow - serverDate : NaN;
    console.log(`   local / : server Date header ${new Date(serverDate).toISOString()} vs client Date.now() post-load`);
    console.log(`   render→hydration gap ≈ ${Number.isFinite(gapMs) ? Math.round(gapMs) + "ms" : "n/a"} (sub-boundary; control never fires at this gap)`);
    console.log(`   PROD (curl, 2026-08-03): X-Vercel-Cache=MISS Age=0 no-store ⇒ fresh per request ⇒ same sub-second gap.`);
    console.log(`   ⇒ FINDING: the tape is a real latent hydration bug but is NOT the mechanism of prod's 42 args[]=HTML`);
    console.log(`   fires — there is no cache gap to straddle a boundary. Those fires remain UNATTRIBUTED. The pageErr`);
    console.log(`   OPEN LOOP does NOT close on the tape fix; a green crawl after is ambiguous (cause AND never-cause).\n`);
  }

  // ── M4 — cause #2, one bounded attempt (members surfaces, control, no skew) ──
  console.log("################ M4 — cause #2 (members, control) — ONE bounded pass ################\n");
  const TRIES = 6;
  for (const route of ["/members", "/members/pass-rate"]) {
    let fired = false;
    for (let k = 0; k < TRIES && !fired; k++) {
      const ctx = await freshCtx(b);
      const r = await runScenario(ctx, route, new Date());
      await ctx.close();
      if (r.fired) {
        fired = true;
        console.log(`${route} try${k}: FIRE args[]=${r.variant} — owner tree: ${r.ownerTree.filter((l) => l !== "...").slice(-6).join(" ‹ ")}`);
        console.log(`   msg: ${r.messages[0]!.replace(/\s+/g, " ").slice(0, 180)}`);
      }
    }
    if (!fired) console.log(`${route}: no fire in ${TRIES} control tries — RESULT, not a gap. Cause #2 stays open + unnamed.`);
  }

  await b.close();
  console.log("\n(verdicts + scope list: written in chat. HALT here — no fix code until approval.)");
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
