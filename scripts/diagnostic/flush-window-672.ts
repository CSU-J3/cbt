// HO 672 STEP 1 — the EFFECT series, sampled across a natural flush window.
// READ-ONLY (GETs only; nothing is flushed, nothing is written to the DB).
//
// WHY THIS SHAPE. The specified effect series — Turso account rows-read — is
// dashboard-only from this box (no turso CLI, no platform API token; SKILL
// "Platform facts" records the same limit). This substitutes a latency series
// that carries its OWN calibration inside the same window, so it does not
// depend on a manual flush or on a dashboard read.
//
// THE WINDOW IS CHOSEN, AND ITS SLOTS ARE NOT EQUALLY CLEAN. Read out of
// vercel.json rather than assumed — 00:00Z turns out to be the most contended
// minute in the schedule, with SIX crons firing at once:
//
//   00:00Z  /api/sync (flushes `bills`) + committees (`committees`,`meetings`)
//           + markets (`markets`) + news (`news-breaking`) + primaries (no tag)
//           + summarize.  /welcome renders bills panels AND both tapes AND
//           breaking, so a spike here is "SOME flush happened", NOT a `bills`
//           attribution.  Its job is SENSITIVITY CALIBRATION only: if the probe
//           cannot see this, it cannot see anything — stop.
//   ~00:10Z summarize alone. The sync-coupled writing tick. **CLEAN POSITIVE**
//           — the only bills-attributable flush in the window.
//   00:20Z  summarize alone, idle. **CLEAN NEGATIVE.**
//   00:15Z  kalshi (`races`) — contended, ignore.
//   00:30Z  summarize idle + news (`news-breaking`) — contended, ignore.
//   00:40Z  summarize alone, idle. **CLEAN NEGATIVE #2.** The window runs to
//           00:50 solely to capture this one; 00:40 was the original end and
//           would have clipped it.
//
// So the base experiment rests on ONE clean positive and TWO clean negatives.
// Thin, and stated as thin. The 00:10Z tick is also not guaranteed to write:
// over the 8-day baseline one day (08-16) had zero writing ticks all day, and if
// 00:10Z comes back idle the positive direction is untested again — that is a
// "not yet", not a pass.
//
// CONDITIONAL EXTENSION. At DECIDE_AT this reads cron_runs for the 00:10Z tick:
//   wrote  → extend to EXTENDED_END, adding the clean slots 00:50Z and 01:10Z
//            (01:00Z is contended by the */30 news cron — checked in vercel.json,
//            not guessed). Four clean negatives against one positive turns "flat
//            across two ticks" into a pattern.
//   idle   → stop at BASE_END. Extending a window with no positive in it buys
//            nothing, and every extra cycle is real traffic against prod.
//
// THE FALSIFIABLE SHAPE, STATED BEFORE THE RUN:
//   exactly one slow outlier just after 00:00Z, exactly one just after the
//   writing tick, and NONE after the idle ticks.
// Anything else is a reading that means something:
//   - an outlier after an idle tick        → the guard does not take in prod
//   - NO outlier after the 00:00Z sync     → THE PROBE IS INSENSITIVE. Say so and
//                                            stop. Do NOT read idle-tick flatness
//                                            as confirmation — that is the exact
//                                            same-as-success failure this step
//                                            exists to avoid.
//
// CONTROL CHANNEL. /api/version is force-dynamic, DB-free and carries no cache
// tag, so it cannot be flushed. Sampling it in the same cycle separates a
// server-side regeneration (only /welcome moves) from network jitter or a cold
// lambda (both move together). Without it a spike is unattributable.
//
// TRAFFIC AMBIGUITY. A flush with no subsequent visitor leaves no step, so an
// absent step is ambiguous unless traffic is known. At a 20s cadence this
// sampler IS the traffic, and is therefore the first visitor after each flush by
// construction — which is what removes the ambiguity.
//
//   npx tsx scripts/diagnostic/flush-window-672.ts [startIso] [endIso] [periodSec]
import "dotenv/config";
import { createClient } from "@libsql/client";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const HOST = "https://congressional-terminal-chi-silk.vercel.app";
const SUBJECT = `${HOST}/welcome`; // bills-tagged; the thing under test
const CONTROL = `${HOST}/api/version`; // untagged, DB-free; the noise channel

