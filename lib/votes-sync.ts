// House roll-call vote sync (handoff 77). Pulls the list endpoint per
// session, fetches item + member-vote details for any vote whose
// (congress, session, rollCall) we don't already have, then upserts
// `votes` + bulk-inserts `member_votes`. Watermark is MAX(vote_date)
// WHERE chamber='house' so reruns are incremental.
//
// API quirks observed:
//   - list path is /v3/house-vote/{congress}/{session}, REQUIRES session
//   - field names differ from typical guesses: `startDate` not `voteDate`,
//     `sessionNumber` not `session`, `voteQuestion` not `question`
//   - legislation is flat (`legislationType`/`legislationNumber`), not nested
//   - the members sub-endpoint returns ALL ~435 members in one call
//     (no pagination needed), so we skip the page loop for /members
//
// Senate votes ship in a separate handoff — Senate has no Congress.gov
// API coverage, only XML on senate.gov.
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";
const PAGE_SIZE = 250;
// 250ms between API calls = 4 req/s = well under the 5000/hr ceiling on
// average, but the hourly bucket is rolling so we still rely on the 429
// backoff in `fetchJson` if the API ever objects.
const REQUEST_INTERVAL_MS = 250;

const BILL_TYPES = new Set([
  "hr",
  "s",
  "hres",
  "sres",
  "hjres",
  "sjres",
  "hconres",
  "sconres",
]);

// Vote start of the 119th Congress (Jan 3, 2025). Used when the votes
// table has nothing for chamber='house' yet so the first run picks up
// everything from the beginning.
const CONGRESS_119_START = "2025-01-03T00:00:00Z";

type ListVote = {
  congress: number;
  sessionNumber: number;
  rollCallNumber: number;
  startDate: string;
  updateDate?: string;
  legislationType?: string;
  legislationNumber?: string;
  result?: string;
  voteType?: string;
};

type ListResponse = {
  houseRollCallVotes?: ListVote[];
  pagination?: { count?: number; next?: string };
};

type VotePartyTotal = {
  voteParty?: string;
  yeaTotal?: number;
  nayTotal?: number;
  presentTotal?: number;
  notVotingTotal?: number;
};

type ItemVote = ListVote & {
  voteQuestion?: string;
  votePartyTotal?: VotePartyTotal[];
};

type ItemResponse = { houseRollCallVote?: ItemVote };

type MemberVoteRow = {
  bioguideID?: string;
  voteCast?: string;
};

type MembersResponse = {
  houseRollCallVoteMemberVotes?: {
    results?: MemberVoteRow[];
  };
};

export type VotesSyncStats = {
  sessionsSeen: number[];
  votesSeen: number;
  votesInserted: number;
  votesSkipped: number;
  votesFailed: number;
  memberRowsInserted: number;
  fromDate: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  // undici occasionally yields "terminated" / ECONNRESET on long backfills.
  // Treat any thrown network error like a 502 — wait and retry.
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    if (attempt < 3) {
      const wait = 1500 * (attempt + 1);
      console.warn(
        `network error (${(err as Error).message}), sleeping ${wait}ms`,
      );
      await sleep(wait);
      return fetchJson<T>(url, attempt + 1);
    }
    throw err;
  }
  if (res.status === 429 && attempt < 3) {
    const wait = 2000 * (attempt + 1);
    console.warn(`rate limited, sleeping ${wait}ms`);
    await sleep(wait);
    return fetchJson<T>(url, attempt + 1);
  }
  if ((res.status === 502 || res.status === 503) && attempt < 3) {
    const wait = 1000 * (attempt + 1);
    console.warn(`${res.status} from API, sleeping ${wait}ms`);
    await sleep(wait);
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch ${url} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function listUrl(
  congress: number,
  session: number,
  offset: number,
  apiKey: string,
): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    format: "json",
    api_key: apiKey,
  });
  return `${API_BASE}/house-vote/${congress}/${session}?${params.toString()}`;
}

function itemUrl(
  congress: number,
  session: number,
  rollCall: number,
  apiKey: string,
): string {
  const params = new URLSearchParams({ format: "json", api_key: apiKey });
  return `${API_BASE}/house-vote/${congress}/${session}/${rollCall}?${params.toString()}`;
}

