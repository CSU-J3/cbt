// HO 753: walk every bill the per-bill committee walk owes, once, outside the cron.
//
//   npm run repair:committee-bills               dry: count what is owed, read the key's
//                                                rate limit with ONE GET, write nothing
//                                                (exit 2 if that GET does not answer 200)
//   npm run repair:committee-bills -- --write    walk every owed bill, paced under the limit
//
// It is the cron's own walk, `syncCommitteeBills` from lib/committees-sync.ts, with no
// deadline, run round after round until nothing is owed. So it writes only what a
// tick writes: `committee_bills` rows, and each walked bill's `committees_walked_at`
// and `committee_walk_failures`. It is resumable: a stamped bill drops out of the
// selection, so a stopped run picks up where it stopped. Every bill that predates
// HO 753 has a NULL `changed_at` and is owed once: about 18,000 requests on prod
// (17,976 bills and 14 second pages at HO 753's STEP 0; it grows with new bills).
//
// Pacing comes from api.data.gov's own headers: X-RateLimit-Limit sets the gap so the
// run uses at most MARGIN of the hourly limit, and a low X-RateLimit-Remaining slows it
// further. Without the headers it walks at 1 request per 1.2s. A 429 stops the run
// (exit 3), with nothing counted against the bill. The repair counts no failure toward
// the cron's give-up cap (its rounds are minutes apart, not six hours). A round in
// which nothing lands stops the run: exit 4, an outage or a bad key, and a rerun
// resumes. When earlier rounds walked and only bills that already failed in this run
// are left, it ends with exit 5 and names them: they fail on every walk, a rerun will
// not clear them, and the cron counts their failures and sets them aside. Run it outside the committees
// cron's ticks (00:05, 06:05, 12:05 and 18:05 UTC since HO 756, each up to about five
// minutes): the two walks would pick the same bills and share the key's hour.
import "dotenv/config";
import { getDb } from "../lib/db";
import { readCommitteeWalkBacklog, syncCommitteeBills, GIVE_UP_AT, type WalkHooks } from "../lib/committees-sync";
import { getCurrentCongress } from "../lib/congress";
import { redactSecrets } from "../lib/redact";

const MARGIN = 0.75; // at most this share of the key's hourly limit
const FALLBACK_GAP_MS = 1_200; // no headers: 1 request per 1.2s
const LOW_REMAINING = 0.1; // below this share of the limit left, slow right down
const LOW_GAP_MS = 5_000;
const ROUND = 500;
const MAX_ROUNDS = 1_000;
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makePacer() {
  let gap = FALLBACK_GAP_MS;
  let last = 0;
  let requests = 0;
  let minGap = Number.POSITIVE_INFINITY;
  let limit: number | null = null;
  let remaining: number | null = null;
  const hooks: WalkHooks = {
    beforeFetch: async () => {
      let wait = last + gap - Date.now();
      while (wait > 0) {
        await sleep(wait);
        wait = last + gap - Date.now();
      }
      const now = Date.now();
      if (last) minGap = Math.min(minGap, now - last);
      last = now;
      requests++;
    },
    afterFetch: (res) => {
      const l = res.headers.get("x-ratelimit-limit");
      const r = res.headers.get("x-ratelimit-remaining");
      if (l && Number(l) > 0) {
        limit = Number(l);
        gap = Math.ceil(3_600_000 / (limit * MARGIN));
      }
      if (r != null && limit) {
        remaining = Number(r);
        if (remaining < limit * LOW_REMAINING) gap = Math.max(gap, LOW_GAP_MS);
      }
    },
  };
  return { hooks, stats: () => ({ gap, requests, minGap: Number.isFinite(minGap) ? minGap : null, limit, remaining }) };
}

async function owedByClass() {
  const rs = await getDb().execute({
    sql: `SELECT
            SUM(CASE WHEN committees_walked_at IS NULL AND changed_at IS NULL THEN 1 ELSE 0 END) AS never_stamped,
            SUM(CASE WHEN committees_walked_at IS NULL AND changed_at IS NOT NULL THEN 1 ELSE 0 END) AS new_never_walked,
            SUM(CASE WHEN committees_walked_at IS NOT NULL THEN 1 ELSE 0 END) AS changed_since_walk
          FROM bills
          WHERE congress = ? AND (committees_walked_at IS NULL OR committees_walked_at < changed_at)
            AND json_extract(raw_json, '$.committees.count') > 0`,
    args: [getCurrentCongress()],
  });
  const r = rs.rows[0];
  return { neverStamped: Number(r?.never_stamped ?? 0), newNeverWalked: Number(r?.new_never_walked ?? 0), changedSinceWalk: Number(r?.changed_since_walk ?? 0) };
}

