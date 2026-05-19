// Senate roll-call vote sync (handoff 80). Senate has no Congress.gov API
// coverage for votes, so we scrape the senate.gov LIS XML feeds:
//   - menu (per session):   /legislative/LIS/roll_call_lists/vote_menu_119_{S}.xml
//   - detail (per vote):    /legislative/LIS/roll_call_votes/vote119{S}/vote_119_{S}_{NNNNN}.xml
//
// Senate XML keys members by `lis_member_id` (e.g. "S428"). Our schema keys
// member_votes on bioguide_id, so we resolve via (last_name, state) from the
// already-synced `members` table — see lib/lis-map.ts for the why.
//
// The votes table is shared with House (chamber='senate' vs 'house'). vote.id
// follows the same shape: `senate-{congress}-{session}-{rollCall}`. positions
// are normalized to the same set ('yea'|'nay'|'present'|'not_voting').
//
// Watermark: MAX(roll_call) WHERE chamber='senate' AND session=? — we only
// re-fetch detail XML for vote numbers strictly greater than what we have,
// so reruns are cheap. menu XML returns newest-first; we reverse to ascend.
import { XMLParser } from "fast-xml-parser";
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";
import { buildSenatorResolver, type SenatorResolver } from "./lis-map";

// Polite delay between detail fetches. senate.gov publishes no rate limit
// but ~3-4 req/s is well within tolerance for their static XML.
const REQUEST_INTERVAL_MS = 300;

const BILL_TYPE_MAP: Record<string, string> = {
  "H.R.": "hr",
  "S.": "s",
  "H.J.Res.": "hjres",
  "S.J.Res.": "sjres",
  "H.Con.Res.": "hconres",
  "S.Con.Res.": "sconres",
  "H.Res.": "hres",
  "S.Res.": "sres",
};

type Db = ReturnType<typeof getDb>;

type MenuVote = {
  vote_number: string | number;
  vote_date?: string;
  issue?: string;
  question?: string;
  result?: string;
};

type DetailMember = {
  last_name?: string;
  first_name?: string;
  state?: string;
  party?: string;
  vote_cast?: string;
  lis_member_id?: string;
};

type DetailDocument = {
  document_type?: string;
  document_number?: string | number;
  document_name?: string;
};

type DetailVote = {
  congress?: string | number;
  session?: string | number;
  vote_number?: string | number;
  vote_date?: string;
  modify_date?: string;
  vote_question_text?: string;
  question?: string;
  vote_title?: string;
  vote_result?: string;
  vote_result_text?: string;
  document?: DetailDocument;
  count?: {
    yeas?: string | number;
    nays?: string | number;
    present?: string | number;
    absent?: string | number;
  };
  members?: { member?: DetailMember | DetailMember[] };
};

