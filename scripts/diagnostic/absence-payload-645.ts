// HO 645 — the at-risk tier's two prices, measured rather than inherited.
// Read-only. BUILDS NOTHING, WRITES NOTHING.
//
// TWO QUESTIONS, and they are separate on purpose.
//
// M1/M2 — WHAT W = 8 COSTS TO READ. HO 642's probe found the counter-intuitive
// direction: narrowing the Phase A window makes Phase A CHEAPER, because the
// window IS the scan (an `IN (...)` over W vote ids), so a wider one reads more
// rows to return fewer candidates. That reading was taken on a different corpus,
// and a cost figure is a property of (query, corpus, cache state) rather than of
// the query — so it is re-measured here rather than quoted. Both windows are run
// against today's corpus, in the same session, so the delta is a comparison and
// not two readings from two days.
//
// M4 — WHAT THE BAND'S CACHED PAYLOAD WEIGHS. The backlog's absence-band payload
// entry set its own trigger — "band membership grows past a handful; at today's 2
// members the payload is not the problem it becomes at ten" — and commit B is
// that trigger firing. The ruling criterion, fixed at HO 645 §4 before the number
// existed: if the blob exceeds 2x its 15,481-byte post-HO-631 size, take the
// entry's named second move (the SQL-side count for getSponsorTopTopics) BEFORE
// shipping. If it does not, say so and re-price the trigger against the new
// population rather than leaving a clause that has already fired.
//
// M4 READS THE REAL CACHED BLOB, not a reconstruction. `getAbsenceWatch` cannot
// be called from a script — `unstable_cache` throws outside a request context and
// the helper's own guard turns that into `[]`, which would measure 2 bytes and
// look like an answer. So this walks `.next/cache/fetch-cache` and decodes the
// entry whose body IS an AbsentMember[]. Requires a server run that has populated
// it: `npx next start` (env sourced) and one request to `/`.
//
// WHY RAW HTTP AND NOT @libsql/client for M1/M2: `@libsql/client` v0.14.0 does
// not surface per-statement `rows_read`; Turso's hrana `/v2/pipeline` does.
// Technique lifted verbatim from absence-card-cost-630.ts / bills-agg-cost-624.ts
// — same DB, same credentials, read-only.
//
// THE INSTRUMENT'S TRAP, restated because it is easy to re-enter: a BARE
// `COUNT(*)` is answered from B-tree interior pages and under-reports scan cost
// by 227-416x (HO 624 M0). Every figure below is the real statement.
//
//   npx tsx scripts/diagnostic/absence-payload-645.ts
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// THE SQL BELOW IS COPIED VERBATIM FROM `lib/queries.ts::queryAbsenceWatch` AS OF
// HO 645 commit B. A verbatim copy is a dependency with no compiler edge and no
// test, so RECONCILE IT AGAINST THAT FUNCTION BEFORE TRUSTING A RE-RUN — a stale
// copy and a current one emit identical green (HO 554 -> 557).
const PARTICIPATION_FLOOR = 50;
const ABSENCE_STREAK_MIN = 30;
const ABSENCE_WARN_MIN = 8; // == ABSENCE_WINDOW, by construction
const ABSENCE_WALK_BOUND = 120;
const CHAMBERS = ["house", "senate"] as const;
const WINDOWS = [30, ABSENCE_WARN_MIN] as const; // the old W and the new one
const BASELINE_BYTES = 15_481; // the post-HO-631 reading the §4 criterion names

type Exec = { rows: unknown[][]; rowsRead: number; ms: number };

let httpUrl = "";
let token = "";

