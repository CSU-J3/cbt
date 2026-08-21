// HO 676 — the refresh path for `bill_cosponsors` and `bill_related_bills`.
//
// WHAT THIS WRITES, exactly:
//   bill_cosponsors        — one row per (bill_id, bioguide_id)
//   bill_related_bills     — one row per (bill_id, related_bill_id, relationship_type)
//   bill_roster_state      — one row per bill, the watermark
//   bills.cosponsor_count  — THAT COLUMN ONLY, and this module is its sole owner
// It writes NOTHING ELSE — no other column of `bills` is touched.
//
// The last line is new at HO 677 and REPLACES the opposite claim rather than
// amending it: this header used to read "`bills` is never touched — in
// particular `bills.cosponsor_count` is left exactly as it is (HO 676 scope),
// even though this module has the live count in hand and can see it disagree on
// 1,906 bills." That was true of HO 676 and is now false in both halves, so it
// is rewritten whole. `/api/sync` no longer writes the column (the omission is
// stated on its UPSERT_SQL, the HO 459 rule); the write site below carries the
// NULL rule and the reason there is no `bills` flush.
//
// READ-ONLY BY DEFAULT: `write` is opt-in. The CLI mirrors that with a
// `--write` flag; the cron route is the one caller that passes it, and says so
// at the call site.
//
// HO 674 ingested both rosters and HO 675 surfaced them; neither shipped a
// refresh, so until this module existed the only writer was a one-shot script
// and every bill `/api/sync` ingested arrived with an empty roster permanently.
//
// ── THE TRIGGERS, and why the obvious one is wrong ───────────────────────────
//
// T1 never-checked  — no `bill_roster_state` row. New bills, and the ONLY thing
//                     that separates "checked, empty" from "never looked":
//                     3,695 candidate bills carry zero roster rows, and under
//                     row-presence coverage they would sit at the head of the
//                     queue forever, unable to gain a row to exit on.
//
// T2 count-ahead    — the comparand is AHEAD of what we last stored AND has
//                     MOVED since we last compared against it. Both halves, and
//                     the pair is the whole finding of this HO. See
//                     `classifyTrigger` for the exact predicate and the two
//                     measurements that forced each half; in short:
//
//                       HO 674 STEP 0.4 specified `active roster <> count`.
//                       Measured, that selects 1,910 bills of which 1,906 are
//                       ones where the ROSTER is the fresher side — it never
//                       clears, because the stale half is `cosponsor_count`,
//                       which this HO is scoped out of repairing. Adding
//                       DIRECTION took it to 10 + 73.
//
//                       Direction alone still re-fired forever on 5 bills whose
//                       comparand is stale ABOVE the truth (a withdrawn
//                       cosponsor drops pagination.count while the stored column
//                       keeps the old value). Adding MOVEMENT took it to 0.
//
//                     GENERAL FORM, worth more than the fix: a trigger compared
//                     against a value you are not allowed to correct must fire
//                     on that value MOVING, not on it disagreeing with you.
//
// T3 sweep          — oldest `checked_at` first, bounded per tick. This is the
//                     workhorse, and the measurement is its justification: of
//                     1,089 bills that gained a LATER cosponsor in 30 days, only
//                     479 (44%) carry an `update_date` at or after that
//                     cosponsor's date. The other 56% move no updateDate, fire
//                     no re-upsert, and are invisible to any count-based
//                     trigger. The sweep is also the only path that reaches the
//                     3,799 bills storing `cosponsor_count` NULL — 109 of which
//                     have a roster anyway, so NULL is not reliably zero.
import { getDb } from "./db";
import {
  fetchCosponsors,
  fetchRelatedBills,
  type CosponsorRow,
  type RelatedBillRow,
} from "./bill-rosters-sync";

export type RefreshTrigger = "never-checked" | "count-ahead" | "sweep";

export type RefreshOptions = {
  /** Opt-in. Without it nothing is written — selection, fetch and diff only. */
  write?: boolean;
  /** Max bills touched this run. */
  cap?: number;
  /** Absolute wall-clock ms at which to stop STARTING new bills. */
  deadlineMs?: number;
  /** Pacing between bills. The backfill's 60ms; well inside 20,000/hr. */
  sleepMs?: number;
  /** A named slice, bypassing selection entirely (the STEP 3 gate). */
  billIds?: string[];
  signal?: AbortSignal;
};