function membersUrl(
  congress: number,
  session: number,
  rollCall: number,
  apiKey: string,
): string {
  const params = new URLSearchParams({ format: "json", api_key: apiKey });
  return `${API_BASE}/house-vote/${congress}/${session}/${rollCall}/members?${params.toString()}`;
}

function voteId(congress: number, session: number, rollCall: number): string {
  return `house-${congress}-${session}-${rollCall}`;
}

// Convert API legislation reference into a bills.id ('119-hr-1234'). The
// `bills` table uses lowercase type; we don't enforce existence in `bills`
// here because the vote may reference a bill that hasn't been synced yet
// (the FK only prevents inserts of values that don't exist — we want the
// vote row to land regardless, and rely on the LEFT JOIN at query time).
// Returns null for amendment / procedural types we don't recognize.
function resolveBillId(vote: ListVote): {
  billId: string | null;
  amendmentDesignation: string | null;
} {
  const type = vote.legislationType?.toLowerCase();
  const num = vote.legislationNumber;
  if (!type || !num) return { billId: null, amendmentDesignation: null };
  if (BILL_TYPES.has(type)) {
    return {
      billId: `${vote.congress}-${type}-${num}`,
      amendmentDesignation: null,
    };
  }
  return {
    billId: null,
    amendmentDesignation: `${vote.legislationType}${num}`,
  };
}

function aggregateTotals(item: ItemVote): {
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
} {
  let yea = 0;
  let nay = 0;
  let present = 0;
  let notVoting = 0;
  for (const p of item.votePartyTotal ?? []) {
    yea += p.yeaTotal ?? 0;
    nay += p.nayTotal ?? 0;
    present += p.presentTotal ?? 0;
    notVoting += p.notVotingTotal ?? 0;
  }
  return { yea, nay, present, notVoting };
}

function normalizePosition(cast: string | undefined): string | null {
  if (!cast) return null;
  const c = cast.trim().toLowerCase();
  if (c === "yea" || c === "aye" || c === "yes") return "yea";
  if (c === "nay" || c === "no") return "nay";
  if (c === "present") return "present";
  if (c === "not voting") return "not_voting";
  return null;
}

async function getExistingVoteIds(
  db: ReturnType<typeof getDb>,
  congress: number,
): Promise<Set<string>> {
  const r = await db.execute({
    sql: "SELECT id FROM votes WHERE chamber = 'house' AND congress = ?",
    args: [congress],
  });
  return new Set(r.rows.map((row) => row.id as string));
}

async function getWatermark(
  db: ReturnType<typeof getDb>,
): Promise<string> {
  const r = await db.execute(
    "SELECT MAX(vote_date) AS m FROM votes WHERE chamber = 'house'",
  );
  const m = r.rows[0]?.m as string | null | undefined;
  return m ?? CONGRESS_119_START;
}

const UPSERT_VOTE_SQL = `
INSERT INTO votes (
  id, chamber, congress, session, roll_call, vote_date,
  question, description, result, bill_id, amendment_designation,
  yea_count, nay_count, present_count, not_voting_count,
  raw_json, update_date
) VALUES (?, 'house', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  vote_date = excluded.vote_date,
  question = excluded.question,
  description = excluded.description,
  result = excluded.result,
  bill_id = excluded.bill_id,
  amendment_designation = excluded.amendment_designation,
  yea_count = excluded.yea_count,
  nay_count = excluded.nay_count,
  present_count = excluded.present_count,
  not_voting_count = excluded.not_voting_count,
  raw_json = excluded.raw_json,
  update_date = excluded.update_date
`;

