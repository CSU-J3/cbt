// HO 525 (B2) — career roll-call participation sync from Voteview votes files.
//
// Builds `member_career_votes`: one row per current member with their LIFETIME
// missed-vote rate, accumulated across every Congress they served (earliest →
// 119, both chambers). Surfaced on the member hub beside the 119th figure (B1).
//
// Extends the scripts/voteview-source.ts CSV-over-HTTP pattern, but the votes
// files are huge (a Congress's House file is ~280–550k rows), so this STREAM-parses
// each file row-by-row and discards it before the next — peak memory is flat at
// ~130MB regardless of range (the accumulator is 536 members × a few ints/a small
// Set). Cost measured by HO 524: 52 files, ~356MB, ~8s dl + ~8s parse.
//
// Manual, on-demand — career rates move glacially and Voteview updates per-Congress.
// NOT a cron. Run against prod like sync:ideology:  npm run sync:career-votes
//
// cast_code rule (HO 524 probe CORRECTION — the {0,1–6,9} model was wrong):
//   cast    = codes 1–8   (7/8 = Present = participation, folded into cast)
//   miss    = code 9      (Not Voting — the miss)
//   exclude = code 0      (not seated — rare; non-seated members usually have NO
//                          row rather than a 0-row, so this is a guard, not the path)
import "dotenv/config";
import { getDb } from "../lib/db";
import { VOTEVIEW_HSALL_URL } from "./voteview-source";

const VOTES_BASE = "https://voteview.com/static/data/out/votes";
// Voteview zero-pads the congress number to width 3 (H094_votes.csv); unpadded
// H94 404s. H119 is already 3 digits. Always pad.
const votesUrl = (chamber: "H" | "S", congress: number) =>
  `${VOTES_BASE}/${chamber}${String(congress).padStart(3, "0")}_votes.csv`;

const LATEST_CONGRESS = 119;

// Per-member lifetime accumulator. `congresses` holds every Congress in which the
// member cast OR missed at least one vote (code 1–9); its min → first_congress and
// its size → congresses_served. code 0 rows never touch this.
type Accum = {
  cast: number; // codes 1–8
  miss: number; // code 9
  congresses: Set<number>;
};