export type RefreshResult = {
  mode: "check" | "write";
  /** Bills the selection returned (or the named slice's length). */
  selected: number;
  byTrigger: Record<RefreshTrigger, number>;
  fetched: number;
  requests: number;
  /**
   * THE FLUSH SIGNAL. Bills whose roster differed from what was stored AND were
   * written. It cannot be truthy while nothing was written, by a code boundary
   * rather than by convention: it is incremented inside the same branch that
   * executes the write, and that branch is selected by the diff being non-empty.
   *
   * NOT a row-write count. `INSERT OR REPLACE` rewrites every row of an
   * unchanged roster, so a row count would be non-zero on every tick and the
   * flush would be exactly the cost multiplier HO 671 removed.
   */
  changedBills: number;
  /** Bills that WOULD have been written, in check mode. Always 0 when writing. */
  wouldChangeBills: number;
  cosponsorRowsWritten: number;
  cosponsorRowsDeleted: number;
  relatedRowsWritten: number;
  relatedRowsDeleted: number;
  /**
   * Bills whose `bills.cosponsor_count` this run corrected (HO 677). Counted
   * separately from `changedBills` because the two move independently: a bill
   * whose roster did not change can still carry a stale column, and that is the
   * common case — 1,905 of 13,931 at the handover.
   */
  countsWritten: number;
  /** Bills whose watermark advanced (both fetches succeeded). */
  stamped: number;
  /** Bills left UNSTAMPED because a fetch threw — retried next tick (HO 552). */
  deferred: number;
  /** Bills whose fetched payload was empty against stored rows; no delete (HO 564). */
  emptyPayloadSkips: string[];
  deadlineHit: boolean;
  errors: string[];
};

type Candidate = {
  id: string;
  trigger: RefreshTrigger;
  storedActive: number | null;
  storedRelated: number | null;
  cosponsorCount: number | null;
  relatedCount: number | null;
  cosAtCheck: number | null;
  relAtCheck: number | null;
  checkedAt: string | null;
};

const DEFAULT_CAP = 120;
const DEFAULT_SLEEP_MS = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The stored shape of one cosponsor row, as a comparable key. */
const cosKey = (r: { bioguide_id: string; sponsorship_date: string | null; sponsorship_withdrawn_date: string | null; is_original: number }) =>
  `${r.bioguide_id}|${r.sponsorship_date ?? ""}|${r.sponsorship_withdrawn_date ?? ""}|${r.is_original}`;

/** The stored shape of one related-bill row, as a comparable key. */
const relKey = (r: { related_bill_id: string; relationship_type: string; identified_by: string | null }) =>
  `${r.related_bill_id}|${r.relationship_type}|${r.identified_by ?? ""}`;

/**
 * SELECTION. One statement, priority-ordered, no WHERE — the sweep needs every
 * bill in scope, so filtering would only remove its own tail.
 *
 * The `CASE` is the trigger ladder: never-checked first, then either half of the
 * directional count-ahead, then oldest-checked-first. Ties break on `id` so a
 * tick is reproducible.
 */
async function selectCandidates(cap: number): Promise<Candidate[]> {
  const db = getDb();
  const rs = await db.execute({
    sql: `
      SELECT b.id,
             b.cosponsor_count AS cos,
             CAST(json_extract(b.raw_json,'$.relatedBills.count') AS INTEGER) AS rb,
             s.bill_id IS NULL AS never_checked,
             s.active_count  AS s_active,
             s.related_count AS s_related,
             s.cosponsor_count_at_check AS s_cos_at,
             s.related_count_at_check   AS s_rel_at,
             s.checked_at    AS s_checked
      FROM bills b
      LEFT JOIN bill_roster_state s ON s.bill_id = b.id
      ORDER BY
        CASE
          WHEN s.bill_id IS NULL THEN 0
          WHEN b.cosponsor_count > s.active_count
               AND (s.cosponsor_count_at_check IS NULL
                    OR b.cosponsor_count <> s.cosponsor_count_at_check) THEN 1
          WHEN CAST(json_extract(b.raw_json,'$.relatedBills.count') AS INTEGER) > s.related_count
               AND (s.related_count_at_check IS NULL
                    OR CAST(json_extract(b.raw_json,'$.relatedBills.count') AS INTEGER)
                       <> s.related_count_at_check) THEN 1
          ELSE 2
        END,
        COALESCE(s.checked_at, '') ASC,
        b.id ASC
      LIMIT ?`,
    args: [cap],
  });
  return rs.rows.map((r) => {
    const storedActive = r.s_active == null ? null : Number(r.s_active);
    const storedRelated = r.s_related == null ? null : Number(r.s_related);
    const cosponsorCount = r.cos == null ? null : Number(r.cos);
    const relatedCount = r.rb == null ? null : Number(r.rb);
    const cosAtCheck = r.s_cos_at == null ? null : Number(r.s_cos_at);
    const relAtCheck = r.s_rel_at == null ? null : Number(r.s_rel_at);
    return {
      id: String(r.id),
      trigger: classifyTrigger(
        Number(r.never_checked) === 1,
        cosponsorCount,
        storedActive,
        cosAtCheck,
        relatedCount,
        storedRelated,
        relAtCheck,
      ),
      storedActive,
      storedRelated,
      cosponsorCount,
      relatedCount,
      cosAtCheck,
      relAtCheck,
      checkedAt: r.s_checked == null ? null : String(r.s_checked),
    };
  });
}

