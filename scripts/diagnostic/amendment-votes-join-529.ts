// HO 529 — amendment → roll-call-vote join probe (READ-ONLY).
//
// The banked recordedVotes item (HO 452 QUEUED) assumes a member-level "how did
// each member vote on this amendment" surface needs an /actions walk to recover each
// voted amendment's roll-call number. This probe tests that premise: the `votes`
// table already stores `amendment_designation` (both syncs write it), so amendment
// roll-call votes with per-member positions may already be in the DB, joinable to
// `amendments` with a plain string match and ZERO backfill.
//
// Reports §A (join populated?), §B (format reality), §C (only if §A thin — the
// /actions fallback), §D (build-call numbers), then a verdict. No writes.
//
//   npx tsx scripts/diagnostic/amendment-votes-join-529.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

const API_BASE = "https://api.congress.gov/v3";

// Normalize a designation to compare across the two sources: uppercase the alpha
// prefix + strip leading zeros from the numeric suffix. Closes casing + zero-pad
// gaps in one (e.g. 'hamdt0123' and 'HAMDT123' both → 'HAMDT123').
function normDesig(s: string): string {
  const m = s.match(/^(\D*)(\d*)$/);
  if (!m) return s.toUpperCase();
  const alpha = (m[1] ?? "").toUpperCase();
  const digits = m[2] ?? "";
  return alpha + (digits ? String(parseInt(digits, 10)) : "");
}

type VoteRow = {
  id: string; // TEXT composite PK, e.g. 'senate-119-1-3' (NOT an integer)
  chamber: string;
  congress: number;
  session: number | null;
  roll_call: number | null;
  designation: string;
};
type AmdRow = {
  type: string;
  number: number;
  chamber: string;
  congress: number;
  amended_bill_id: string | null;
  acted: boolean;
};