async function exec(sql: string, args: (string | number)[] = []): Promise<Exec> {
  const res = await fetch(`${httpUrl}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: {
            sql,
            args: args.map((a) =>
              typeof a === "number"
                ? { type: "integer", value: String(a) }
                : { type: "text", value: a },
            ),
          },
        },
        { type: "close" },
      ],
    }),
  });
  const j = (await res.json()) as {
    results?: { type: string; response?: { result?: Record<string, unknown> }; error?: unknown }[];
  };
  const r = j.results?.[0];
  if (!r || r.type !== "ok" || !r.response?.result) {
    throw new Error(
      `query failed: ${JSON.stringify(r?.error ?? r).slice(0, 400)}\n  sql: ${sql.slice(0, 200)}`,
    );
  }
  const q = r.response.result as {
    rows: { value: unknown }[][];
    rows_read: number;
    query_duration_ms: number;
  };
  return {
    rows: q.rows.map((row) => row.map((c) => c?.value)),
    rowsRead: q.rows_read,
    ms: q.query_duration_ms,
  };
}

const pad = (n: number | string, w: number) => String(n).padStart(w);

// ── M4 — the cached blob ────────────────────────────────────────────────────
// Identified by SHAPE rather than by key, because the cache key is a hash. The
// shape test is deliberately narrow (an array whose members carry bioguideId,
// streak and tier): a looser one would match some other member-shaped payload
// and report a confident wrong number, which is worse than reporting none.
type CachedBand = { bioguideId: string; streak: number; tier: string; card: unknown }[];

function findCachedBand(): { rows: CachedBand; bytes: number; file: string } | null {
  const dir = join(process.cwd(), ".next", "cache", "fetch-cache");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    let body: string;
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
        data?: { body?: string };
      };
      if (!raw.data?.body) continue;
      body = raw.data.body;
    } catch {
      continue;
    }
    // `data.body` is the RAW JSON string in this Next version, not base64 — the
    // base64 assumption silently decoded every entry into garbage and the probe
    // reported NOT FOUND, which reads exactly like "the blob does not exist".
    // Both encodings are tried so a Next upgrade cannot re-enter that.
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      try {
        body = Buffer.from(body, "base64").toString("utf8");
        parsed = JSON.parse(body);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(parsed) || parsed.length === 0) continue;
    const first = parsed[0] as Record<string, unknown>;
    if (
      typeof first?.bioguideId !== "string" ||
      typeof first?.streak !== "number" ||
      typeof first?.tier !== "string"
    )
      continue;
    return { rows: parsed as CachedBand, bytes: Buffer.byteLength(body, "utf8"), file: name };
  }
  return null;
}

async function main() {
  const raw = process.env.TURSO_DATABASE_URL ?? "";
  token = process.env.TURSO_AUTH_TOKEN ?? "";
  if (!raw || !token) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN required");
  httpUrl = raw.replace(/^libsql:/, "https:");

  console.log("=".repeat(96));
  console.log("HO 645 — W = 8 read cost + the band's cached payload. Read-only.");
  console.log("=".repeat(96));
  console.log(`  target: ${httpUrl.replace(/\/\/.*@/, "//")}\n`);

  // ── population, verbatim ──────────────────────────────────────────────────
  const popRes = await exec(
    `SELECT p.bioguide_id AS bioguideId, m.chamber AS chamber,
            p.total AS total, p.not_voting AS nv
       FROM member_participation p
       JOIN members m ON m.bioguide_id = p.bioguide_id
      WHERE m.is_current = 1
        AND p.total >= ?
        AND NOT (m.chamber = 'house'
                 AND m.state IN ('DC','AS','GU','MP','PR','VI'))`,
    [PARTICIPATION_FLOOR],
  );
  const chamberOf = new Map<string, string>();
  for (const r of popRes.rows) chamberOf.set(String(r[0]), String(r[1]));
  console.log(
    `  M0  population read              rows_read ${pad(popRes.rowsRead, 8)}  (${popRes.rows.length} floored members)\n`,
  );

  console.log("  M1/M2 — Phase A at each window, then Phase B, per chamber");
  console.log("  " + "-".repeat(92));

  const tiers: { bio: string; chamber: string; streak: number; tier: string }[] = [];

  for (const chamber of CHAMBERS) {
    const rollsRes = await exec(
      `SELECT id, vote_date FROM votes
        WHERE chamber = ?
        ORDER BY vote_date DESC, id DESC
        LIMIT ?`,
      [chamber, ABSENCE_WALK_BOUND],
    );
    const rollIds = rollsRes.rows.map((r) => String(r[0]));
    console.log(
      `  ${chamber.padEnd(7)} rolls read (bound ${ABSENCE_WALK_BOUND})   rows_read ${pad(rollsRes.rowsRead, 8)}  (${rollIds.length} rolls)`,
    );
    if (rollIds.length === 0) continue;

    let liveCandidates: string[] = [];
    for (const W of WINDOWS) {
      const windowIds = rollIds.slice(0, W);
      const ph = windowIds.map(() => "?").join(",");
      const cand = await exec(
        `SELECT bioguide_id AS bio,
                COUNT(*) AS n,
                SUM(CASE WHEN position = 'not_voting' THEN 1 ELSE 0 END) AS nv
           FROM member_votes
          WHERE vote_id IN (${ph})
          GROUP BY bioguide_id
         HAVING nv = n AND nv > 0`,
        windowIds,
      );
      const cands = cand.rows
        .map((r) => String(r[0]))
        .filter((bio) => chamberOf.get(bio) === chamber);
      const tag = W === ABSENCE_WARN_MIN ? "  <- SHIPPED" : "  (the old window)";
      console.log(
        `  ${chamber.padEnd(7)} Phase A  W=${pad(W, 2)}            rows_read ${pad(cand.rowsRead, 8)}  ${pad(cand.ms, 5)}ms  ${pad(cands.length, 2)} candidates${tag}`,
      );
      if (W === ABSENCE_WARN_MIN) liveCandidates = cands;
    }

    if (liveCandidates.length === 0) {
      console.log(`  ${chamber.padEnd(7)} Phase B                  skipped — no candidates at W=${ABSENCE_WARN_MIN}`);
      continue;
    }
    const candPh = liveCandidates.map(() => "?").join(",");
    const boundPh = rollIds.map(() => "?").join(",");
    const walk = await exec(
      `SELECT bioguide_id AS bio, vote_id AS voteId, position AS position
         FROM member_votes
        WHERE bioguide_id IN (${candPh})
          AND vote_id IN (${boundPh})`,
      [...liveCandidates, ...rollIds],
    );
    console.log(
      `  ${chamber.padEnd(7)} Phase B  bound=${ABSENCE_WALK_BOUND}         rows_read ${pad(walk.rowsRead, 8)}  ${pad(walk.ms, 5)}ms  (${walk.rows.length} position rows)`,
    );

    // The walk, verbatim, so the tier split below is the shipped rule's answer.
    const byMember = new Map<string, Map<string, string>>();
    for (const r of walk.rows) {
      const bio = String(r[0]);
      let m = byMember.get(bio);
      if (!m) {
        m = new Map();
        byMember.set(bio, m);
      }
      m.set(String(r[1]), String(r[2]));
    }
    for (const bio of liveCandidates) {
      const positions = byMember.get(bio);
      if (!positions) continue;
      let streak = 0;
      for (const id of rollIds) {
        const pos = positions.get(id);
        if (pos === undefined) continue;
        if (pos === "not_voting") {
          streak++;
          continue;
        }
        break;
      }
      if (streak < ABSENCE_WARN_MIN) continue;
      tiers.push({
        bio,
        chamber,
        streak,
        tier: streak >= ABSENCE_STREAK_MIN ? "mia" : "warn",
      });
    }
  }

  console.log("\n  M3 — the live tier split under the shipped rule");
  console.log("  " + "-".repeat(92));
  const mia = tiers.filter((t) => t.tier === "mia");
  const warn = tiers.filter((t) => t.tier === "warn");
  console.log(`  MIA (streak >= ${ABSENCE_STREAK_MIN}): ${mia.length}   AT RISK [${ABSENCE_WARN_MIN}, ${ABSENCE_STREAK_MIN}): ${warn.length}   pooled: ${tiers.length}`);
  for (const t of [...mia, ...warn].sort((a, b) => b.streak - a.streak))
    console.log(`    ${t.tier.padEnd(4)} ${t.bio}  ${t.chamber.padEnd(7)} streak ${t.streak}`);
  if (warn.length === 0)
    console.log(
      "    NOTE: the amber band is EMPTY on this corpus. An unexercised branch is\n" +
        "    unproven, not protection (HO 552) — fire it per HO 645 §2c before shipping.",
    );

  console.log("\n  M4 — the cached getAbsenceWatch blob");
  console.log("  " + "-".repeat(92));
  const cached = findCachedBand();
  if (!cached) {
    console.log(
      "  NOT FOUND in .next/cache/fetch-cache. This measures the REAL cached value, so it\n" +
        "  needs a server run that populated it: `npx next start` with env sourced, then one\n" +
        "  request to `/`. Reporting nothing beats reporting a reconstruction.",
    );
  } else {
    const ratio = cached.bytes / BASELINE_BYTES;
    const withCard = cached.rows.filter((r) => r.card !== null).length;
    // THE STALENESS TELL, and it is not optional. The Data Cache survives a
    // rebuild (HO 312), and `getAbsenceWatch`'s cache key does not include the
    // threshold constants — so after changing one, this directory still holds the
    // PREVIOUS answer and it reads exactly like a current one. Measured here
    // during HO 645: the entry left behind by the §2c falsification (S=40, Wilson
    // "warn") was still being reported after the revert to S=30 and a full
    // rebuild. So M4 prints the cached tier mix beside M3's live one and says so
    // when they disagree; the fix is to delete the entry and re-request `/`.
    const cachedMia = cached.rows.filter((r) => r.tier === "mia").length;
    const cachedWarn = cached.rows.filter((r) => r.tier === "warn").length;
    const agrees = cachedMia === mia.length && cachedWarn === warn.length;
    console.log(`  file            ${cached.file}`);
    console.log(
      `  cached tiers    mia ${cachedMia} / warn ${cachedWarn}   ${
        agrees
          ? "— agrees with M3"
          : `** STALE: M3 reads mia ${mia.length} / warn ${warn.length}. Delete this file and re-request / **`
      }`,
    );
    console.log(`  rows            ${cached.rows.length}  (${withCard} carrying a card bundle)`);
    console.log(`  bytes           ${cached.bytes.toLocaleString()}`);
    console.log(`  vs baseline     ${BASELINE_BYTES.toLocaleString()} bytes post-HO-631  ->  ${ratio.toFixed(2)}x`);
    console.log(
      `  §4 CRITERION    ${ratio > 2 ? "EXCEEDED (>2x) — take the getSponsorTopTopics SQL-side count BEFORE shipping" : "NOT exceeded (<=2x) — ship, and re-price the backlog trigger against the new population"}`,
    );
    console.log(`  per-member      ${Math.round(cached.bytes / Math.max(1, cached.rows.length)).toLocaleString()} bytes`);

    // BY ID, NOT BY TOTAL (§4). A byte total can coincide (HO 631), and the
    // question this answers is not "how big" but "how much of it does anything
    // read". AbsenceCardBack consumes exactly three things out of `card`:
    // committees[].name, the first three recentBills' type+number, and
    // stats.total. Everything else in the bundle is carried, cached and
    // serialized to render nothing.
    const CONSUMED = new Set(["stats", "recentBills", "committees"]);
    const keyBytes = new Map<string, number>();
    for (const row of cached.rows) {
      const card = (row as { card?: Record<string, unknown> | null }).card;
      if (!card) continue;
      for (const [k, v] of Object.entries(card))
        keyBytes.set(k, (keyBytes.get(k) ?? 0) + Buffer.byteLength(JSON.stringify(v) ?? "", "utf8"));
    }
    if (keyBytes.size > 0) {
      console.log("\n  card bundle, by key (the back reads * only, and only part of those):");
      for (const [k, b] of [...keyBytes].sort((a, b) => b[1] - a[1]))
        console.log(
          `    ${CONSUMED.has(k) ? "*" : " "} ${k.padEnd(13)} ${pad(b.toLocaleString(), 9)} bytes  ${pad(((b / cached.bytes) * 100).toFixed(1), 5)}% of blob`,
        );
    }
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