/** A named slice — the STEP 3 gate, and the CLI's `--bills`. */
async function loadNamed(ids: string[]): Promise<Candidate[]> {
  const db = getDb();
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rs = await db.execute({
    sql: `
      SELECT b.id,
             b.cosponsor_count AS cos,
             CAST(json_extract(b.raw_json,'$.relatedBills.count') AS INTEGER) AS rb,
             s.bill_id IS NULL AS never_checked,
             s.active_count AS s_active, s.related_count AS s_related,
             s.cosponsor_count_at_check AS s_cos_at, s.related_count_at_check AS s_rel_at,
             s.checked_at AS s_checked
      FROM bills b
      LEFT JOIN bill_roster_state s ON s.bill_id = b.id
      WHERE b.id IN (${placeholders})`,
    args: ids,
  });
  return rs.rows.map((r) => {
    const storedActive = r.s_active == null ? null : Number(r.s_active);
    const storedRelated = r.s_related == null ? null : Number(r.s_related);
    const cosponsorCount = r.cos == null ? null : Number(r.cos);
    const relatedCount = r.rb == null ? null : Number(r.rb);
    const cosAtCheck = r.s_cos_at == null ? null : Number(r.s_cos_at);
    const relAtCheck = r.s_rel_at == null ? null : Number(r.s_rel_at);
    return {
      id: String(r.id),
      // The SAME ladder the selection applies. A named slice bypasses selection,
      // but it must not therefore report every bill as a sweep — the label is
      // read back in the gate paste, and a label that cannot be wrong is not
      // worth printing.
      trigger: classifyTrigger(
        Number(r.never_checked) === 1,
        cosponsorCount,
        storedActive,
        cosAtCheck,
        relatedCount,
        storedRelated,
        relAtCheck,
      ),
      storedActive,
      storedRelated,
      cosponsorCount,
      relatedCount,
      cosAtCheck,
      relAtCheck,
      checkedAt: r.s_checked == null ? null : String(r.s_checked),
    };
  });
}

/**
 * The trigger ladder, shared by the selection and the named-slice path — kept in
 * ONE function precisely because the SQL above expresses the same rule a second
 * time. If the two ever disagree, the label in a gate paste stops describing the
 * tick that ran.
 *
 * BOTH HALVES ARE LOAD-BEARING, and the second was added at STEP 3 rather than
 * designed in:
 *
 *   DIRECTION (`count > stored`) keeps out the 1,906 bills whose ROSTER is the
 *   fresher side. Without it the trigger has no exit at all.
 *
 *   MOVEMENT (`count <> countAtCheck`) keeps out a bill whose comparand is stale
 *   ABOVE the truth. A fetch can lower `stored` toward reality but can never
 *   raise a wrong count to meet it, so direction alone still re-fires forever on
 *   those. HO 676's 30-bill slice found 5 — four where `bills.cosponsor_count`
 *   sits one above the true active roster (a cosponsor withdrew after the count
 *   was captured) and one where `$.relatedBills.count` reads 1 against an API
 *   returning 0 entries. All five had written nothing on the check that was
 *   supposed to settle them.
 *
 * NULL at-check means never compared: it fires once, then settles. THE GENERAL
 * FORM: a trigger against a value you are not allowed to correct fires on that
 * value MOVING, not on it disagreeing with you.
 */
