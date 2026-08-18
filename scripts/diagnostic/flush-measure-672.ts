// HO 672 STEP 1 — the CAUSE series for the flush-guard prediction. READ-ONLY.
//
// HO 671 shipped `if (stats.ok > 0) revalidateTag("bills")` on /api/cron/summarize.
// The prediction: before the guard EVERY */10 tick flushed the bills tag (~144/day
// + /api/sync's 4 = ~148); after it, only WRITING ticks should (~2/day + sync's 4
// = ~6), with long flat stretches between.
//
// This reads half of that — the cause series. It does NOT read Turso rows-read;
// that metric is dashboard-only from this box (no turso CLI, no platform API
// token — SKILL "Platform facts", which records the same provenance limit).
//
// THE ENVELOPE TRAP (HO 669, cost HO 671 a read): cron_runs.payload is
//   { ok, elapsedMs, payload: { summarized, failed, ... } }
// so a naive `payload.summarized` reads undefined on EVERY row, which is
// indistinguishable from "this tick summarized zero" — the exact reading this
// script exists to make. Both depths are read, the raw first row is printed, and
// the control is that the PRE-deploy window must show a non-zero writing tick
// somewhere in it; if it doesn't, the extractor is suspect, not the corpus.
//
// CLASSIFICATION (the four states a tick can be in):
//   writing  — summarized > 0            → guard FIRES, flush expected
//   failed   — summarized = 0, failed > 0 → guard does NOT fire, deliberately
//   idle     — summarized = 0, failed = 0 → guard does NOT fire (the ~98.7% case)
//   skipped  — payload.skipped = overlap  → lock-skipped, no work attempted
//
//   npx tsx scripts/diagnostic/flush-measure-672.ts [hoursBack] [deployIso]
import "dotenv/config";
import { createClient } from "@libsql/client";

const DEFAULT_DEPLOY_ISO = "2026-08-18T18:55:07.213Z";

// Routes that flush a cache tag on a schedule. Used for the attribution caveat:
// a step in the account rows-read slope is only attributable to `bills` if no
// other flushing cron fired in the same minute.
const FLUSHING_ROUTES = new Set([
  "/api/sync",
  "/api/sync-votes",
  "/api/sync-race-ratings",
  "/api/cron/committees",
  "/api/cron/news",
  "/api/cron/markets",
  "/api/cron/kalshi",
  "/api/cron/lda",
  "/api/cron/lda-rollup",
  "/api/cron/amendments",
  "/api/cron/nominations",
  "/api/cron/weekly-report",
  "/api/cron/race-challengers",
]);

type Tick = {
  startedAt: string;
  status: string;
  klass: "writing" | "failed" | "idle" | "skipped" | "unknown";
  summarized: number | null;
  failed: number | null;
};