async function upsertVoteAndMembers(
  db: ReturnType<typeof getDb>,
  item: ItemVote,
  members: MemberVoteRow[],
): Promise<number> {
  const id = voteId(item.congress, item.sessionNumber, item.rollCallNumber);
  const resolved = resolveBillId(item);
  const totals = aggregateTotals(item);

  // votes.bill_id has a FK to bills.id. The bills sync runs on its own
  // watermark and occasionally hasn't picked up a bill referenced by a
  // recent vote. NULL the reference in those cases — `bill_id IS NOT NULL`
  // remains a strong guarantee, and the LEFT JOIN in vote queries surfaces
  // the orphan via raw_json if needed.
  let billId = resolved.billId;
  if (billId) {
    const exists = await db.execute({
      sql: "SELECT 1 FROM bills WHERE id = ? LIMIT 1",
      args: [billId],
    });
    if (exists.rows.length === 0) billId = null;
  }

  await db.execute({
    sql: UPSERT_VOTE_SQL,
    args: [
      id,
      item.congress,
      item.sessionNumber,
      item.rollCallNumber,
      item.startDate,
      item.voteQuestion ?? null,
      item.voteType ?? null,
      item.result ?? null,
      billId,
      resolved.amendmentDesignation,
      totals.yea,
      totals.nay,
      totals.present,
      totals.notVoting,
      JSON.stringify(item),
      item.updateDate ?? item.startDate,
    ],
  });

  // Batch the member position writes so a 500-vote backfill doesn't turn
  // into 215k individual HTTP round-trips to Turso. Atomic per-vote: DELETE
  // + INSERTs together so a partial batch failure doesn't leave the vote
  // with half a roll-call.
  const stmts: { sql: string; args: (string | number)[] }[] = [
    { sql: "DELETE FROM member_votes WHERE vote_id = ?", args: [id] },
  ];
  let inserted = 0;
  for (const m of members) {
    if (!m.bioguideID) continue;
    const pos = normalizePosition(m.voteCast);
    if (!pos) continue;
    stmts.push({
      sql: `INSERT INTO member_votes (vote_id, bioguide_id, position)
            VALUES (?, ?, ?)`,
      args: [id, m.bioguideID, pos],
    });
    inserted++;
  }
  await db.batch(stmts, "write");
  return inserted;
}

export type RunVotesSyncOptions = {
  congress?: number;
  sessions?: number[];
  fromDate?: string;
};

export async function runVotesSync(
  opts: RunVotesSyncOptions = {},
): Promise<VotesSyncStats> {
  const apiKey = process.env.CONGRESS_API_KEY?.trim();
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const db = getDb();
  const congress = opts.congress ?? getCurrentCongress();
  const sessions = opts.sessions ?? [1, 2];
  const fromDate = opts.fromDate ?? (await getWatermark(db));
  const existing = await getExistingVoteIds(db, congress);

  console.log(
    `syncing house votes for congress=${congress} sessions=${sessions.join(",")} from ${fromDate} (already have ${existing.size})`,
  );

  const stats: VotesSyncStats = {
    sessionsSeen: [],
    votesSeen: 0,
    votesInserted: 0,
    votesSkipped: 0,
    votesFailed: 0,
    memberRowsInserted: 0,
    fromDate,
  };

  for (const session of sessions) {
    stats.sessionsSeen.push(session);
    let offset = 0;
    while (true) {
      const url = listUrl(congress, session, offset, apiKey);
      const page = await fetchJson<ListResponse>(url);
      await sleep(REQUEST_INTERVAL_MS);
      const votes = page.houseRollCallVotes ?? [];
      if (votes.length === 0) break;
      console.log(
        `session ${session} offset=${offset}: ${votes.length} votes (page total=${page.pagination?.count ?? "?"})`,
      );

      for (const lv of votes) {
        stats.votesSeen++;
        const id = voteId(lv.congress, lv.sessionNumber, lv.rollCallNumber);

        if (existing.has(id) && lv.startDate <= fromDate) {
          stats.votesSkipped++;
          continue;
        }

        try {
          const itemRes = await fetchJson<ItemResponse>(
            itemUrl(congress, session, lv.rollCallNumber, apiKey),
          );
          await sleep(REQUEST_INTERVAL_MS);
          const item = itemRes.houseRollCallVote;
          if (!item) {
            console.warn(`skip ${id}: item response missing payload`);
            stats.votesFailed++;
            continue;
          }

          const membersRes = await fetchJson<MembersResponse>(
            membersUrl(congress, session, lv.rollCallNumber, apiKey),
          );
          await sleep(REQUEST_INTERVAL_MS);
          const members =
            membersRes.houseRollCallVoteMemberVotes?.results ?? [];

          const inserted = await upsertVoteAndMembers(db, item, members);
          stats.votesInserted++;
          stats.memberRowsInserted += inserted;
        } catch (err) {
          console.error(`failed ${id}:`, (err as Error).message);
          stats.votesFailed++;
        }
      }

      if (votes.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  console.log(
    `done: seen=${stats.votesSeen} inserted=${stats.votesInserted} skipped=${stats.votesSkipped} failed=${stats.votesFailed} member_rows=${stats.memberRowsInserted}`,
  );
  return stats;
}
