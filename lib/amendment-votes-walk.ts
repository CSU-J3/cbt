// HO 532 — House amendment → roll-call-vote linkage walk.
//
// HO 530 shipped the Senate amendment-vote surface query-only (the roll-call number
// is in votes.question). The House has NO cheap key — House vote questions are
// generic ("On Agreeing to the Amendment", no number, only bill_id), so the link
// must be recovered from each HAMDT's /actions.recordedVotes.rollNumber. HO 529 §C
// confirmed GO-WALK: every recordedVote resolves to an existing `votes` row (the
// House vote sync already ingests amendment roll calls, with member_votes), so this
// is a LINKAGE backfill (store amendment_id ↔ vote_id), NOT a member-vote backfill.
//
// The vote_id is DETERMINISTIC — house-{congress}-{session}-{rollNumber} (the same
// construction lib/votes-sync.ts uses) — so the walk CONSTRUCTS it from the
// recordedVotes fields; no lookup. Links are inserted unconditionally (not gated on
// the votes row existing): the read LEFT-JOINs votes, so a link to a not-yet-synced
// roll call is null-safe and self-heals.
//
// HAMDT is small (~228 in the 119th), so the one-time --walk is ~228 /actions GETs
// and the cron delta is usually 0.
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";
const PER_FETCH_TIMEOUT_MS = 15_000; // mirrors amendments-sync PER_DETAIL_TIMEOUT_MS
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// recordedVotes shape confirmed live (HO 532 pre-flight): each carries
// { chamber:"House", congress, sessionNumber, rollNumber, url, date }.
type RecordedVote = {
  chamber?: string;
  congress?: number;
  sessionNumber?: number;
  rollNumber?: number;
};
type ActionsResponse = { actions?: { recordedVotes?: RecordedVote[] }[] };

// 429-backoff fetch with a per-request abort — mirrors fetchJson in
// lib/amendments-sync.ts (the detail loop's helper).
async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PER_FETCH_TIMEOUT_MS),
  });
  if (res.status === 429 && attempt < 3) {
    await sleep(2000 * (attempt + 1));
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch ${url} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

const QUEUE_PREDICATE =
  "amendment_type = 'HAMDT' AND (amendment_vote_walked_at IS NULL OR update_date > amendment_vote_walked_at)";

export type WalkResult = {
  walked: number; // HAMDTs processed + stamped this run
  linksInserted: number; // new amendment_votes rows (conflicts skipped)
  hamdtWithVote: number; // HAMDTs that carried ≥1 recordedVote
  fetchErrors: number; // /actions fetches that threw (NOT stamped — stay in queue)
  deadlineHit: boolean;
  remaining: number; // HAMDTs still in the queue after this run
};

// Walk the HAMDT queue: fetch each amendment's /actions, construct the House
// vote_id(s) from recordedVotes, upsert the link, stamp the sentinel. `limit`
// caps the batch for the cron step (LIMIT -1 = unbounded, the --walk backfill);
// `deadlineMs` is the cron sub-deadline.
export async function walkAmendmentVotes(
  opts: { limit?: number; deadlineMs?: number; pageDelayMs?: number } = {},
): Promise<WalkResult> {
  const { limit, deadlineMs, pageDelayMs = 150 } = opts;
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const db = getDb();

  const queue = await db.execute({
    sql: `SELECT id, congress, amendment_type, amendment_number
            FROM amendments
           WHERE ${QUEUE_PREDICATE}
           ORDER BY update_date ASC
           LIMIT ?`,
    args: [limit ?? -1], // SQLite LIMIT -1 == unbounded
  });

  let walked = 0;
  let linksInserted = 0;
  let hamdtWithVote = 0;
  let fetchErrors = 0;
  let deadlineHit = false;

  for (const row of queue.rows) {
    if (deadlineMs && Date.now() > deadlineMs) {
      deadlineHit = true;
      break;
    }
    const id = String(row.id);
    const congress = Number(row.congress);
    const type = String(row.amendment_type).toLowerCase();
    const number = Number(row.amendment_number);

    // 1. Fetch /actions. On failure, DON'T stamp — leave it in the queue to retry.
    let actions: ActionsResponse["actions"];
    try {
      const url = `${API_BASE}/amendment/${congress}/${type}/${number}/actions?${new URLSearchParams(
        { format: "json", limit: "250", api_key: apiKey },
      )}`;
      actions = (await fetchJson<ActionsResponse>(url)).actions ?? [];
    } catch (e) {
      fetchErrors++;
      console.warn(`[amendment-votes] ${id} /actions failed: ${(e as Error).message}`);
      continue;
    }

    // 2. Construct House vote_id(s) from recordedVotes; upsert each link.
    const voteIds = new Set<string>();
    for (const rv of actions.flatMap((a) => a.recordedVotes ?? [])) {
      if ((rv.chamber ?? "").toLowerCase() !== "house") continue; // a HAMDT's votes are House
      if (rv.rollNumber == null || rv.sessionNumber == null) continue;
      voteIds.add(`house-${rv.congress ?? congress}-${rv.sessionNumber}-${rv.rollNumber}`);
    }
    for (const voteId of voteIds) {
      const res = await db.execute({
        sql: `INSERT INTO amendment_votes (amendment_id, vote_id) VALUES (?, ?)
              ON CONFLICT(amendment_id, vote_id) DO NOTHING`,
        args: [id, voteId],
      });
      linksInserted += res.rowsAffected ?? 0;
    }
    if (voteIds.size > 0) hamdtWithVote++;

    // 3. Stamp — the queue-exit — regardless of whether a vote was found (a
    //    walked-no-vote HAMDT must leave the queue; HO 459 stamp-every-row rule).
    await db.execute({
      sql: "UPDATE amendments SET amendment_vote_walked_at = ? WHERE id = ?",
      args: [new Date().toISOString(), id],
    });
    walked++;
    if (pageDelayMs) await sleep(pageDelayMs);
  }

  const rem = await db.execute(
    `SELECT COUNT(*) AS c FROM amendments WHERE ${QUEUE_PREDICATE}`,
  );
  return {
    walked,
    linksInserted,
    hamdtWithVote,
    fetchErrors,
    deadlineHit,
    remaining: Number(rem.rows[0]?.c ?? 0),
  };
}