function unwrap(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  let outer: unknown;
  try {
    outer = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!outer || typeof outer !== "object") return null;
  const o = outer as Record<string, unknown>;
  // The envelope: the tick's own fields sit one level down under `payload`.
  const inner = o.payload;
  if (inner && typeof inner === "object") return inner as Record<string, unknown>;
  return o;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function classify(raw: unknown): Tick["klass"] & string {
  const p = unwrap(raw);
  if (!p) return "unknown";
  if (p.skipped === "overlap") return "skipped";
  const ok = num(p.summarized);
  const failed = num(p.failed);
  if (ok === null) return "unknown";
  if (ok > 0) return "writing";
  if ((failed ?? 0) > 0) return "failed";
  return "idle";
}

function fmt(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z?$/, "").replace(/Z$/, "");
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL required");

  const hoursBack = Number(process.argv[2] ?? 24);
  const deployIso = process.argv[3] ?? DEFAULT_DEPLOY_ISO;
  const deployMs = Date.parse(deployIso);
  if (Number.isNaN(deployMs)) throw new Error(`bad deploy ISO: ${deployIso}`);

  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - hoursBack * 3600_000).toISOString();

  const db = createClient({ url, authToken });

  console.log("=".repeat(96));
  console.log("HO 672 STEP 1 — summarize flush-guard CAUSE series");
  console.log("=".repeat(96));
  console.log(`  now              ${fmt(new Date(nowMs).toISOString())}Z`);
  console.log(`  window start     ${fmt(sinceIso)}Z  (${hoursBack}h back)`);
  console.log(`  guard live from  ${fmt(deployIso)}Z  (prod deploy of dc10f72, READY)`);
  const postMin = Math.round((nowMs - deployMs) / 60_000);
  console.log(`  post-deploy      ${postMin} min  (~${(postMin / 10).toFixed(1)} */10 ticks due)`);
  console.log("");

  // ---- summarize ticks -----------------------------------------------------
  const rs = await db.execute({
    sql: `SELECT started_at, status, payload
            FROM cron_runs
           WHERE route = '/api/cron/summarize'
             AND started_at >= ?
           ORDER BY started_at ASC`,
    args: [sinceIso],
  });

  if (rs.rows.length === 0) {
    console.log("  NO summarize ticks in window — nothing to conclude.");
    return;
  }

  console.log("--- raw first row (envelope check) ---");
  console.log(`  ${String(rs.rows[0]!.payload).slice(0, 220)}`);
  console.log("");

  const ticks: Tick[] = rs.rows.map((r) => {
    const raw = r.payload;
    const p = unwrap(raw);
    return {
      startedAt: String(r.started_at),
      status: String(r.status),
      klass: classify(raw) as Tick["klass"],
      summarized: p ? num(p.summarized) : null,
      failed: p ? num(p.failed) : null,
    };
  });

  const pre = ticks.filter((t) => Date.parse(t.startedAt) < deployMs);
  const post = ticks.filter((t) => Date.parse(t.startedAt) >= deployMs);

  const tally = (list: Tick[]) => {
    const c = { writing: 0, failed: 0, idle: 0, skipped: 0, unknown: 0 };
    for (const t of list) c[t.klass] += 1;
    return c;
  };

  const report = (label: string, list: Tick[]) => {
    const c = tally(list);
    console.log(`--- ${label} — ${list.length} ticks ---`);
    console.log(
      `  writing ${c.writing}   idle ${c.idle}   failed-only ${c.failed}   lock-skipped ${c.skipped}   unknown ${c.unknown}`,
    );
    const flushes = c.writing; // post-guard: only writing ticks flush
    console.log(`  → bills-tag flushes from this route: ${flushes} (guarded) vs ${list.length} (unguarded)`);
    console.log("");
  };

  report("PRE-deploy (unguarded code serving)", pre);
  report("POST-deploy (guarded code serving)", post);

  // The control: the extractor must be able to SEE a writing tick somewhere.
  const anyWriting = ticks.filter((t) => t.klass === "writing");
  console.log("--- CONTROL: extractor can read a non-zero `summarized` ---");
  if (anyWriting.length === 0) {
    console.log(
      `  NO writing tick anywhere in ${hoursBack}h. The extractor is UNPROVEN on this run —`,
    );
    console.log(
      "  a broken payload read and a genuinely quiet corpus are indistinguishable here.",
    );
    console.log("  Widen the window before trusting the zero.");
  } else {
    console.log(`  ${anyWriting.length} writing tick(s) read with summarized > 0:`);
    for (const t of anyWriting.slice(-5)) {
      console.log(`    ${fmt(t.startedAt)}Z  summarized=${t.summarized}  failed=${t.failed}`);
    }
  }
  console.log("");

  // ---- post-deploy tick log ------------------------------------------------
  console.log("--- POST-deploy tick log (every tick since the guard went live) ---");
  if (post.length === 0) {
    console.log("  none yet.");
  } else {
    for (const t of post) {
      const flag = t.klass === "writing" ? "FLUSH" : "  -  ";
      console.log(
        `  ${fmt(t.startedAt)}Z  ${flag}  ${t.klass.padEnd(8)} status=${t.status.padEnd(8)} summarized=${t.summarized ?? "?"} failed=${t.failed ?? "?"}`,
      );
    }
  }
  console.log("");

  // ---- other flushing crons in the same window (attribution) ---------------
  const rs2 = await db.execute({
    sql: `SELECT route, started_at, status
            FROM cron_runs
           WHERE started_at >= ?
             AND route <> '/api/cron/summarize'
           ORDER BY started_at ASC`,
    args: [new Date(deployMs).toISOString()],
  });
  console.log("--- OTHER cron activity since the guard went live (attribution) ---");
  console.log("  A step in the account rows-read slope is attributable to `bills`");
  console.log("  only if no other tag-flushing cron fired in the same minute.");
  if (rs2.rows.length === 0) {
    console.log("  none — no competing flush in the post-deploy window.");
  } else {
    for (const r of rs2.rows) {
      const route = String(r.route);
      const mark = FLUSHING_ROUTES.has(route) ? "FLUSHES" : "       ";
      console.log(`  ${fmt(String(r.started_at))}Z  ${mark}  ${route}  (${r.status})`);
    }
  }
  console.log("");

  // ---- arithmetic ----------------------------------------------------------
  console.log("--- ARITHMETIC (what the post-deploy window supports) ---");
  const c = tally(post);
  if (post.length === 0) {
    console.log("  no post-deploy ticks — no rate can be computed.");
  } else {
    const perDayTicks = (post.length / Math.max(postMin, 1)) * 1440;
    const perDayFlush = (c.writing / Math.max(postMin, 1)) * 1440;
    console.log(
      `  ticks observed ${post.length} over ${postMin} min → ${perDayTicks.toFixed(0)}/day (expect ~144)`,
    );
    console.log(
      `  writing ticks  ${c.writing} over ${postMin} min → ${perDayFlush.toFixed(1)}/day flushes from summarize`,
    );
    console.log("  + /api/sync's 4/day unconditional = the predicted ~6/day total.");
    if (c.writing === 0) {
      console.log("");
      console.log("  NOTE: zero writing ticks in the window. That is CONSISTENT with the");
      console.log("  guard but proves nothing about it — the positive direction (a writing");
      console.log("  tick DOES still flush) is UNTESTED until one occurs.");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
