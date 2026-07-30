// HO 567 STEP 0 — confirm the zero-roster cause is a transient publication gap,
// not a permanently memberless roll. READ-ONLY: for each of the four HO 566 M2
// zero-roster votes, fetch the SAME upstream the sync reads (House: item +
// members JSON; Senate: detail XML) and report member count, two sample
// identifiers, and the tally the payload carries — beside the DB-stored tally.
// No DB writes. URL constructions are reimplemented verbatim from the sync
// files (none are exported) — the HO 563/566 genre convention.
//
// GATE (adjudicated in the report, not here): all four populated upstream →
// proceed to the §3 build; any one still empty → HALT (different bug).
//
//   npx tsx scripts/diagnostic/member-votes-upstream-567.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";
import { XMLParser } from "fast-xml-parser";

const API_BASE = "https://api.congress.gov/v3";

// verbatim from lib/votes-sync.ts (not exported)
function houseItemUrl(c: number, s: number, r: number, key: string): string {
  const p = new URLSearchParams({ format: "json", api_key: key });
  return `${API_BASE}/house-vote/${c}/${s}/${r}?${p.toString()}`;
}
function houseMembersUrl(c: number, s: number, r: number, key: string): string {
  const p = new URLSearchParams({ format: "json", api_key: key });
  return `${API_BASE}/house-vote/${c}/${s}/${r}/members?${p.toString()}`;
}
// verbatim from lib/senate-votes-sync.ts (not exported)
function senateDetailUrl(c: number, s: number, padded: string): string {
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${c}${s}/vote_${c}_${s}_${padded}.xml`;
}

function n(v: unknown): number { return Number(v ?? 0); }

async function dbTally(db: Client, id: string): Promise<string> {
  const r = await db.execute({
    sql: `SELECT yea_count, nay_count, present_count, not_voting_count FROM votes WHERE id = ?`,
    args: [id],
  });
  const row = r.rows[0] as Row | undefined;
  if (!row) return "(no votes row)";
  const t = n(row.yea_count) + n(row.nay_count) + n(row.present_count) + n(row.not_voting_count);
  return `${t} (y${n(row.yea_count)} n${n(row.nay_count)} p${n(row.present_count)} nv${n(row.not_voting_count)})`;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function fetchXml(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/xml" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  return parser.parse(await res.text());
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  const key = process.env.CONGRESS_API_KEY?.trim();
  if (!url) { console.log("TURSO_DATABASE_URL not set — run with the CBT .env."); return 1; }
  if (!key) { console.log("CONGRESS_API_KEY not set — run with the CBT .env."); return 1; }
  const db: Client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  let allPopulated = true;

  console.log("══ HO 567 STEP 0 — upstream rosters for the four zero-roster votes ══\n");

  // House: house-{c}-{s}-{r}
  for (const id of ["house-119-2-253", "house-119-2-254", "house-119-2-269"]) {
    const parts = id.split("-");
    const c = Number(parts[1]), s = Number(parts[2]), r = Number(parts[3]);
    const stored = await dbTally(db, id);
    try {
      const membersRes = await fetchJson(houseMembersUrl(c, s, r, key));
      const members: Array<{ bioguideID?: string; voteCast?: string }> =
        membersRes?.houseRollCallVoteMemberVotes?.results ?? [];
      // payload's own tally lives on the item (votePartyTotal aggregate)
      const itemRes = await fetchJson(houseItemUrl(c, s, r, key));
      const totals = (itemRes?.houseRollCallVote?.votePartyTotal ?? []) as Array<Record<string, number>>;
      let pt = 0;
      for (const p of totals) pt += n(p.yeaTotal) + n(p.nayTotal) + n(p.presentTotal) + n(p.notVotingTotal);
      const sample = members.slice(0, 2).map((m) => `${m.bioguideID}:${m.voteCast}`).join(", ");
      const populated = members.length > 0;
      if (!populated) allPopulated = false;
      console.log(`${id}`);
      console.log(`  upstream members: ${members.length}   sample: ${sample || "(none)"}`);
      console.log(`  payload tally: ${pt}   DB-stored tally: ${stored}`);
      console.log(`  → ${populated ? "POPULATED" : "STILL EMPTY UPSTREAM"}\n`);
    } catch (err) {
      allPopulated = false;
      console.log(`${id}\n  FETCH ERROR: ${(err as Error).message}\n  → INCONCLUSIVE (treat as not-confirmed)\n`);
    }
  }

  // Senate: senate-{c}-{s}-{r}
  for (const id of ["senate-119-2-146"]) {
    const parts = id.split("-");
    const c = Number(parts[1]), s = Number(parts[2]), r = Number(parts[3]);
    const padded = String(r).padStart(5, "0");
    const stored = await dbTally(db, id);
    try {
      const doc = await fetchXml(senateDetailUrl(c, s, padded));
      const rcv = doc?.roll_call_vote;
      const raw = rcv?.members?.member;
      const members: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const cnt = rcv?.count ?? {};
      const pt = n(cnt.yeas) + n(cnt.nays) + n(cnt.present) + n(cnt.absent);
      const sample = members.slice(0, 2)
        .map((m) => `${String(m.last_name ?? "?")} (${String(m.state ?? "?")}):${String(m.vote_cast ?? "?")}`)
        .join(", ");
      const populated = members.length > 0;
      if (!populated) allPopulated = false;
      console.log(`${id}`);
      console.log(`  upstream members: ${members.length}   sample: ${sample || "(none)"}`);
      console.log(`  payload tally: ${pt}   DB-stored tally: ${stored}`);
      console.log(`  → ${populated ? "POPULATED" : "STILL EMPTY UPSTREAM"}\n`);
    } catch (err) {
      allPopulated = false;
      console.log(`${id}\n  FETCH ERROR: ${(err as Error).message}\n  → INCONCLUSIVE (treat as not-confirmed)\n`);
    }
  }

  console.log("══ GATE ══");
  console.log(allPopulated
    ? "ALL FOUR POPULATED UPSTREAM → transient-publication cause confirmed; proceed to §3 build."
    : "AT LEAST ONE STILL EMPTY / INCONCLUSIVE → HALT; a permanently-memberless roll is a different bug (rescope).");
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
