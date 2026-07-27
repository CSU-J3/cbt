// HO 537 — materialize the Senate amendment→roll-call links into amendment_votes,
// making that table the single SYMMETRIC source of truth for "this amendment drew
// this roll call" across both chambers (House links land via the HO 532 walk).
//
// Three properties make this safe rather than speculative (HO 537):
//   1. The Senate parse is deterministic + already proven — it just moves the
//      HO 530 request-time parse to sync-time; it invents nothing.
//   2. NO API calls — both inputs (votes, amendments) are already synced, so the
//      link is derivable entirely in-DB. (Contrast the House walk, which pays
//      /actions GETs and needs the amendment_vote_walked_at sentinel.)
//   3. Pure recompute → rebuilds idempotently every tick. No sentinel, no cursor.
//
// The recompute is a FULL delete-then-insert scoped to Senate rows, atomic in ONE
// db.batch (the HO 483 precedent): self-healing against a stale link, and the batch
// closes the window where a reader would see fewer links. Senate rows are
// identified by JOINING votes.chamber='senate' — NOT a vote_id LIKE 'senate-%'
// id-format guess (the id prefix happens to work, but the column exists).
//
// NOTE: getBillAmendmentVotes still LIVE-PARSES the Senate path at request time
// (HO 537 out-of-scope: don't rewire that working surface). These materialized rows
// are read by the corpus aggregate (getAmendmentsSummary / getAmendments voted cut,
// HO 537 Commit 3), not by the bill hub. The shared leaf keeps the two honest.
import { getDb } from "./db";
import { SENATE_AMDT_QUESTION_LIKE, parseSenateAmendmentNumber } from "./amendment-vote-key";

// WalkResult-shaped (the lib/amendment-votes-walk.ts idiom).
export type SenateMaterializeResult = {
  scanned: number; // Senate amendment-question votes read
  matched: number; // votes resolving to a tracked SAMDT amendment
  linksWritten: number; // rows written (== matched after the full scoped delete)
  unmatchedQuestions: number; // parsed a number but no tracked amendment → corpus drift (log, don't throw)
  // Real delta vs the pre-existing Senate link set: added + removed. The recompute
  // rewrites every row every tick, so `linksWritten` is always the full count and
  // can't gate a revalidate honestly (it's always > 0). `changed` is the truthful
  // "did anything move" signal — 0 on a no-op tick — so the cron flushes the `votes`
  // tag (read by HO 535 participation queries) only when the set actually changed.
  changed: number;
};

export async function materializeSenateAmendmentVotes(): Promise<SenateMaterializeResult> {
  const db = getDb();

  // 1. SAMDT amendments keyed by (congress, number) → amendment id.
  const amdRs = await db.execute(
    "SELECT id, congress, amendment_number FROM amendments WHERE amendment_type = 'SAMDT'",
  );
  const amdByKey = new Map<string, string>();
  for (const r of amdRs.rows) {
    amdByKey.set(`${Number(r.congress)}~${Number(r.amendment_number)}`, String(r.id));
  }

  // 2. Senate up-or-down amendment-question votes — the SAME predicate + parser the
  //    request-time getBillAmendmentVotes uses, via the shared leaf (anti-drift).
  const voteRs = await db.execute({
    sql: `SELECT id, congress, question FROM votes WHERE chamber = 'senate' AND question LIKE ?`,
    args: [SENATE_AMDT_QUESTION_LIKE],
  });

  const links: { amendmentId: string; voteId: string }[] = [];
  let unmatchedQuestions = 0;
  for (const r of voteRs.rows) {
    const num = parseSenateAmendmentNumber(String(r.question ?? ""));
    if (num == null) {
      unmatchedQuestions++; // LIKE matched but the anchored regex didn't (defensive)
      continue;
    }
    const amdId = amdByKey.get(`${Number(r.congress)}~${num}`);
    if (!amdId) {
      unmatchedQuestions++; // parses but resolves to no tracked amendment — corpus drift
      continue;
    }
    links.push({ amendmentId: amdId, voteId: String(r.id) });
  }

  // 2b. Real delta: read the pre-existing Senate links (same votes.chamber join the
  //     scoped delete uses) and diff against the freshly-computed set, so the caller
  //     can revalidate only when something actually moved (the recompute always
  //     rewrites, so row-count can't tell us that).
  const existRs = await db.execute(
    `SELECT av.amendment_id, av.vote_id FROM amendment_votes av
       JOIN votes v ON v.id = av.vote_id WHERE v.chamber = 'senate'`,
  );
  const existing = new Set(existRs.rows.map((r) => `${String(r.amendment_id)}|${String(r.vote_id)}`));
  const computed = new Set(links.map((l) => `${l.amendmentId}|${l.voteId}`));
  let changed = 0;
  for (const k of computed) if (!existing.has(k)) changed++; // added
  for (const k of existing) if (!computed.has(k)) changed++; // removed

  // 3. Atomic delete-then-insert scoped to Senate rows (join votes.chamber). One
  //    batch → a reader never sees a shrunken set + a stale link self-heals. The
  //    scoped DELETE removes ONLY Senate vote_ids, so the HO 532 House (HAMDT)
  //    links are untouched. ON CONFLICT DO NOTHING mirrors the walk (belt-and-
  //    braces; after the delete there is no conflict to hit).
  const statements: { sql: string; args: (string | number)[] }[] = [
    {
      sql: `DELETE FROM amendment_votes WHERE vote_id IN (SELECT id FROM votes WHERE chamber = 'senate')`,
      args: [],
    },
    ...links.map((l) => ({
      sql: `INSERT INTO amendment_votes (amendment_id, vote_id) VALUES (?, ?)
            ON CONFLICT(amendment_id, vote_id) DO NOTHING`,
      args: [l.amendmentId, l.voteId] as (string | number)[],
    })),
  ];
  await db.batch(statements, "write");

  return {
    scanned: voteRs.rows.length,
    matched: links.length,
    linksWritten: links.length,
    unmatchedQuestions,
    changed,
  };
}