async function main() {
  const db = getDb();

  // 1. Current-member icpsr→bioguide. member_ideology accumulates a row for every
  //    member ever matched (it's never pruned), so join is_current=1 to restrict to
  //    the live roster (~536; Graham has no icpsr → no row → graceful hub null).
  //    Building rows only for current members keeps the table == what the hub reads.
  const idRes = await db.execute(
    `SELECT mi.bioguide_id, mi.icpsr
       FROM member_ideology mi
       JOIN members m ON m.bioguide_id = mi.bioguide_id
      WHERE m.is_current = 1`,
  );
  const bioguideByIcpsr = new Map<number, string>();
  for (const r of idRes.rows) {
    const icpsr = Number(r.icpsr);
    if (Number.isFinite(icpsr))
      bioguideByIcpsr.set(icpsr, r.bioguide_id as string);
  }
  const icpsrs = new Set(bioguideByIcpsr.keys());
  console.log(`Current members with an icpsr: ${icpsrs.size}`);

  // 2. Derive the earliest served Congress across current members from the small
  //    combined member file (6.2MB, one fetch). Its column order is
  //    congress(0),chamber(1),icpsr(2),… — both leading columns sit BEFORE the
  //    quoted bioname comma-trap, so slicing the first three fields is exact.
  const hsRes = await fetch(VOTEVIEW_HSALL_URL);
  if (!hsRes.ok) throw new Error(`HSall HTTP ${hsRes.status}`);
  const hsLines = (await hsRes.text()).split(/\r?\n/);
  let earliest = LATEST_CONGRESS;
  for (let i = 1; i < hsLines.length; i++) {
    const line = hsLines[i];
    if (!line) continue;
    const c1 = line.indexOf(",");
    const c2 = line.indexOf(",", c1 + 1);
    const c3 = line.indexOf(",", c2 + 1);
    const icpsr = Number(line.slice(c2 + 1, c3));
    if (!icpsrs.has(icpsr)) continue;
    const congress = Number(line.slice(0, c1));
    if (congress < earliest) earliest = congress;
  }
  console.log(
    `Earliest served Congress: ${earliest} → ${LATEST_CONGRESS} (${LATEST_CONGRESS - earliest + 1} congresses × 2 chambers)`,
  );

  // 3. Stream every votes file in range; accumulate per icpsr. Discard each file
  //    before the next — nothing but the accumulator is retained.
  const accum = new Map<number, Accum>();
  const bucket = (icpsr: number): Accum => {
    let a = accum.get(icpsr);
    if (!a) accum.set(icpsr, (a = { cast: 0, miss: 0, congresses: new Set() }));
    return a;
  };

  let filesFetched = 0;
  for (let congress = earliest; congress <= LATEST_CONGRESS; congress++) {
    for (const chamber of ["H", "S"] as const) {
      const matched = await accumulateVotesFile(
        votesUrl(chamber, congress),
        icpsrs,
        bucket,
        congress,
      );
      if (matched !== null) filesFetched++;
    }
    process.stdout.write(`  congress ${congress} done\r`);
  }
  console.log(`\nFetched ${filesFetched} votes files`);

  // 4. Compute the rollup + truncate-then-insert atomically (full recompute from
  //    an API-reproducible source — no two-phase SET-clause staleness window).
  const syncedAt = new Date().toISOString();
  const inserts: { sql: string; args: (string | number)[] }[] = [];
  for (const [icpsr, a] of accum) {
    const bioguide = bioguideByIcpsr.get(icpsr);
    if (!bioguide) continue; // shouldn't happen — icpsrs came from the same map
    const eligible = a.cast + a.miss;
    if (eligible === 0) continue; // no participation-eligible rows → no figure
    const congresses = [...a.congresses].sort((x, y) => x - y);
    const first = congresses[0];
    if (first === undefined) continue; // eligible>0 guarantees ≥1, but keep tsc happy
    inserts.push({
      sql: `INSERT INTO member_career_votes (
              bioguide_id, icpsr, career_eligible, career_missed,
              career_missed_pct, first_congress, congresses_served, synced_at
            ) VALUES (?,?,?,?,?,?,?,?)`,
      args: [
        bioguide,
        icpsr,
        eligible,
        a.miss,
        a.miss / eligible,
        first,
        congresses.length,
        syncedAt,
      ],
    });
  }

  await db.batch(
    [{ sql: "DELETE FROM member_career_votes", args: [] }, ...inserts],
    "write",
  );

  console.log("\n=== Career votes sync — HO 525 ===");
  console.log(`rows written: ${inserts.length}`);

  // Cross-check readout: highest / lowest / a mid missed-pct, plus a couple of
  // named long-servers, to eyeball against GovTrack before the surface goes live.
  const ranked = inserts
    .map((i) => ({
      bioguide: i.args[0] as string,
      icpsr: i.args[1] as number,
      eligible: i.args[2] as number,
      missed: i.args[3] as number,
      pct: i.args[4] as number,
      first: i.args[5] as number,
      served: i.args[6] as number,
    }))
    .sort((a, b) => a.pct - b.pct);
  const nameRes = await db.execute(
    "SELECT bioguide_id, name, state FROM members WHERE is_current = 1",
  );
  const nameOf = new Map<string, string>();
  const stateOf = new Map<string, string>();
  for (const r of nameRes.rows) {
    nameOf.set(r.bioguide_id as string, (r.name as string) ?? "");
    stateOf.set(r.bioguide_id as string, (r.state as string) ?? "");
  }
  // Non-voting delegates/RC (these territories) can't vote on most floor business,
  // so their MISS rate is structurally inflated — the "banked delegate constraint".
  // The own-rate hub display keeps it (per B1/spec); flag it here for the eyeball.
  const DELEGATE_STATES = new Set(["AS", "GU", "MP", "VI", "DC", "PR"]);
  const isDelegate = (b: string) => DELEGATE_STATES.has(stateOf.get(b) ?? "");
  const line = (r: (typeof ranked)[number]) =>
    `  ${(nameOf.get(r.bioguide) ?? r.bioguide).padEnd(30)} ${(100 * r.pct).toFixed(2).padStart(6)}%  (missed ${r.missed}/${r.eligible}, since C${r.first}, ${r.served} cong)${isDelegate(r.bioguide) ? "  [DELEGATE — structural]" : ""}`;
  console.log("\nlowest missed-% (best attendance):");
  ranked.slice(0, 3).forEach((r) => console.log(line(r)));
  const mid = ranked[Math.floor(ranked.length / 2)];
  if (mid) {
    console.log("median missed-%:");
    console.log(line(mid));
  }
  console.log("highest missed-% (all):");
  ranked
    .slice(-3)
    .reverse()
    .forEach((r) => console.log(line(r)));
  console.log("highest missed-% (non-delegate — the fair high-tail cross-check):");
  ranked
    .filter((r) => !isDelegate(r.bioguide))
    .slice(-3)
    .reverse()
    .forEach((r) => console.log(line(r)));
  // Named anchors for the GovTrack eyeball.
  console.log("named anchors:");
  for (const b of ["G000386" /* Grassley */, "C001035" /* Collins */]) {
    const r = ranked.find((x) => x.bioguide === b);
    if (r) console.log(line(r));
  }
}

// Stream-parse one votes file, accumulating cast/miss per current icpsr. Returns
// the number of matched rows, or null if the file 404s (skip, don't fail). Never
// holds more than one chunk + a line remainder in memory.
async function accumulateVotesFile(
  url: string,
  icpsrs: Set<number>,
  bucket: (icpsr: number) => Accum,
  congress: number,
): Promise<number | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok || !res.body) throw new Error(`${url} HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let headerSeen = false;
  let matched = 0;

  // votes schema: congress,chamber,rollnumber,icpsr,cast_code,prob — all numeric,
  // no quoted fields, so split(',') is exact.
  const handleLine = (line: string) => {
    if (!headerSeen) {
      headerSeen = true;
      return;
    }
    if (!line) return;
    const parts = line.split(",");
    const icpsr = Number(parts[3]);
    if (!icpsrs.has(icpsr)) return;
    const code = Number(parts[4]);
    if (code === 0) return; // not seated — excluded from the denominator
    if (code < 1 || code > 9) return; // unknown code — ignore defensively
    matched++;
    const a = bucket(icpsr);
    if (code === 9) a.miss++;
    else a.cast++; // 1–8, incl. Present (7/8)
    a.congresses.add(congress);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = remainder + decoder.decode(value, { stream: true });
    let start = 0;
    for (;;) {
      const nl = buf.indexOf("\n", start);
      if (nl === -1) break;
      let line = buf.slice(start, nl);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      handleLine(line);
      start = nl + 1;
    }
    remainder = buf.slice(start);
  }
  if (remainder) handleLine(remainder.endsWith("\r") ? remainder.slice(0, -1) : remainder);

  return matched;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
