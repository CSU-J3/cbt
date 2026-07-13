// HO 452 — read-only probe: does walking the per-amendment /actions sub-resource
// recover classifiable dispositions for the ~91% of amendments with no top-level
// latest_action_text? Measures cost + recovery rate, feeds the GO/NO-GO on the
// status/disposition model (HO 453). NO WRITES. Mirrors amendments-coverage-447's
// DB idiom + a minimal inline fetchJson (the sync's fetchJson is the reference,
// NOT imported — same low-blast-radius posture as HO 447).
//
//   npx tsx scripts/diagnostic/amendments-actions-probe-452.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const API_BASE = "https://api.congress.gov/v3";
const PER_REQUEST_TIMEOUT_MS = 15_000;
const PROBE_SLEEP_MS = 400; // cap-polite; independent of the 750ms cost projection
const SYNC_PACING_MS = 750; // the sync's per-detail sleep — the projection basis
const EXISTING_REQUESTS = 6788;
const EXISTING_MIN = 85;

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const many = async (sql: string, args: (string | number)[] = []) =>
  (await db.execute({ sql, args })).rows;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

const apiKey = process.env.CONGRESS_API_KEY;
if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");

interface ActionObj {
  actionDate?: string;
  text?: string;
  type?: string;
  actionCode?: string;
  sourceSystem?: { name?: string } | null;
  recordedVotes?: unknown[];
}

const latencies: number[] = [];
let throttle429 = 0;