const DEFAULT_START = "2026-08-18T23:55:00Z";
// Base end captures the 00:40Z tick's aftermath (00:40 itself would clip it).
const DEFAULT_END = "2026-08-19T00:50:00Z";
// Extended end captures the 01:10Z tick's aftermath, for the same clipping
// reason — the stated bound was "out to 01:10Z", and an end AT 01:10 would clip
// the very slot it names.
const EXTENDED_END = "2026-08-19T01:15:00Z";
// Late enough that a writing tick starting ~00:10 has finished and finalized its
// cron_runs row (a writing tick can run ~50s), early enough to decide before the
// base window closes.
const DECIDE_AT = "2026-08-19T00:16:00Z";
// The tick under test: the sync-coupled 00:10Z slot.
const POSITIVE_SLOT_FROM = "2026-08-19T00:05:00Z";
const OUT =
  "C:/Users/meh/AppData/Local/Temp/claude/C--Users-meh-Desktop-CBT/9a402f0e-2cca-4a07-b111-2f1813a5a0be/scratchpad/flush-window-672.jsonl";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function timedGet(
  target: string,
): Promise<{ ms: number; status: number; bytes: number; err?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(target, {
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
    const body = await res.text();
    return { ms: Date.now() - t0, status: res.status, bytes: body.length };
  } catch (e) {
    return {
      ms: Date.now() - t0,
      status: 0,
      bytes: 0,
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  const startIso = process.argv[2] ?? DEFAULT_START;
  const endIso = process.argv[3] ?? DEFAULT_END;
  const periodMs = Number(process.argv[4] ?? 20) * 1000;

  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error(`bad window: ${startIso} .. ${endIso}`);
  }

  mkdirSync(dirname(OUT), { recursive: true });

  const banner = [
    "=".repeat(96),
    "HO 672 STEP 1 — /welcome flush-window latency series",
    "=".repeat(96),
    `  subject   ${SUBJECT}`,
    `  control   ${CONTROL}`,
    `  window    ${startIso} .. ${endIso}  every ${periodMs / 1000}s`,
    `  out       ${OUT}`,
    `  launched  ${new Date().toISOString()}`,
    "",
  ].join("\n");
  console.log(banner);

  const waitMs = startMs - Date.now();
  if (waitMs > 0) {
    console.log(`  waiting ${Math.round(waitMs / 60000)} min for the window to open...`);
    await sleep(waitMs);
  } else {
    console.log("  window already open — sampling immediately.");
  }

  const decideMs = Date.parse(DECIDE_AT);
  const extendedEndMs = Date.parse(EXTENDED_END);
  let decided = false;
  let endMsLive = endMs;

  // Did the 00:10Z slot actually write? Read it, don't assume it. Same envelope
  // trap as flush-measure-672.ts: the tick's fields sit under payload.payload.
  async function positiveLanded(): Promise<{ wrote: boolean; detail: string }> {
    const db = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    const rs = await db.execute({
      sql: `SELECT started_at, payload FROM cron_runs
             WHERE route = '/api/cron/summarize'
               AND started_at >= ? AND started_at < ?
             ORDER BY started_at ASC`,
      args: [POSITIVE_SLOT_FROM, DECIDE_AT],
    });
    const seen: string[] = [];
    let wrote = false;
    for (const r of rs.rows) {
      let s: unknown = null;
      try {
        const o = JSON.parse(String(r.payload)) as Record<string, unknown>;
        const inner = (o.payload ?? o) as Record<string, unknown>;
        s = inner.summarized;
      } catch {
        /* leave null — reported as ? below */
      }
      seen.push(`${String(r.started_at).slice(11, 16)}Z summarized=${s ?? "?"}`);
      if (typeof s === "number" && s > 0) wrote = true;
    }
    return { wrote, detail: seen.length ? seen.join(", ") : "no tick rows found" };
  }

  let n = 0;
  while (Date.now() < endMsLive) {
    if (!decided && Date.now() >= decideMs) {
      decided = true;
      try {
        const { wrote, detail } = await positiveLanded();
        if (wrote) {
          endMsLive = extendedEndMs;
          console.log("");
          console.log(`  >>> 00:10Z SLOT WROTE (${detail})`);
          console.log(`  >>> clean positive landed — EXTENDING to ${EXTENDED_END}`);
          console.log("  >>> adds clean negatives at 00:50Z and 01:10Z (01:00Z is contended)");
          console.log("");
        } else {
          console.log("");
          console.log(`  >>> 00:10Z SLOT IDLE (${detail})`);
          console.log(`  >>> no positive to anchor a longer flat stretch — stopping at ${endIso}`);
          console.log("  >>> the positive direction is UNTESTED; next decisive slot is 06:10Z");
          console.log("");
        }
      } catch (e) {
        console.log(
          `  >>> extension check FAILED (${e instanceof Error ? e.message : String(e)}) — not extending`,
        );
      }
    }
    const cycleStart = Date.now();
    const ts = new Date(cycleStart).toISOString();
    const subject = await timedGet(SUBJECT);
    const control = await timedGet(CONTROL);
    n += 1;

    const row = { n, ts, subject, control };
    appendFileSync(OUT, JSON.stringify(row) + "\n", "utf8");
    console.log(
      `  ${ts}  #${String(n).padStart(3)}  welcome ${String(subject.ms).padStart(6)}ms ` +
        `(${subject.status}, ${subject.bytes}b)   version ${String(control.ms).padStart(5)}ms (${control.status})` +
        (subject.err ? `  ERR ${subject.err}` : ""),
    );

    const elapsed = Date.now() - cycleStart;
    if (elapsed < periodMs) await sleep(periodMs - elapsed);
  }

  console.log("");
  console.log(`  done — ${n} samples written to ${OUT}`);
  console.log("  correlate with: npx tsx scripts/diagnostic/flush-measure-672.ts 24");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
