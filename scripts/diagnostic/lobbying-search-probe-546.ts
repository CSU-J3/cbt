// HO 546 STEP 0 — /lobbying registrant/client search: cost + design probe (read-only).
// The last open HO 486 fbar cut (sort/bill-linked shipped HO 544; search left QUEUED).
// The backlog's close criterion assumes "lda_filings FTS, mirror bills_fts" — this
// probes that as a HYPOTHESIS against a FORK:
//
//   (A) FTS5 over lda_filings(registrant_name, client_name) — the backlog assumption.
//       Cost: over-indexes each firm's name once per filing (heavy repeat), + a write-
//       path trigger on a sync (lda-sync.ts) whose FLUSH_AT was already tuned 300→100.
//   (B) Distinct-entity search: names repeat heavily, ids (registrant_id/client_id)
//       already exist. Search the small distinct set / filter filings by id or a
//       plain-index name range — no FTS, no triggers, no populate, no new write risk.
//
// Measures the read-only ingredients for BOTH so the recommendation falls out of the
// numbers. NO build, NO migration, NO index, NO trigger, NO FTS table created — the
// trigger/populate WRITE cost for (A) is reasoned from the code + the read-side proxy;
// precisely measuring it would require building the FTS, which this read-only probe
// defers (and which (B) sidesteps entirely — its upside).
//
// Raw @libsql/client, NO boundedFetch (the 10s bound aborts a cold query and hides its
// true cost — the HO 540/543 lda-arc idiom). Read-only: SELECT / EXPLAIN only.
//
//   npx tsx scripts/diagnostic/lobbying-search-probe-546.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`   ⏱  ${label}: ${Date.now() - t0}ms`);
  return r;
}

async function explain(db: Client, sql: string, args: unknown[] = []): Promise<void> {
  const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args: args as never[] });
  for (const p of plan.rows) console.log(`      · ${(p as Row).detail}`);
}