async function fetchActions(
  congress: number,
  type: string,
  number: number,
  attempt = 0,
): Promise<ActionObj[]> {
  const params = new URLSearchParams({ format: "json", api_key: apiKey!, limit: "250" });
  const url = `${API_BASE}/amendment/${congress}/${String(type).toLowerCase()}/${number}/actions?${params.toString()}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
  });
  if (res.status === 429 && attempt < 3) {
    throttle429++;
    const wait = 2000 * (attempt + 1);
    console.warn(`  429 throttled — sleeping ${wait}ms`);
    await sleep(wait);
    return fetchActions(congress, type, number, attempt + 1);
  }
  const elapsed = Date.now() - t0;
  if (attempt === 0) latencies.push(elapsed);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as { actions?: ActionObj[] };
  return json.actions ?? [];
}

// --- Starter classifier (hypothesis to test; refine at build from the residual) ---
type Bucket = "agreed" | "failed" | "withdrawn" | "ruled_out_of_order" | "pending";
// Classify ONE action's text into a terminal disposition, or null if the text is
// not terminal (Submitted / Proposed / procedural noise). Order matters: failed
// families are tested before "agreed to" so "not agreed to" / "motion to table …
// agreed to" don't read as agreed.
function classifyAction(text: string | undefined): Exclude<Bucket, "pending"> | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\bwithdrawn\b/.test(t)) return "withdrawn";
  if (/point of order.*sustained|ruled out of order|\bfell\b/.test(t)) return "ruled_out_of_order";
  if (/\bnot agreed to\b|\brejected\b|motion to table.*\bagreed to\b/.test(t)) return "failed";
  if (/\bagreed to\b|\badopted\b|\bpassed\b/.test(t)) return "agreed";
  return null;
}

// The amendment's disposition = the LATEST-dated terminal action; pending if none.
function terminalDisposition(actions: ActionObj[]): { bucket: Bucket; text: string | null } {
  let best: { bucket: Exclude<Bucket, "pending">; date: string; text: string } | null = null;
  for (const a of actions) {
    const b = classifyAction(a.text);
    if (!b) continue;
    const date = a.actionDate ?? "";
    if (!best || date >= best.date) best = { bucket: b, date, text: a.text ?? "" };
  }
  return best ? { bucket: best.bucket, text: best.text } : { bucket: "pending", text: null };
}

// "Submitted/Proposed-only" = no action carries a terminal disposition AND every
// action is a submit/propose/procedural-referral line (genuinely filed-never-acted).
function isSubmittedOnly(actions: ActionObj[]): boolean {
  return actions.every((a) => classifyAction(a.text) === null);
}

const SUBMIT_PROPOSE_RE = /\bsubmitted\b|\bproposed\b|\breferred\b/;
// Latest-dated action's text (the amendment's most recent action).
function latestActionText(actions: ActionObj[]): string | null {
  let best: { date: string; text: string } | null = null;
  for (const a of actions) {
    if (!a.text) continue;
    const date = a.actionDate ?? "";
    if (!best || date >= best.date) best = { date, text: a.text };
  }
  return best?.text ?? null;
}

interface Stratum {
  key: string;
  label: string;
  n: number;
  where: string;
}
const STRATA: Stratum[] = [
  { key: "has_top_action", label: "has top-level latestAction (validate + tail)", n: 40, where: "latest_action_text IS NOT NULL" },
  { key: "no_top_nonmagnet", label: "no top action, non-magnet (the silent 91%)", n: 40, where: "latest_action_text IS NULL AND amended_bill_id != '119-sconres-7'" },
  { key: "no_top_sconres7", label: "no top action, 119-sconres-7 (DECISIVE vote-a-rama)", n: 45, where: "amended_bill_id = '119-sconres-7' AND latest_action_text IS NULL" },
  { key: "hamdt", label: "HAMDT (House action vocabulary)", n: 15, where: "amendment_type = 'HAMDT'" },
  { key: "sub_amendment", label: "sub-amendment (own action history?)", n: 15, where: "amends_amendment_id IS NOT NULL" },
];

interface Row {
  id: string;
  congress: number;
  type: string;
  number: number;
  latest_action_text: string | null;
}

const BUCKETS: Bucket[] = ["agreed", "failed", "withdrawn", "ruled_out_of_order", "pending"];

async function main() {
  console.log("=== amendment /actions walk probe (HO 452) — READ-ONLY ===\n");

  const rawDumps: string[] = [];
  const distinctTypes = new Set<string>();
  const distinctCodes = new Set<string>();
  let withRecordedVotes = 0;
  let totalFetched = 0;
  const residualCounts = new Map<string, number>();
  const globalBucket: Record<Bucket, number> = { agreed: 0, failed: 0, withdrawn: 0, ruled_out_of_order: 0, pending: 0 };
  // per-stratum recovery accounting
  const perStratum: {
    key: string; label: string; sampled: number; fetched: number;
    submittedOnly: number; terminal: number;
    buckets: Record<Bucket, number>;
    topAgree?: number; topDisagree?: number; // has_top_action only
    terminalTexts: Map<string, number>;
  }[] = [];

  for (const s of STRATA) {
    const rows = (await many(
      `SELECT id, congress, amendment_type AS type, amendment_number AS number, latest_action_text
       FROM amendments WHERE ${s.where} ORDER BY RANDOM() LIMIT ?`,
      [s.n],
    )) as unknown as Row[];

    const acc = {
      key: s.key, label: s.label, sampled: rows.length, fetched: 0,
      submittedOnly: 0, terminal: 0,
      buckets: { agreed: 0, failed: 0, withdrawn: 0, ruled_out_of_order: 0, pending: 0 } as Record<Bucket, number>,
      topAgree: 0, topDisagree: 0,
      terminalTexts: new Map<string, number>(),
    };

    process.stdout.write(`\n[${s.key}] n=${rows.length} `);
    for (const r of rows) {
      let actions: ActionObj[];
      try {
        actions = await fetchActions(r.congress, r.type, r.number);
      } catch (e) {
        process.stdout.write("x");
        console.warn(`\n  fetch fail ${r.id}: ${(e as Error).message}`);
        await sleep(PROBE_SLEEP_MS);
        continue;
      }
      totalFetched++;
      acc.fetched++;

      // payload structure sampling
      if (rawDumps.length < 3 && actions.length > 0) {
        rawDumps.push(`--- ${r.id} (${actions.length} actions) ---\n${JSON.stringify(actions.slice(0, 3), null, 2)}`);
      }
      for (const a of actions) {
        if (a.type) distinctTypes.add(a.type);
        if (a.actionCode) distinctCodes.add(a.actionCode);
        if (Array.isArray(a.recordedVotes) && a.recordedVotes.length > 0) withRecordedVotes++;
      }

      const submittedOnly = isSubmittedOnly(actions);
      if (submittedOnly) acc.submittedOnly++;
      const { bucket, text } = terminalDisposition(actions);
      acc.buckets[bucket]++;
      globalBucket[bucket]++;
      if (bucket !== "pending") {
        acc.terminal++;
        if (text) acc.terminalTexts.set(text, (acc.terminalTexts.get(text) ?? 0) + 1);
      } else {
        // Residual check: a "pending" whose latest action is NOT a plain
        // submit/propose line is a candidate my classifier missed — the signal
        // for whether the tail is messy or a clean deterministic map is possible.
        const last = latestActionText(actions);
        if (last && !SUBMIT_PROPOSE_RE.test(last.toLowerCase())) {
          residualCounts.set(last, (residualCounts.get(last) ?? 0) + 1);
        }
      }

      // has_top_action: does the walk's terminal agree with the top-level field?
      if (s.key === "has_top_action" && r.latest_action_text) {
        const topBucket = classifyAction(r.latest_action_text);
        if (topBucket && topBucket === bucket) acc.topAgree!++;
        else acc.topDisagree!++;
      }

      process.stdout.write(".");
      await sleep(PROBE_SLEEP_MS);
    }
    perStratum.push(acc);
  }
  console.log("\n");

  // ---------- A. COST ----------
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const p50 = p(0.5), p90 = p(0.9), max = sorted[sorted.length - 1] ?? 0;
  const addedMin = (EXISTING_REQUESTS * (p50 + SYNC_PACING_MS)) / 60000;
  console.log("=== A. COST ===");
  console.log(`fetches timed: ${latencies.length}  429s observed: ${throttle429}`);
  console.log(`per-request latency: p50 ${p50}ms · p90 ${p90}ms · max ${max}ms`);
  console.log(
    `projection: the walk adds ~${EXISTING_REQUESTS} requests / ~${addedMin.toFixed(0)} min ` +
      `(at p50 fetch ${p50}ms + ${SYNC_PACING_MS}ms pacing) on top of the existing ~${EXISTING_REQUESTS} / ~${EXISTING_MIN} min ` +
      `→ ~${(EXISTING_MIN + addedMin).toFixed(0)} min total backfill.`,
  );

  // ---------- B. PAYLOAD STRUCTURE ----------
  console.log("\n=== B. PAYLOAD STRUCTURE ===");
  console.log(`distinct action.type values (${distinctTypes.size}): ${[...distinctTypes].sort().join(", ") || "(none)"}`);
  console.log(`distinct action.actionCode values (${distinctCodes.size}): ${[...distinctCodes].sort().join(", ") || "(none)"}`);
  console.log(`actions carrying recordedVotes (roll-call → future vote link): ${withRecordedVotes} ${withRecordedVotes > 0 ? "*** BONUS: amendment→vote link available ***" : ""}`);
  console.log("\nraw action shapes (first 3 amendments, up to 3 actions each):");
  for (const d of rawDumps) console.log(d);

  // ---------- C. RECOVERY RATE ----------
  console.log("\n=== C. RECOVERY RATE (per stratum) ===");
  console.log("stratum".padEnd(34) + "fetched  submitted-only   terminal-disp   recovery");
  for (const a of perStratum) {
    const recovery = a.key.startsWith("no_top") ? pct(a.terminal, a.fetched) : "—";
    console.log(
      a.key.padEnd(34) +
        String(a.fetched).padEnd(9) +
        `${a.submittedOnly} (${pct(a.submittedOnly, a.fetched)})`.padEnd(17) +
        `${a.terminal} (${pct(a.terminal, a.fetched)})`.padEnd(16) +
        recovery,
    );
  }
  const topStratum = perStratum.find((a) => a.key === "has_top_action");
  if (topStratum) {
    console.log(
      `\nhas_top_action agreement: walk terminal == top-level disposition for ` +
        `${topStratum.topAgree}/${(topStratum.topAgree ?? 0) + (topStratum.topDisagree ?? 0)} classifiable`,
    );
  }

  // ---------- D. CLASSIFICATION + RESIDUAL ----------
  console.log("\n=== D. CLASSIFICATION SPLIT (global, n=" + totalFetched + ") ===");
  for (const b of BUCKETS) console.log(`  ${b.padEnd(20)} ${globalBucket[b]}  (${pct(globalBucket[b], totalFetched)})`);

  console.log("\n=== distinct terminal-action texts observed (per stratum) ===");
  for (const a of perStratum) {
    if (a.terminalTexts.size === 0) continue;
    console.log(`\n[${a.key}]`);
    const entries = [...a.terminalTexts.entries()].sort((x, y) => y[1] - x[1]);
    for (const [text, count] of entries) {
      const proposed = classifyAction(text);
      console.log(`  ×${count}  [${proposed}]  ${text.slice(0, 120)}`);
    }
  }

  console.log("\n=== RESIDUAL — 'pending' amendments whose LATEST action isn't submit/propose ===");
  console.log("(a non-empty list here = a terminal-ish action the starter map missed → the tail may be messy)");
  if (residualCounts.size > 0) {
    const entries = [...residualCounts.entries()].sort((x, y) => y[1] - x[1]);
    for (const [text, count] of entries) console.log(`  ×${count}  ${text.slice(0, 140)}`);
  } else {
    console.log("  (none: every 'pending' amendment's latest action is a plain submit/propose line — clean map, pending == genuinely filed-never-acted)");
  }

  db.close();
}

main().catch((e) => {
  console.error(`probe failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
