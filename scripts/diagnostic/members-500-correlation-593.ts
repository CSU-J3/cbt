// HO 593 STEP 0 — are the prod #418 fires and the intermittent /members 500 the
// same fault? COMMITTED, READ-ONLY. Not a fix.
//
// M1 (--m1 <logdir>) — the cross-tab, from data the crawl ALREADY logs. No
//   instrument change (scope guard 2). smoke.spec.ts logs one line per route per
//   run: "[slug] hit1=<status> ... pageErr=<n> | hit2=...", and on a non-clean route
//   a second line with the actual pageErr message (the HO 574 instrument). Feed it a
//   directory of extracted logs:
//     gh run list --workflow=e2e-prod.yml --limit 250 --json databaseId,conclusion,createdAt
//     for each id:  gh run view <id> --log | grep -E "\[[a-z0-9-]+\] hit1=|pageErr#[0-9]=" > <dir>/<id>.txt
//   NOTE: run `gh run view` SERIALLY. Six in parallel silently produced 110 empty
//   files here (auth-keyring contention on Windows) — an empty log reads exactly
//   like a clean run, which would have inverted the finding.
//
// M2 (default) — the trigger curve, against prod. 592 found the 500 load-correlated
//   incidentally (burst-of-20 on one route all-200; a 37-route sequential sweep
//   fired). This makes that deliberate: vary ONE dimension at a time.
//   BOUNDED BY CONSTRUCTION (scope guard 6): the measurement is itself the load that
//   causes the fault, so MAX_REQUESTS caps the whole run and every stage is small.
//
// The prediction under the read-volume reading: the 500 rate tracks DISTINCT CACHE
// KEYS touched, not request concurrency. Stage B (N concurrent, one key) is the
// control — after the first request populates the key, the rest are cache hits, so
// concurrency alone should stay clean.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";
const COOKIE = "ct_seen=1";
// Hard cap on prod requests for the whole M2 run. The fault is load-triggered; the
// probe must not become the outage it is measuring.
const MAX_REQUESTS = 120;
let spent = 0;

const STAGES = ["introduced", "committee", "floor", "other_chamber", "president", "enacted"];
const SWEEP_ROUTES = [
  "/", ...STAGES.map((s) => `/?stage=${s}`), "/welcome", "/bills", "/members",
  "/members/pass-rate", "/races", "/electoral", "/primaries", "/reports", "/hearings",
  "/news", "/changes", "/stale", "/trends", "/patterns", "/search", "/president",
  "/amendments", "/nominations", "/lobbying", "/trades", "/committees", "/watchlist",
  "/dashboard-classic", "/dashboard-v2", "/bill/119-s-2", "/members/A000055",
  "/race/AL-01-2026", "/committee/hlig00", "/reports/2026-06-15", "/vote/senate-119-2-207",
];

async function hit(p: string): Promise<number> {
  if (spent >= MAX_REQUESTS) return -1;
  spent++;
  try {
    const r = await fetch(BASE + p, { headers: { cookie: COOKIE }, redirect: "follow" });
    return r.status;
  } catch {
    return 0;
  }
}

function summarise(label: string, codes: number[]) {
  const dist: Record<string, number> = {};
  for (const c of codes) dist[c] = (dist[c] ?? 0) + 1;
  const n = codes.length;
  const bad = codes.filter((c) => c !== 200 && c !== -1).length;
  console.log(
    `  ${label.padEnd(46)} n=${String(n).padStart(3)}  500s=${String(bad).padStart(2)}  rate=${n ? ((bad / n) * 100).toFixed(0) : 0}%  ${JSON.stringify(dist)}`,
  );
}

// ---------------------------------------------------------------------------
// M1 — cross-tab over already-collected CI logs
// ---------------------------------------------------------------------------
type Cell = { run: string; route: string; hit: number; status: number; pageErr: number };