function n(row: Row | undefined, key: string): number {
  return Number((row as Row)?.[key] ?? 0);
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.log("TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).");
    return 1;
  }
  const db: Client = createClient({ url, authToken });
  console.log("=== HO 546 STEP 0 — /lobbying registrant/client search cost + design ===\n");

  // ── CONTEXT ───────────────────────────────────────────────────────────────
  console.log("── context: corpus sizes ──");
  const nf = await timed("COUNT(*) lda_filings", () => db.execute(`SELECT COUNT(*) AS n FROM lda_filings`));
  const totalFilings = n(nf.rows[0], "n");
  console.log(`   lda_filings rows: ${totalFilings.toLocaleString()}`);
  const na = await db.execute(`SELECT COUNT(*) AS n FROM lda_activities`);
  console.log(`   lda_activities rows: ${n(na.rows[0], "n").toLocaleString()} (descriptions — out of scope)\n`);
  console.log("── indexes on lda_filings (is there one on id / name? — decides B's seek + A's need) ──");
  const idx = await db.execute(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='lda_filings'`);
  for (const r of idx.rows) console.log(`   · ${(r as Row).name}: ${(r as Row).sql ?? "(auto)"}`);
  console.log("");

  // ── FORK B: DISTINCT-ENTITY shape ─────────────────────────────────────────
  console.log("══ FORK B — distinct-entity search ══\n");
  console.log("── B1: distinct id / name cardinality + NULL-id share (the over-index factor + id reliability) ──");
  const card = await timed("distinct id/name + null counts (one pass)", () =>
    db.execute(`SELECT
        COUNT(DISTINCT registrant_id)   AS d_reg_id,
        COUNT(DISTINCT registrant_name) AS d_reg_nm,
        COUNT(DISTINCT client_id)       AS d_cli_id,
        COUNT(DISTINCT client_name)     AS d_cli_nm,
        SUM(CASE WHEN registrant_id   IS NULL THEN 1 ELSE 0 END) AS null_reg_id,
        SUM(CASE WHEN registrant_name IS NULL THEN 1 ELSE 0 END) AS null_reg_nm,
        SUM(CASE WHEN client_id       IS NULL THEN 1 ELSE 0 END) AS null_cli_id,
        SUM(CASE WHEN client_name     IS NULL THEN 1 ELSE 0 END) AS null_cli_nm
      FROM lda_filings`),
  );
  const c = card.rows[0] as Row;
  const dRegId = n(c, "d_reg_id"), dRegNm = n(c, "d_reg_nm"), dCliId = n(c, "d_cli_id"), dCliNm = n(c, "d_cli_nm");
  const pct = (x: number) => `${((x / totalFilings) * 100).toFixed(2)}%`;
  console.log(`   registrants: ${dRegId.toLocaleString()} distinct id · ${dRegNm.toLocaleString()} distinct name`);
  console.log(`   clients:     ${dCliId.toLocaleString()} distinct id · ${dCliNm.toLocaleString()} distinct name`);
  console.log(`   NULL registrant_id: ${n(c, "null_reg_id").toLocaleString()} (${pct(n(c, "null_reg_id"))}) · NULL registrant_name: ${n(c, "null_reg_nm").toLocaleString()} (${pct(n(c, "null_reg_nm"))})`);
  console.log(`   NULL client_id:     ${n(c, "null_cli_id").toLocaleString()} (${pct(n(c, "null_cli_id"))}) · NULL client_name:     ${n(c, "null_cli_nm").toLocaleString()} (${pct(n(c, "null_cli_nm"))})`);
  console.log(`   → FTS (A) indexes ${totalFilings.toLocaleString()} reg-name rows for ${dRegNm.toLocaleString()} distinct strings = ~${(totalFilings / Math.max(1, dRegNm)).toFixed(0)}× repeat`);
  console.log(`   → id↔name drift: ${dRegNm} distinct names vs ${dRegId} distinct ids (equal-ish = clean; name≫id = alias/typos)\n`);

  // representative high-frequency ids for the equality tests
  const topReg = await db.execute(`SELECT registrant_id, registrant_name, COUNT(*) AS c FROM lda_filings WHERE registrant_id IS NOT NULL GROUP BY registrant_id ORDER BY c DESC LIMIT 1`);
  const topRegId = n(topReg.rows[0], "registrant_id");
  const topRegNm = String((topReg.rows[0] as Row)?.registrant_name ?? "");
  const topRegCount = n(topReg.rows[0], "c");
  console.log(`── B2: WHERE registrant_id = ? (top firm: "${topRegNm}" id=${topRegId}, ${topRegCount.toLocaleString()} filings) ──`);
  await explain(db, `SELECT ${'*'} FROM lda_filings WHERE registrant_id = ? ORDER BY dt_posted DESC LIMIT 25`, [topRegId]);
  await timed("registrant_id equality + dt sort, LIMIT 25 (no index today → SCAN)", () =>
    db.execute({ sql: `SELECT filing_uuid, registrant_name, client_name, dt_posted FROM lda_filings WHERE registrant_id = ? ORDER BY dt_posted DESC LIMIT 25`, args: [topRegId] }),
  );
  console.log("   (with an additive idx_lda_filings_registrant_id this flips SCAN→SEARCH; equality-on-INTEGER seek is ~ms)\n");

  // ── B3: prefix search over names — the direct-feed shape (WHERE name LIKE 'term%') ──
  const prefix = topRegNm.slice(0, 4).toUpperCase();
  console.log(`── B3: WHERE registrant_name LIKE '${prefix}%' — direct-name feed (no name index today → SCAN) ──`);
  await explain(db, `SELECT filing_uuid FROM lda_filings WHERE registrant_name LIKE ? ORDER BY dt_posted DESC LIMIT 25`, [`${prefix}%`]);
  const likeFeed = await timed(`name LIKE '${prefix}%' feed, LIMIT 25`, () =>
    db.execute({ sql: `SELECT filing_uuid, registrant_name, dt_posted FROM lda_filings WHERE registrant_name LIKE ? ORDER BY dt_posted DESC LIMIT 25`, args: [`${prefix}%`] }),
  );
  console.log(`   matched (page 1): ${likeFeed.rows.length} rows`);
  await timed(`COUNT(*) name LIKE '${prefix}%' (pagination-total cost)`, () =>
    db.execute({ sql: `SELECT COUNT(*) AS n FROM lda_filings WHERE registrant_name LIKE ?`, args: [`${prefix}%`] }),
  );
  console.log("");

  console.log(`── B4: SELECT DISTINCT name LIKE '${prefix}%' — the "pick a firm" small-set search ──`);
  await explain(db, `SELECT DISTINCT registrant_name FROM lda_filings WHERE registrant_name LIKE ?`, [`${prefix}%`]);
  const distinctSearch = await timed(`DISTINCT registrant_name LIKE '${prefix}%'`, () =>
    db.execute({ sql: `SELECT DISTINCT registrant_name, registrant_id FROM lda_filings WHERE registrant_name LIKE ? LIMIT 25`, args: [`${prefix}%`] }),
  );
  console.log(`   distinct matches (cap 25): ${distinctSearch.rows.length}\n`);

  // ── FORK A: FTS-relevant read-only observables ────────────────────────────
  console.log("══ FORK A — FTS5 over names: read-only observables ══\n");
  console.log("── A1: name length (FTS index-size proxy vs bills' title+summary) ──");
  const lens = await db.execute(`SELECT
      AVG(LENGTH(registrant_name)) AS avg_reg, MAX(LENGTH(registrant_name)) AS max_reg,
      AVG(LENGTH(client_name)) AS avg_cli, MAX(LENGTH(client_name)) AS max_cli FROM lda_filings`);
  const L = lens.rows[0] as Row;
  console.log(`   registrant_name: avg ${Number(L.avg_reg).toFixed(0)} / max ${n(L, "max_reg")} chars · client_name: avg ${Number(L.avg_cli).toFixed(0)} / max ${n(L, "max_cli")} chars`);
  console.log(`   (bills_fts indexes title+summary — ~hundreds/thousands of chars; names are tiny, so per-row FTS cost ≪ bills)\n`);

  console.log("── A2: populate INPUT read cost (the SELECT side of a chunked populate; FTS-insert/tokenize adds on top) ──");
  const maxRowid = n((await db.execute(`SELECT COALESCE(MAX(rowid),0) AS m FROM lda_filings`)).rows[0], "m");
  console.log(`   MAX(rowid) = ${maxRowid.toLocaleString()}`);
  for (const chunk of [500, 2000]) {
    const mid = Math.floor(maxRowid / 2);
    await timed(`read rowid chunk of ${chunk} (name cols only)`, () =>
      db.execute({ sql: `SELECT rowid, registrant_name, client_name FROM lda_filings WHERE rowid > ? AND rowid <= ?`, args: [mid, mid + chunk] }),
    );
  }
  console.log(`   → full populate ≈ ceil(${maxRowid}/CHUNK) chunk-reads + FTS-insert; CHUNK should be re-measured against the 10s cap, NOT inherited from bills' 500\n`);

  console.log("── A3: write-path (triggers on lda-sync.ts) — REASONED from code, not built (read-only) ──");
  console.log("   lda-sync.ts: ON CONFLICT(filing_uuid) DO UPDATE, db.batch(chunk,'write') at FLUSH_AT=100 (tuned DOWN 300→100, HO 435,");
  console.log("   because a 300-stmt write txn blew the 10s cap under summarize-cron contention). An FTS AFTER UPDATE trigger = +2 FTS");
  console.log("   writes/row (delete-marker + reinsert) on top of the row write. The sync re-upserts the boundary day every run, so");
  console.log("   update-triggers fire on real traffic. Precise cost needs the FTS built (a WRITE) — deferred; counts AGAINST (A).\n");

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log("══ SUMMARY (numbers → recommendation in the report) ══");
  console.log(`   corpus: ${totalFilings.toLocaleString()} filings`);
  console.log(`   distinct registrants: ${dRegId.toLocaleString()} id / ${dRegNm.toLocaleString()} name · distinct clients: ${dCliId.toLocaleString()} id / ${dCliNm.toLocaleString()} name`);
  console.log(`   FTS(A) repeat factor ≈ ${(totalFilings / Math.max(1, dRegNm)).toFixed(0)}× (reg) / ${(totalFilings / Math.max(1, dCliNm)).toFixed(0)}× (client)`);
  console.log(`   NULL-id share: reg ${pct(n(c, "null_reg_id"))} / client ${pct(n(c, "null_cli_id"))}  (decides if B needs a name fallback)`);
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