function classifyTrigger(
  neverChecked: boolean,
  cosponsorCount: number | null,
  storedActive: number | null,
  cosAtCheck: number | null,
  relatedCount: number | null,
  storedRelated: number | null,
  relAtCheck: number | null,
): RefreshTrigger {
  if (neverChecked) return "never-checked";
  const cosFires =
    cosponsorCount != null &&
    storedActive != null &&
    cosponsorCount > storedActive &&
    (cosAtCheck == null || cosponsorCount !== cosAtCheck);
  const relFires =
    relatedCount != null &&
    storedRelated != null &&
    relatedCount > storedRelated &&
    (relAtCheck == null || relatedCount !== relAtCheck);
  return cosFires || relFires ? "count-ahead" : "sweep";
}

export async function refreshBillRosters(opts: RefreshOptions = {}): Promise<RefreshResult> {
  const apiKey = (process.env.CONGRESS_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const db = getDb();
  const write = opts.write === true;
  const cap = opts.cap ?? DEFAULT_CAP;
  const sleepMs = opts.sleepMs ?? DEFAULT_SLEEP_MS;
  const stamp = new Date().toISOString();

  const s: RefreshResult = {
    mode: write ? "write" : "check",
    selected: 0,
    byTrigger: { "never-checked": 0, "count-ahead": 0, sweep: 0 },
    fetched: 0,
    requests: 0,
    changedBills: 0,
    wouldChangeBills: 0,
    cosponsorRowsWritten: 0,
    cosponsorRowsDeleted: 0,
    relatedRowsWritten: 0,
    relatedRowsDeleted: 0,
    countsWritten: 0,
    stamped: 0,
    deferred: 0,
    emptyPayloadSkips: [],
    deadlineHit: false,
    errors: [],
  };

  const candidates = opts.billIds?.length ? await loadNamed(opts.billIds) : await selectCandidates(cap);
  s.selected = candidates.length;
  for (const c of candidates) s.byTrigger[c.trigger]++;

  for (const c of candidates) {
    if (opts.deadlineMs && Date.now() >= opts.deadlineMs) {
      s.deadlineHit = true;
      break;
    }

    // FETCH BOTH, always. The sweep exists precisely because the stored counts
    // are not a reliable signal, so gating the related fetch on a possibly-stale
    // `$.relatedBills.count` would reintroduce the blindness it is a backstop
    // for. Priced: ~2 requests per bill, ~1.4s per bill measured.
    let fetchedCos: CosponsorRow[];
    let fetchedRel: RelatedBillRow[];
    let seenActive: number;
    let seenRelated: number;
    try {
      const fc = await fetchCosponsors(c.id, apiKey, opts.signal);
      s.requests += fc.requests;
      fetchedCos = fc.rows;
      const fr = await fetchRelatedBills(c.id, apiKey, opts.signal);
      s.requests += fr.requests;
      fetchedRel = fr.rows;

      // THE WATERMARK'S COUNTS ARE THE API'S OWN, NOT WHAT SURVIVED OUR PARSE,
      // and that is the same trap as T2's direction one level down. The
      // comparands are `bills.cosponsor_count` (sourced from the detail
      // endpoint's `$.cosponsors.count`) and `$.relatedBills.count`, so what is
      // stored has to be the number the API reports, not the number of rows the
      // table ended up with. Store a parsed count instead and any bill where a
      // row is legitimately dropped — a cosponsor with no bioguideId, a
      // relationship entry with no type, or the 1-in-167 case where two API
      // entries share this table's primary key (`identified_by` is lossy by
      // ruling, HO 674) — reads permanently behind and is re-selected every
      // tick forever. `pagination.count` on the cosponsors endpoint already
      // EXCLUDES withdrawals, which is exactly the active comparand.
      seenActive = fc.activeCount ?? fc.rows.filter((r) => !r.sponsorship_withdrawn_date).length;
      seenRelated = fr.relationshipCount ?? fr.rows.length;
    } catch (e) {
      // DEFERRED, NOT STAMPED. A bill we could not evaluate keeps its old
      // watermark and is re-selected next tick (HO 552). Stamping here would
      // convert a transient failure into a permanent one, because the sweep
      // orders on checked_at and a stamped bill goes to the back of the queue.
      s.deferred++;
      s.errors.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
      await sleep(sleepMs);
      continue;
    }
    s.fetched++;

    const stored = await db.batch(
      [
        {
          sql: `SELECT bioguide_id, sponsorship_date, sponsorship_withdrawn_date, is_original
                FROM bill_cosponsors WHERE bill_id = ?`,
          args: [c.id],
        },
        {
          sql: `SELECT related_bill_id, relationship_type, identified_by
                FROM bill_related_bills WHERE bill_id = ?`,
          args: [c.id],
        },
      ],
      "read",
    );

    const storedCos = new Set(
      (stored[0]?.rows ?? []).map((r) =>
        cosKey({
          bioguide_id: String(r.bioguide_id),
          sponsorship_date: r.sponsorship_date == null ? null : String(r.sponsorship_date),
          sponsorship_withdrawn_date:
            r.sponsorship_withdrawn_date == null ? null : String(r.sponsorship_withdrawn_date),
          is_original: Number(r.is_original),
        }),
      ),
    );
    const storedRel = new Set(
      (stored[1]?.rows ?? []).map((r) =>
        relKey({
          related_bill_id: String(r.related_bill_id),
          relationship_type: String(r.relationship_type),
          identified_by: r.identified_by == null ? null : String(r.identified_by),
        }),
      ),
    );

    // Fetched rows keyed by their PRIMARY KEY, last write winning — mirroring
    // what the table would hold, since `identified_by` is lossy by ruling
    // (HO 674) and two API entries can share this table's PK.
    const fetchedCosByPk = new Map<string, CosponsorRow>();
    for (const r of fetchedCos) fetchedCosByPk.set(`${r.bill_id}|${r.bioguide_id}`, r);
    const fetchedRelByPk = new Map<string, RelatedBillRow>();
    for (const r of fetchedRel) {
      fetchedRelByPk.set(`${r.bill_id}|${r.related_bill_id}|${r.relationship_type}`, r);
    }

    const fetchedCosKeys = new Set([...fetchedCosByPk.values()].map(cosKey));
    const fetchedRelKeys = new Set([...fetchedRelByPk.values()].map(relKey));

    const cosAdds = [...fetchedCosByPk.values()].filter((r) => !storedCos.has(cosKey(r)));
    const relAdds = [...fetchedRelByPk.values()].filter((r) => !storedRel.has(relKey(r)));
    const cosGone = [...storedCos].filter((k) => !fetchedCosKeys.has(k));
    const relGone = [...storedRel].filter((k) => !fetchedRelKeys.has(k));

    // A DELETE REQUIRES AN AUTHORITATIVE NON-EMPTY PAYLOAD (HO 564). An empty
    // fetch against stored rows is absence of evidence, not evidence of absence
    // — it leaves the rows alone, reports itself, and still stamps, because the
    // bill WAS checked.
    const mayDeleteCos = fetchedCosByPk.size > 0;
    const mayDeleteRel = fetchedRelByPk.size > 0;
    if ((!mayDeleteCos && cosGone.length) || (!mayDeleteRel && relGone.length)) {
      s.emptyPayloadSkips.push(c.id);
    }

    const willDeleteCos = mayDeleteCos && cosGone.length > 0;
    const willDeleteRel = mayDeleteRel && relGone.length > 0;
    const changed = cosAdds.length > 0 || relAdds.length > 0 || willDeleteCos || willDeleteRel;

    if (changed && write) {
      // Per-bill delete-then-replace, scoped by bill_id. One batch per table;
      // the two are not atomic with EACH OTHER, and that is visible and
      // self-healing rather than merely tolerated: the watermark is stamped
      // last, so a throw between them leaves the bill unstamped, it is
      // re-selected next tick, and the re-write is idempotent on the composite
      // PKs. (Contrast summarize, HO 671, where the throw path skips the flush
      // its committed write needed.)
      const ops: { sql: string; args: (string | number | null)[] }[] = [];
      if (willDeleteCos) {
        ops.push({
          sql: `DELETE FROM bill_cosponsors WHERE bill_id = ? AND bioguide_id NOT IN (${
            [...fetchedCosByPk.values()].map(() => "?").join(",")
          })`,
          args: [c.id, ...[...fetchedCosByPk.values()].map((r) => r.bioguide_id)],
        });
      }
      for (const r of fetchedCosByPk.values()) {
        ops.push({
          sql: `INSERT OR REPLACE INTO bill_cosponsors
                  (bill_id, bioguide_id, sponsorship_date,
                   sponsorship_withdrawn_date, is_original, ingested_at)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            r.bill_id,
            r.bioguide_id,
            r.sponsorship_date,
            r.sponsorship_withdrawn_date,
            r.is_original,
            stamp,
          ],
        });
      }
      if (ops.length) {
        await db.batch(ops, "write");
        s.cosponsorRowsWritten += fetchedCosByPk.size;
        if (willDeleteCos) s.cosponsorRowsDeleted += cosGone.length;
      }

      const relOps: { sql: string; args: (string | number | null)[] }[] = [];
      if (willDeleteRel) {
        // Scoped on the composite key, not a bill_id wipe: a relationship this
        // fetch did not return is removed, everything else is left standing.
        for (const k of relGone) {
          const [relatedId, type] = k.split("|");
          relOps.push({
            sql: `DELETE FROM bill_related_bills
                  WHERE bill_id = ? AND related_bill_id = ? AND relationship_type = ?`,
            args: [c.id, relatedId ?? "", type ?? ""],
          });
        }
      }
      for (const r of fetchedRelByPk.values()) {
        relOps.push({
          sql: `INSERT OR REPLACE INTO bill_related_bills
                  (bill_id, related_bill_id, relationship_type, identified_by, ingested_at)
                VALUES (?, ?, ?, ?, ?)`,
          args: [r.bill_id, r.related_bill_id, r.relationship_type, r.identified_by, stamp],
        });
      }
      if (relOps.length) {
        await db.batch(relOps, "write");
        s.relatedRowsWritten += fetchedRelByPk.size;
        if (willDeleteRel) s.relatedRowsDeleted += relGone.length;
      }

      s.changedBills++;
    } else if (changed) {
      s.wouldChangeBills++;
    }

    if (write) {
      // STAMPED LAST, and only here — both fetches succeeded to reach this line.
      // `changed_at` is COALESCEd so an unchanged check advances `checked_at`
      // without erasing when the roster last actually moved.
      await db.execute({
        sql: `INSERT INTO bill_roster_state
                (bill_id, checked_at, active_count, related_count, changed_at,
                 cosponsor_count_at_check, related_count_at_check)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(bill_id) DO UPDATE SET
                checked_at    = excluded.checked_at,
                active_count  = excluded.active_count,
                related_count = excluded.related_count,
                changed_at    = COALESCE(excluded.changed_at, bill_roster_state.changed_at),
                cosponsor_count_at_check = excluded.cosponsor_count_at_check,
                related_count_at_check   = excluded.related_count_at_check`,
        // The comparands AS THEY READ FOR THIS CHECK, carried from the candidate
        // row the selection returned rather than re-read here — so what is
        // recorded is what was actually compared against.
        args: [
          c.id,
          stamp,
          seenActive,
          seenRelated,
          changed ? stamp : null,
          c.cosponsorCount,
          c.relatedCount,
        ],
      });
      s.stamped++;

      // ── HO 677 — THIS MODULE OWNS `bills.cosponsor_count` ──────────────────
      // `/api/sync` no longer writes it (see the omission comment on its
      // UPSERT_SQL). Written from `seenActive`, the same `pagination.count` the
      // watermark caches, so the column and `bill_roster_state.active_count`
      // cannot drift apart by construction.
      //
      // NULL WHEN ZERO, ruled at HO 677 STEP 0.5. No bill in the corpus has ever
      // stored `0` — NULL already IS the zero — so writing `0` would invent a
      // third state and flip the panel's `cosponsor_count != null` gate true on
      // 3,690 bills, rendering an empty COSPONSORS row nobody asked for. The
      // ambiguity NULL used to carry is now resolved in the DATA MODEL instead:
      // `active_count = 0` beside a `checked_at` is a VERIFIED zero, where the
      // column alone could only say "the API omitted the key".
      //
      // Written only on a difference — the write is the exception, not the tick.
      //
      // NO `revalidateTag("bills")` HERE, DELIBERATELY. The corrected value is
      // read through the feed row payload (`SPONSOR_ENRICH_SELECT`, tag `bills`,
      // `revalidate: 86400` — a backstop, not a refresh path), so it surfaces on
      // the next `bills` flush: ~7.3/day, mean gap ~3.3h (HO 672). Flushing here
      // would add up to 8 scheduled flushes/day at ~89,090 rows each to correct a
      // handful of bills, which is exactly the multiplier HO 671 removed from
      // summarize. The one-shot reconcile flushes once; the steady state waits.
      const newCount = seenActive > 0 ? seenActive : null;
      if ((c.cosponsorCount ?? null) !== newCount) {
        await db.execute({
          sql: `UPDATE bills SET cosponsor_count = ? WHERE id = ?`,
          args: [newCount, c.id],
        });
        s.countsWritten++;
      }
    }

    await sleep(sleepMs);
  }

  return s;
}