function m1(dir: string) {
  const cells: Cell[] = [];
  const msgs: Array<{ run: string; route: string; kind: string }> = [];
  let files = 0, empty = 0;

  for (const f of fs.readdirSync(dir)) {
    if (!/^\d+\.txt$/.test(f)) continue;
    const run = f.replace(".txt", "");
    const txt = fs.readFileSync(path.join(dir, f), "utf8");
    if (!txt.trim()) { empty++; continue; }
    files++;
    for (const line of txt.split("\n")) {
      const m =
        /\[([a-z0-9-]+)\] hit1=(\d+) failed=\d+ bad=(\d+) console=(\d+) pageErr=(\d+) \| hit2=(\d+) failed=\d+ bad=(\d+) console=(\d+) pageErr=(\d+)/.exec(line);
      if (m) {
        const route = m[1] ?? "?";
        cells.push({ run, route, hit: 1, status: Number(m[2]), pageErr: Number(m[5]) });
        cells.push({ run, route, hit: 2, status: Number(m[6]), pageErr: Number(m[9]) });
        continue;
      }
      const pm = /\[([a-z0-9-]+)\] pageErr#\d+=\[/.exec(line);
      if (pm) {
        const kind = /Minified React error #418/.test(line)
          ? "#418"
          : /Server Components render/.test(line)
            ? "SC-500"
            : "other";
        msgs.push({ run, route: pm[1] ?? "?", kind });
      }
    }
  }

  // A single site-wide outage run swamps every aggregate (216/216 cells 500) and is
  // its own event, not the intermittent. Detect it rather than hardcoding an id.
  const perRun: Record<string, { n: number; non200: number }> = {};
  for (const c of cells) {
    const e = (perRun[c.run] ||= { n: 0, non200: 0 });
    e.n++;
    if (c.status !== 200) e.non200++;
  }
  const outages = Object.entries(perRun)
    .filter(([, v]) => v.n > 10 && v.non200 / v.n > 0.9)
    .map(([r]) => r);

  console.log(`=== M1 — status × pageErr cross-tab ===`);
  console.log(`  runs with data: ${files}  (empty log files: ${empty})`);
  console.log(`  site-wide outage runs excluded: ${JSON.stringify(outages)}`);

  const keep = cells.filter((c) => !outages.includes(c.run));
  const keepMsg = msgs.filter((m) => !outages.includes(m.run));
  const non200 = keep.filter((c) => c.status !== 200);
  const err200 = keep.filter((c) => c.pageErr > 0 && c.status === 200);

  console.log(`  cells: ${keep.length}  non-200: ${non200.length}  pageErr-on-200: ${err200.length}`);

  const grp = (arr: Array<{ route: string; status?: number }>) => {
    const o: Record<string, number> = {};
    for (const c of arr) o[c.route] = (o[c.route] ?? 0) + 1;
    return Object.entries(o).sort((a, b) => b[1] - a[1]);
  };
  console.log(`\n  non-200 by route: ${JSON.stringify(grp(non200))}`);

  const byRoute: Record<string, { a: number; b: number }> = {};
  for (const m of keepMsg) {
    const e = (byRoute[m.route] ||= { a: 0, b: 0 });
    if (m.kind === "#418") e.a++;
    if (m.kind === "SC-500") e.b++;
  }
  console.log(`\n  message type by route (the discriminator):`);
  console.log(`    ${"route".padEnd(24)}${"#418".padStart(6)}${"SC-500".padStart(8)}`);
  let t418 = 0, tsc = 0;
  for (const [r, v] of Object.entries(byRoute).sort((x, y) => y[1].a + y[1].b - (x[1].a + x[1].b))) {
    t418 += v.a; tsc += v.b;
    console.log(`    ${r.padEnd(24)}${String(v.a).padStart(6)}${String(v.b).padStart(8)}`);
  }
  console.log(`    ${"TOTAL".padEnd(24)}${String(t418).padStart(6)}${String(tsc).padStart(8)}`);

  const both = Object.entries(byRoute).filter(([, v]) => v.a > 0 && v.b > 0).map(([r]) => r);
  console.log(`\n  routes carrying BOTH message types: ${JSON.stringify(both)}`);
  const only418 = Object.entries(byRoute).filter(([, v]) => v.a > 0 && v.b === 0).map(([r]) => r);
  console.log(`  routes with #418 and NEVER a 500:    ${JSON.stringify(only418)}`);
}

// ---------------------------------------------------------------------------
// M2 — trigger characterisation
// ---------------------------------------------------------------------------
async function m2() {
  console.log(`=== M2 — trigger curve (BASE=${BASE}, cap=${MAX_REQUESTS} requests) ===`);

  // A — the heaviest route alone, sequential. Does it self-trigger?
  const a: number[] = [];
  for (let i = 0; i < 20; i++) a.push(await hit("/members"));
  summarise("A: /members sequential ×20 (one cache key)", a.filter((c) => c !== -1));

  // B — concurrency control, one route. After the first populates the key the rest
  // are cache hits, so under the read-volume reading this stays clean.
  const b = (await Promise.all(Array.from({ length: 20 }, () => hit("/members")))).filter((c) => c !== -1);
  summarise("B: /members concurrent ×20 (one cache key)", b);

  // C — the sweep shape: N DISTINCT routes, sequential. Sweep N to find a knee.
  for (const n of [10, 20, SWEEP_ROUTES.length]) {
    const codes: number[] = [];
    for (const r of SWEEP_ROUTES.slice(0, n)) codes.push(await hit(r));
    summarise(`C: sequential sweep, ${n} distinct routes`, codes.filter((c) => c !== -1));
  }

  // D — concurrency AND key count together.
  const d = (await Promise.all(SWEEP_ROUTES.slice(0, 20).map((r) => hit(r)))).filter((c) => c !== -1);
  summarise("D: concurrent ×20, 20 distinct routes", d);

  console.log(`\n  requests spent: ${spent}/${MAX_REQUESTS}`);
}

async function main() {
  const i = process.argv.indexOf("--m1");
  if (i !== -1) { m1(process.argv[i + 1] ?? ""); return; }
  await m2();
}

main().catch((e) => { console.error(e); process.exit(1); });