async function main() {
  const db = getDb();

  // ── pull the two sides ──
  const vRes = await db.execute(
    `SELECT id, chamber, congress, session, roll_call, amendment_designation AS d
       FROM votes WHERE amendment_designation IS NOT NULL`,
  );
  const votes: VoteRow[] = vRes.rows.map((r) => ({
    id: String(r.id),
    chamber: String(r.chamber ?? ""),
    congress: Number(r.congress),
    session: r.session == null ? null : Number(r.session),
    roll_call: r.roll_call == null ? null : Number(r.roll_call),
    designation: String(r.d ?? ""),
  }));

  const aRes = await db.execute(
    `SELECT amendment_type AS t, amendment_number AS n, chamber, congress,
            amended_bill_id AS b, latest_action_text AS lat
       FROM amendments`,
  );
  const amds: AmdRow[] = aRes.rows.map((r) => ({
    type: String(r.t ?? ""),
    number: Number(r.n),
    chamber: String(r.chamber ?? ""),
    congress: Number(r.congress),
    amended_bill_id: (r.b as string | null) ?? null,
    acted: r.lat != null && String(r.lat).trim() !== "",
  }));

  // chamber vocab (a mismatch would silently break a chamber-scoped join)
  const vCh = new Set(votes.map((v) => v.chamber));
  const aCh = new Set(amds.map((a) => a.chamber));
  console.log("=== HO 529 amendment→vote join probe (READ-ONLY) ===\n");
  console.log(`votes.chamber vocab:      ${[...vCh].join(" | ")}`);
  console.log(`amendments.chamber vocab: ${[...aCh].join(" | ")}`);

  // Join keys. The designation already encodes chamber (HAMDT/SAMDT), so the
  // primary key is congress + normalized-designation (chamber-vocab-proof); we also
  // compute the chamber-scoped raw key the handoff named, to compare.
  const amdRawKeys = new Set<string>(); // congress~TYPE+NUM (exact)
  const amdNormKeys = new Set<string>(); // congress~norm(TYPE+NUM)
  const amdByNorm = new Map<string, AmdRow[]>(); // norm key → amendments
  for (const a of amds) {
    const desig = `${a.type}${a.number}`;
    const raw = `${a.congress}~${desig}`;
    const norm = `${a.congress}~${normDesig(desig)}`;
    amdRawKeys.add(raw);
    amdNormKeys.add(norm);
    (amdByNorm.get(norm) ?? amdByNorm.set(norm, []).get(norm)!).push(a);
  }

  // ── §A — is the join populated? ──
  console.log("\n--- §A  JOIN POPULATED? ---");
  const byChamber = new Map<string, number>();
  for (const v of votes) byChamber.set(v.chamber, (byChamber.get(v.chamber) ?? 0) + 1);
  console.log(`amendment-designation votes: ${votes.length}  {${[...byChamber].map(([c, n]) => `${c}:${n}`).join(", ")}}`);

  // (a) amendment-votes → amendments  (raw exact vs normalized)
  let vRaw = 0;
  let vNorm = 0;
  const voteToAmdNorm = new Map<string, string>(); // vote.id → matched norm key
  for (const v of votes) {
    const raw = `${v.congress}~${v.designation}`;
    const norm = `${v.congress}~${normDesig(v.designation)}`;
    if (amdRawKeys.has(raw)) vRaw++;
    if (amdNormKeys.has(norm)) {
      vNorm++;
      voteToAmdNorm.set(v.id, norm);
    }
  }
  const pct = (n: number, d: number) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "—");
  console.log(
    `(a) votes → amendments:  raw ${vRaw}/${votes.length} (${pct(vRaw, votes.length)})   normalized ${vNorm}/${votes.length} (${pct(vNorm, votes.length)})`,
  );
  console.log(
    `    (unmatched votes are expected in part — Senate amendment_designation also carries PN/TD nominations+treaties, not just amendments)`,
  );

  // amendments → votes coverage (the surface-defining direction). Build norm key →
  // matching vote ids.
  const votesByNorm = new Map<string, string[]>();
  for (const v of votes) {
    const norm = `${v.congress}~${normDesig(v.designation)}`;
    (votesByNorm.get(norm) ?? votesByNorm.set(norm, []).get(norm)!).push(v.id);
  }
  const amdHasVote = (a: AmdRow) =>
    votesByNorm.has(`${a.congress}~${normDesig(`${a.type}${a.number}`)}`);

  const acted = amds.filter((a) => a.acted);
  const actedWithVote = acted.filter(amdHasVote).length;
  const allWithVote = amds.filter(amdHasVote).length;
  console.log(
    `(b) acted amendments (latest_action_text set) with ≥1 vote:  ${actedWithVote}/${acted.length} (${pct(actedWithVote, acted.length)})`,
  );
  console.log(
    `(c) ALL amendments with ≥1 vote (true surface coverage):     ${allWithVote}/${amds.length} (${pct(allWithVote, amds.length)})`,
  );

  // (3) confirm member_votes exist on a handful of matched vote ids
  const sampleVoteIds = [...voteToAmdNorm.keys()].slice(0, 6);
  console.log("\n    member_votes present on matched vote rows (the per-member payoff):");
  for (const vid of sampleVoteIds) {
    const mv = await db.execute({
      sql: "SELECT COUNT(*) AS c FROM member_votes WHERE vote_id = ?",
      args: [vid],
    });
    console.log(`      vote ${vid}: ${Number(mv.rows[0]?.c ?? 0)} member_votes rows`);
  }

  // ── §B — format reality ──
  console.log("\n--- §B  FORMAT REALITY (designation vs reconstructed) ---");
  const seen = new Set<string>();
  let shownMatched = 0;
  let shownUnmatched = 0;
  for (const v of votes) {
    if (seen.has(v.designation)) continue;
    seen.add(v.designation);
    const norm = `${v.congress}~${normDesig(v.designation)}`;
    const amd = amdByNorm.get(norm)?.[0];
    if (amd && shownMatched < 12) {
      const recon = `${amd.type}${amd.number}`;
      const byteEq = v.designation === recon;
      console.log(
        `  MATCH  vote='${v.designation}'  amd='${recon}'  ${byteEq ? "(byte-equal)" : `(normalized: ${normDesig(v.designation)})`}`,
      );
      shownMatched++;
    } else if (!amd && shownUnmatched < 6) {
      console.log(`  MISS   vote='${v.designation}' (cong ${v.congress}, ${v.chamber}) — no amendment match`);
      shownUnmatched++;
    }
    if (shownMatched >= 12 && shownUnmatched >= 6) break;
  }

  // ── §D — build-call numbers ──
  console.log("\n--- §D  BUILD-CALL NUMBERS ---");
  const buildable = amds.filter(amdHasVote);
  const billRes = await db.execute("SELECT id FROM bills");
  const billIds = new Set(billRes.rows.map((r) => String(r.id)));
  const onTracked = buildable.filter(
    (a) => a.amended_bill_id != null && billIds.has(a.amended_bill_id),
  ).length;
  const splitOf = (rows: AmdRow[]) => {
    const m = new Map<string, number>();
    for (const a of rows) m.set(a.type, (m.get(a.type) ?? 0) + 1);
    return [...m].map(([t, n]) => `${t}:${n}`).join(", ");
  };
  // amendments mapping to MULTIPLE vote rows (re-vote / motion-to-reconsider)
  let multiVote = 0;
  let maxVotes = 0;
  for (const a of buildable) {
    const ids = votesByNorm.get(`${a.congress}~${normDesig(`${a.type}${a.number}`)}`) ?? [];
    if (ids.length > 1) multiVote++;
    if (ids.length > maxVotes) maxVotes = ids.length;
  }
  console.log(`total amendments:              ${amds.length}   {${splitOf(amds)}}`);
  console.log(`buildable (≥1 joined vote):    ${buildable.length}   {${splitOf(buildable)}}`);
  console.log(`  of those on tracked bills:   ${onTracked} (${pct(onTracked, buildable.length)})`);
  console.log(`amendments → MULTIPLE votes:   ${multiVote} (max ${maxVotes} vote rows on one amendment — surface must handle a list, not a scalar)`);

  // ── §E — the REAL cheap key: parse the amendment out of votes.question ──
  // §A found the `amendment_designation` COLUMN is dead for amendments (it holds
  // only Senate PN nominations; amendment votes carry NULL designation + NULL
  // bill_id). But the amendment identity sits in the QUESTION text — e.g. "On the
  // Amendment S.Amdt. 14 to S.Amdt. 8 to S. 5". The FIRST S/H.Amdt N is the
  // amendment being voted on. This is a query-only join off data already in the DB —
  // no /actions walk, no backfill.
  console.log("\n--- §E  TEXT-PARSE JOIN (votes.question → amendments) ---");
  const qRes = await db.execute(
    "SELECT id, congress, question FROM votes WHERE question LIKE '%Amdt%' OR question LIKE '%mendment%'",
  );
  const AMD_RE = /([SH])\.?\s?Amdt\.?\s*(?:No\.?\s*)?(\d+)/i;
  const textLinks = new Map<string, string[]>(); // congress~TYPE+num → vote ids
  let parsedVotes = 0;
  for (const r of qRes.rows) {
    const q = String(r.question ?? "");
    const m = q.match(AMD_RE);
    if (!m) continue;
    parsedVotes++;
    const type = (m[1] ?? "").toUpperCase() === "S" ? "SAMDT" : "HAMDT";
    const key = `${Number(r.congress)}~${type}${parseInt(m[2] ?? "0", 10)}`;
    (textLinks.get(key) ?? textLinks.set(key, []).get(key)!).push(String(r.id));
  }
  const amdHasTextVote = (a: AmdRow) => textLinks.has(`${a.congress}~${a.type}${a.number}`);
  const textBuildable = amds.filter(amdHasTextVote);
  const textActed = acted.filter(amdHasTextVote).length;
  const textOnTracked = textBuildable.filter(
    (a) => a.amended_bill_id != null && billIds.has(a.amended_bill_id),
  ).length;
  let textMulti = 0;
  let textMax = 0;
  for (const a of textBuildable) {
    const ids = textLinks.get(`${a.congress}~${a.type}${a.number}`) ?? [];
    if (ids.length > 1) textMulti++;
    if (ids.length > textMax) textMax = ids.length;
  }
  console.log(`votes whose question names an amendment (parsed): ${parsedVotes} of ${qRes.rows.length} amendment-mentioning`);
  console.log(`amendments with ≥1 text-parsed vote (BUILDABLE): ${textBuildable.length}/${amds.length} (${pct(textBuildable.length, amds.length)})   {${splitOf(textBuildable)}}`);
  console.log(`  acted amendments covered: ${textActed}/${acted.length} (${pct(textActed, acted.length)})`);
  console.log(`  of buildable, on tracked bills: ${textOnTracked} (${pct(textOnTracked, textBuildable.length)})`);
  console.log(`  amendments → MULTIPLE votes: ${textMulti} (max ${textMax} — re-vote/reconsider; surface handles a list)`);
  // member_votes present on a few text-linked vote rows (the per-member payoff)
  const textSampleIds = [...textLinks.values()]
    .slice(0, 5)
    .map((a) => a[0])
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  for (const vid of textSampleIds) {
    const mv = await db.execute({ sql: "SELECT COUNT(*) AS c FROM member_votes WHERE vote_id = ?", args: [vid] });
    console.log(`  vote ${vid}: ${Number(mv.rows[0]?.c ?? 0)} member_votes rows`);
  }

  // ── §C — /actions fallback (only if BOTH the designation join AND the text-parse
  // are thin) ──
  const actedCoverage = acted.length > 0 ? Math.max(actedWithVote, textActed) / acted.length : 1;
  const RUN_C = actedCoverage < 0.9;
  console.log("\n--- §C  /actions FALLBACK ---");
  if (!RUN_C) {
    console.log(
      `SKIPPED — §A is not thin (acted-amendment coverage ${pct(actedWithVote, acted.length)} ≥ 90%); the direct join carries the surface.`,
    );
  } else {
    const apiKey = process.env.CONGRESS_API_KEY;
    if (!apiKey) {
      console.log("SKIPPED — CONGRESS_API_KEY not set; cannot run the /actions sample.");
    } else {
      // all votes keyed for existence check (chamber-loose): congress~session~roll
      const allVotesRes = await db.execute(
        "SELECT chamber, congress, session, roll_call FROM votes",
      );
      const voteExists = new Set<string>();
      for (const r of allVotesRes.rows) {
        voteExists.add(
          `${Number(r.congress)}~${r.session == null ? "" : Number(r.session)}~${Number(r.roll_call)}`,
        );
      }
      // sample ~20 amendments: acted (latest_action_text mentions a vote) but NO join
      const voteWord = /agreed to|rejected|passed|failed|roll ?call|record vote|motion/i;
      // The TRUE walk-only residual: acted amendments that NEITHER the (dead)
      // designation join NOR the §E text-parse reaches — dominated by House HAMDTs
      // (question = generic "On Agreeing to the Amendment", no number). Prefer HAMDT
      // in the sample so we characterize exactly the set the walk is FOR.
      const candidates = acted
        .filter((a) => !amdHasVote(a) && !amdHasTextVote(a))
        .sort((a, b) => (a.type === "HAMDT" ? -1 : 0) - (b.type === "HAMDT" ? -1 : 0))
        .slice(0, 20);
      console.log(`sampling ${candidates.length} acted-but-unjoined amendments for /actions.recordedVotes…`);
      let resolvedToExisting = 0;
      let hadRecordedVote = 0;
      let noActionsVote = 0;
      for (const a of candidates) {
        try {
          const url = `${API_BASE}/amendment/${a.congress}/${a.type.toLowerCase()}/${a.number}/actions?${new URLSearchParams(
            { api_key: apiKey, format: "json", limit: "250" },
          )}`;
          const res = await fetch(url);
          if (!res.ok) {
            console.log(`  ${a.type}${a.number}: HTTP ${res.status}`);
            continue;
          }
          const json = (await res.json()) as {
            actions?: { recordedVotes?: { rollNumber?: number; chamber?: string; congress?: number; sessionNumber?: number }[] }[];
          };
          const rvs = (json.actions ?? []).flatMap((ac) => ac.recordedVotes ?? []);
          if (rvs.length === 0) {
            noActionsVote++;
            continue;
          }
          hadRecordedVote++;
          const resolved = rvs.some((rv) => {
            const key = `${rv.congress ?? a.congress}~${rv.sessionNumber ?? ""}~${rv.rollNumber}`;
            const keyNoSession = [...voteExists].some((k) => k.startsWith(`${rv.congress ?? a.congress}~`) && k.endsWith(`~${rv.rollNumber}`));
            return voteExists.has(key) || keyNoSession;
          });
          if (resolved) resolvedToExisting++;
          console.log(
            `  ${a.type}${a.number}: ${rvs.length} recordedVotes → roll ${rvs.map((r) => r.rollNumber).join(",")} → ${resolved ? "RESOLVES to existing votes row ✓" : "NOT in votes (sync gap)"}`,
          );
        } catch (e) {
          console.log(`  ${a.type}${a.number}: ERROR ${(e as Error).message}`);
        }
      }
      console.log(
        `\n  of ${candidates.length}: ${hadRecordedVote} had recordedVotes, ${resolvedToExisting} resolved to an EXISTING votes row, ${noActionsVote} had no recordedVotes (never voted).`,
      );
      console.log(
        resolvedToExisting > hadRecordedVote / 2
          ? "  → GO-WALK signal: /actions.rollNumber resolves to votes-already-present (linkage backfill, no member-vote backfill)."
          : "  → BLOCKED-ON-SYNC signal: the roll calls aren't in `votes` — needs a votes-sync extension, not an /actions walk.",
      );
    }
  }

  console.log("\n=== done — verdict in the summary below ===");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