export type SenateVotesSyncStats = {
  sessionsSeen: number[];
  votesSeen: number;
  votesInserted: number;
  votesSkipped: number;
  votesFailed: number;
  memberRowsInserted: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function menuUrl(congress: number, session: number): string {
  return `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
}

function detailUrl(
  congress: number,
  session: number,
  paddedNum: string,
): string {
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${paddedNum}.xml`;
}

async function fetchXml(url: string, attempt = 0): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/xml" } });
  } catch (err) {
    if (attempt < 3) {
      const wait = 1500 * (attempt + 1);
      console.warn(
        `network error (${(err as Error).message}), sleeping ${wait}ms`,
      );
      await sleep(wait);
      return fetchXml(url, attempt + 1);
    }
    throw err;
  }
  if ((res.status === 502 || res.status === 503) && attempt < 3) {
    const wait = 1500 * (attempt + 1);
    console.warn(`${res.status} from senate.gov, sleeping ${wait}ms`);
    await sleep(wait);
    return fetchXml(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch ${url} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  return parser.parse(text);
}

function voteId(congress: number, session: number, rollCall: number): string {
  return `senate-${congress}-${session}-${rollCall}`;
}

// "January 9, 2025,  02:54 PM" -> ISO string. The XML doubles a space before
// the time in older entries; Date.parse handles both. Fall back to the raw
// string if parsing fails so we never lose the row to a date-format change.
function normalizeDate(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const ms = Date.parse(cleaned);
  if (Number.isNaN(ms)) return cleaned;
  return new Date(ms).toISOString();
}

function resolveBillReference(doc: DetailDocument | undefined, congress: number): {
  billId: string | null;
  amendmentDesignation: string | null;
} {
  if (!doc) return { billId: null, amendmentDesignation: null };
  const rawType = (doc.document_type ?? "").toString().trim();
  const rawNum = (doc.document_number ?? "").toString().trim();
  if (!rawType || !rawNum) return { billId: null, amendmentDesignation: null };
  const billType = BILL_TYPE_MAP[rawType];
  if (billType) {
    return {
      billId: `${congress}-${billType}-${rawNum}`,
      amendmentDesignation: null,
    };
  }
  // Non-bill document type (nomination PN, treaty TD, etc.) — keep the raw
  // designation for traceability.
  return {
    billId: null,
    amendmentDesignation: `${rawType}${rawNum}`,
  };
}

function normalizePosition(cast: string | undefined): string | null {
  if (!cast) return null;
  const c = cast.trim().toLowerCase();
  if (c === "yea" || c === "aye" || c === "yes") return "yea";
  if (c === "nay" || c === "no") return "nay";
  if (c === "present") return "present";
  if (c === "not voting" || c === "absent") return "not_voting";
  return null;
}

function toInt(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

async function getMaxRollCall(
  db: Db,
  congress: number,
  session: number,
): Promise<number> {
  const r = await db.execute({
    sql: `SELECT MAX(roll_call) AS m FROM votes
          WHERE chamber = 'senate' AND congress = ? AND session = ?`,
    args: [congress, session],
  });
  const m = r.rows[0]?.m as number | null | undefined;
  return typeof m === "number" ? m : 0;
}

const UPSERT_VOTE_SQL = `
INSERT INTO votes (
  id, chamber, congress, session, roll_call, vote_date,
  question, description, result, bill_id, amendment_designation,
  yea_count, nay_count, present_count, not_voting_count,
  raw_json, update_date
) VALUES (?, 'senate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  db: Db,
  congress: number,
  session: number,
  rollCall: number,
  detail: DetailVote,
  resolver: SenatorResolver,
): Promise<number> {
  const id = voteId(congress, session, rollCall);

  const { billId: rawBillId, amendmentDesignation } = resolveBillReference(
    detail.document,
    congress,
  );

  // Same FK guard as the house path — NULL the reference if the bill row
  // hasn't been synced yet so the vote upsert never blocks.
  let billId = rawBillId;
  if (billId) {
    const exists = await db.execute({
      sql: "SELECT 1 FROM bills WHERE id = ? LIMIT 1",
      args: [billId],
    });
    if (exists.rows.length === 0) billId = null;
  }

  const count = detail.count ?? {};
  const yea = toInt(count.yeas);
  const nay = toInt(count.nays);
  const present = toInt(count.present);
  const notVoting = toInt(count.absent);

  await db.execute({
    sql: UPSERT_VOTE_SQL,
    args: [
      id,
      congress,
      session,
      rollCall,
      normalizeDate(detail.vote_date),
      detail.vote_question_text ?? detail.question ?? null,
      detail.vote_title ?? null,
      detail.vote_result ?? detail.vote_result_text ?? null,
      billId,
      amendmentDesignation,
      yea,
      nay,
      present,
      notVoting,
      JSON.stringify(detail),
      normalizeDate(detail.modify_date ?? detail.vote_date),
    ],
  });

  const membersRaw = detail.members?.member;
  const memberArr: DetailMember[] = Array.isArray(membersRaw)
    ? membersRaw
    : membersRaw
      ? [membersRaw]
      : [];

  const stmts: { sql: string; args: (string | number)[] }[] = [
    { sql: "DELETE FROM member_votes WHERE vote_id = ?", args: [id] },
  ];
  let inserted = 0;
  for (const m of memberArr) {
    const lis = (m.lis_member_id ?? "").toString().trim();
    const last = (m.last_name ?? "").toString().trim();
    const st = (m.state ?? "").toString().trim();
    if (!last || !st) continue;
    const bioguide = resolver.resolve(lis, last, st);
    if (!bioguide) continue;
    const pos = normalizePosition(m.vote_cast);
    if (!pos) continue;
    stmts.push({
      sql: `INSERT INTO member_votes (vote_id, bioguide_id, position)
            VALUES (?, ?, ?)`,
      args: [id, bioguide, pos],
    });
    inserted++;
  }
  await db.batch(stmts, "write");
  return inserted;
}

export type RunSenateVotesSyncOptions = {
  congress?: number;
  sessions?: number[];
};

export async function runSenateVotesSync(
  opts: RunSenateVotesSyncOptions = {},
): Promise<SenateVotesSyncStats> {
  const db = getDb();
  const congress = opts.congress ?? getCurrentCongress();
  const sessions = opts.sessions ?? [1, 2];

  const resolver = await buildSenatorResolver(db);
  console.log(
    `senator resolver built: ${resolver.size()} senators in members table`,
  );

  const stats: SenateVotesSyncStats = {
    sessionsSeen: [],
    votesSeen: 0,
    votesInserted: 0,
    votesSkipped: 0,
    votesFailed: 0,
    memberRowsInserted: 0,
  };

  for (const session of sessions) {
    stats.sessionsSeen.push(session);
    console.log(`\nsyncing senate session ${session}...`);

    let menu: any;
    try {
      menu = await fetchXml(menuUrl(congress, session));
    } catch (err) {
      console.error(
        `session ${session} menu fetch failed (likely no votes yet): ${(err as Error).message}`,
      );
      continue;
    }

    const votesRaw = menu?.vote_summary?.votes?.vote ?? [];
    const menuVotes: MenuVote[] = Array.isArray(votesRaw) ? votesRaw : [votesRaw];
    if (menuVotes.length === 0) {
      console.log(`session ${session}: 0 votes in menu`);
      continue;
    }

    const lastNum = await getMaxRollCall(db, congress, session);
    console.log(
      `session ${session}: ${menuVotes.length} votes in menu, watermark roll_call=${lastNum}`,
    );

    // menu is newest-first; reverse so we fill forward in roll-call order.
    const ascending = [...menuVotes].reverse();

    for (const mv of ascending) {
      stats.votesSeen++;
      const rollInt = toInt(mv.vote_number);
      if (rollInt <= 0) continue;
      if (rollInt <= lastNum) {
        stats.votesSkipped++;
        continue;
      }
      const padded = String(rollInt).padStart(5, "0");
      const id = voteId(congress, session, rollInt);

      try {
        const detailDoc = await fetchXml(detailUrl(congress, session, padded));
        await sleep(REQUEST_INTERVAL_MS);
        const detail: DetailVote | undefined = detailDoc?.roll_call_vote;
        if (!detail) {
          console.warn(`skip ${id}: detail missing roll_call_vote`);
          stats.votesFailed++;
          continue;
        }
        const inserted = await upsertVoteAndMembers(
          db,
          congress,
          session,
          rollInt,
          detail,
          resolver,
        );
        stats.votesInserted++;
        stats.memberRowsInserted += inserted;
        if (stats.votesInserted % 25 === 0) {
          console.log(
            `  session ${session}: ${stats.votesInserted} upserted (last roll_call=${rollInt})`,
          );
        }
      } catch (err) {
        console.error(`failed ${id}:`, (err as Error).message);
        stats.votesFailed++;
      }
    }

    console.log(
      `session ${session} done: seen=${stats.votesSeen} inserted=${stats.votesInserted} skipped=${stats.votesSkipped} failed=${stats.votesFailed}`,
    );
  }

  console.log(
    `\nsenate vote sync complete: inserted=${stats.votesInserted} skipped=${stats.votesSkipped} failed=${stats.votesFailed} member_rows=${stats.memberRowsInserted}`,
  );
  return stats;
}