async function probeRate(): Promise<{ status: number | null; text: string }> {
  // One GET of the first owed bill's committees, for the headers only.
  const row = (await getDb().execute({
    sql: `SELECT congress, bill_type, bill_number FROM bills
          WHERE congress = ? AND (committees_walked_at IS NULL OR committees_walked_at < changed_at)
            AND json_extract(raw_json, '$.committees.count') > 0 LIMIT 1`,
    args: [getCurrentCongress()],
  })).rows[0];
  if (!row) return { status: null, text: "nothing owed, so no GET" };
  const key = process.env.CONGRESS_API_KEY;
  if (!key) throw new Error("CONGRESS_API_KEY is not set");
  const res = await fetch(`https://api.congress.gov/v3/bill/${row.congress}/${String(row.bill_type).toLowerCase()}/${row.bill_number}/committees?api_key=${key}&format=json`, { signal: AbortSignal.timeout(8_000) });
  await res.text();
  const l = res.headers.get("x-ratelimit-limit");
  const r = res.headers.get("x-ratelimit-remaining");
  if (!l) return { status: res.status, text: `HTTP ${res.status}; no X-RateLimit-Limit header, so the write would walk at 1 request per ${FALLBACK_GAP_MS} ms` };
  const gap = Math.ceil(3_600_000 / (Number(l) * MARGIN));
  return { status: res.status, text: `HTTP ${res.status}; X-RateLimit-Limit ${l}, X-RateLimit-Remaining ${r ?? "absent"}; the write would start at one request per ${gap} ms (${Math.round(MARGIN * 100)}% of the hourly limit)` };
}

async function main() {
  const write = process.argv.includes("--write");
  const url = process.env.TURSO_DATABASE_URL ?? "";
  const h = new Date().getUTCHours(), m = new Date().getUTCMinutes();
  say(`=== repair:committee-bills · ${write ? "WRITE" : "dry run, writes nothing"} · ${new Date().toISOString()} · database ${url.split(":")[0]}: ===`);
  if (h % 6 === 0 && m >= 5 && m < 11) say("warning: inside a committees cron tick (every 6h at :05 UTC, up to about five minutes); the two walks would pick the same bills and share the key's hour");
  const before = await owedByClass();
  const bl = await readCommitteeWalkBacklog();
  say(`owed: ${bl.remaining} selected (never stamped ${before.neverStamped} · new, never walked ${before.newNeverWalked} · changed since their walk ${before.changedSinceWalk}) · set aside after ${GIVE_UP_AT} failed walks ${bl.gaveUp.count}${bl.gaveUp.ids.length ? ` (${bl.gaveUp.ids.join(", ")})` : ""}`);
  if (!write) {
    const p = await probeRate();
    say(`rate: ${p.text}`);
    say(`about ${bl.remaining} requests, plus one more for each bill that lists more than 20 committees. Nothing was written; --write walks them.`);
    if (p.status !== null && p.status !== 200) {
      say("the probe did not answer 200; do not --write until it does");
      process.exitCode = 2;
    }
    return;
  }
  const pacer = makePacer();
  const t0 = Date.now();
  const tot = { walked: 0, failed: 0, rows: 0, processed: 0 };
  let stopped: string | null = null;
  let stuck: string[] | null = null;
  const failedEarlier = new Set<string>();
  let last = bl;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const r = await syncCommitteeBills({ perTickLimit: ROUND, hooks: pacer.hooks, countFailures: false });
    tot.walked += r.billsWalked;
    tot.failed += r.fetchErrors;
    tot.rows += r.rowsUpserted;
    tot.processed += r.billsProcessed;
    last = { remaining: r.remaining, gaveUp: r.gaveUp };
    const st = pacer.stats();
    say(`round ${round}: walked ${r.billsWalked} · failed ${r.fetchErrors}${r.failed.ids.length ? ` (${r.failed.ids.slice(0, 5).join(", ")})` : ""} · rows ${r.rowsUpserted} · remaining ${r.remaining} · set aside ${r.gaveUp.count} · ${Math.round((Date.now() - t0) / 1000)}s · pace ${st.gap} ms (limit ${st.limit ?? "no header"}, remaining ${st.remaining ?? "no header"})`);
    if (r.rateLimited) { stopped = "a 429 from api.congress.gov"; break; }
    if (r.billsProcessed > 0 && r.billsWalked === 0) {
      // Every id known (failed.ids stops at 20), the round not capped, earlier rounds landed, and each
      // bill already failed in this run: a stuck tail, not an outage.
      const onlyRepeats = tot.walked > 0 && !r.capHit && r.fetchErrors === r.failed.ids.length && r.failed.ids.every((id) => failedEarlier.has(id));
      if (onlyRepeats) stuck = r.failed.ids;
      else stopped = `a round in which nothing landed (${r.fetchErrors} failed, e.g. ${r.failed.ids.slice(0, 3).join(", ")}): an outage or a bad key`;
      break;
    }
    for (const id of r.failed.ids) failedEarlier.add(id);
    if (r.remaining === 0 || r.billsProcessed === 0) break;
  }
  const st = pacer.stats();
  say(`done: walked ${tot.walked} · failed ${tot.failed} · rows ${tot.rows} · ${st.requests} requests in ${Math.round((Date.now() - t0) / 1000)}s · smallest gap ${st.minGap ?? "n/a"} ms · still owed ${last.remaining} · set aside ${last.gaveUp.count}${last.gaveUp.ids.length ? ` (${last.gaveUp.ids.join(", ")})` : ""}${stopped ? ` · STOPPED on ${stopped}; rerun to resume` : ""}${stuck ? ` · ${stuck.length} bill(s) failed on every try this run (${stuck.join(", ")}); nothing counted, a rerun will not clear them, the cron retries them and sets them aside after ${GIVE_UP_AT} failed ticks` : ""}`);
  process.exitCode = stopped ? (stopped.startsWith("a 429") ? 3 : 4) : stuck ? 5 : 0;
}

main().catch((e) => {
  console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(1);
});
