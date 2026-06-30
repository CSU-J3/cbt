// FEC fundraising client (handoff 83). Talks to the openFEC API at
// api.open.fec.gov. Auth piggybacks on api.data.gov — `CONGRESS_API_KEY`
// works against FEC without a separate registration. If FEC stops sharing
// the api.data.gov key space, the script falls back to `FEC_API_KEY` env.
//
// Two responsibilities:
//   1. `resolveFecCandidateId(member, cycle)` — search candidates by state,
//      office, and last-name; return the best-matching candidate_id (or null).
//   2. `fetchFecTotals(candidateId, cycle)` — pull the cycle totals row,
//      return receipts/disbursements/cash_on_hand/debts in **cents** to match
//      the existing donor-pipeline cent convention (member_donors,
//      member_industries, member_fundraising — all INTEGER cents).
//
// Storage shape diverges from the handoff draft on purpose: we reuse the
// existing `member_fundraising` table (empty after the reverted OpenSecrets
// pass in HO 65) rather than introducing a parallel `fec_totals`. Same data
// model, already cents-aware, already has cycle in the PK. The handoff's
// `coverage_end_date` was added as an ALTER in scripts/migrate.ts.

const FEC_BASE = "https://api.open.fec.gov/v1";

// Resolved-key visibility (handoff 83 debug). Called once by sync-fec at
// startup so a misconfigured env shows up immediately, not 200 429s in.
export function logResolvedFecKey(): void {
  const k = fecApiKey();
  const source = process.env.FEC_API_KEY
    ? "FEC_API_KEY"
    : process.env.CONGRESS_API_KEY
      ? "CONGRESS_API_KEY"
      : "(neither set)";
  console.log(`FEC key source=${source} value=${maskApiKey(k)}`);
}

function fecApiKey(): string {
  return (
    process.env.FEC_API_KEY ?? process.env.CONGRESS_API_KEY ?? ""
  );
}

// Mask the API key for safe logging: keep first/last 4 chars, show length.
function maskApiKey(k: string): string {
  if (!k) return "(empty)";
  if (k.length <= 8) return "***";
  return `${k.slice(0, 4)}…${k.slice(-4)} (len=${k.length})`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson<T>(url: string, attempt = 0): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    if (attempt < 2) {
      await sleep(1500 * (attempt + 1));
      return fetchJson<T>(url, attempt + 1);
    }
    console.warn(`FEC network error: ${(err as Error).message}`);
    return null;
  }
  if (res.status === 429 && attempt < 3) {
    // FEC publishes a 1000/hr limit on api.data.gov keys; back off generously
    // because the daily run touches all ~544 members × 2 calls.
    const wait = 3000 * (attempt + 1);
    console.warn(`FEC 429, sleeping ${wait}ms`);
    await sleep(wait);
    return fetchJson<T>(url, attempt + 1);
  }
  if ((res.status === 502 || res.status === 503) && attempt < 2) {
    await sleep(2000 * (attempt + 1));
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    console.warn(`FEC ${res.status}: ${body.slice(0, 150)}`);
    return null;
  }
  return (await res.json()) as T;
}

type FecCandidate = {
  candidate_id: string;
  name: string; // "LAST, FIRST MIDDLE"
  state?: string;
  party?: string;
  office?: string;
  incumbent_challenge?: string; // "I" | "C" | "O"
  active_through?: number;
  candidate_inactive?: boolean;
  cycles?: number[];
};

type FecCandidatesResponse = {
  results?: FecCandidate[];
  pagination?: { count?: number };
};

function normalizeForMatch(s: string): string {
  // Strip diacritics, uppercase, drop non-letter/space — same fold used for
  // senate LIS matching in lib/lis-map.ts. Different reason (FEC stores
  // "LUJÁN" but the search is lossy on accents anyway), same primitive.
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, "")
    .trim();
}

// FEC names are "LAST, FIRST [MIDDLE [SUFFIX]]". Split on the comma BEFORE
// normalizing — `normalizeForMatch` strips punctuation, which would collapse
// the comma and merge LAST + FIRST into one indistinguishable string.
function parseFecName(fecName: string): { last: string; rest: string } {
  const comma = fecName.indexOf(",");
  if (comma === -1) {
    return { last: normalizeForMatch(fecName), rest: "" };
  }
  return {
    last: normalizeForMatch(fecName.slice(0, comma)),
    rest: normalizeForMatch(fecName.slice(comma + 1)),
  };
}

function memberLastFirst(memberLast: string, memberFirst: string): {
  last: string;
  first: string;
} {
  return {
    last: normalizeForMatch(memberLast),
    first: normalizeForMatch(memberFirst),
  };
}

// 0 = no match. Higher = better. Caller picks the highest score across
// all returned candidates and rejects 0.
function scoreCandidate(
  c: FecCandidate,
  memberLast: string,
  memberFirst: string,
): number {
  const fec = parseFecName(c.name);
  const m = memberLastFirst(memberLast, memberFirst);
  if (!fec.last || !m.last) return 0;
  if (fec.last !== m.last) return 0;

  let score = 1; // last-name match
  if (m.first && fec.rest.startsWith(m.first)) {
    score += 3; // first-name prefix (catches "ANGELA" vs "ANGELA D")
  } else if (m.first && fec.rest.includes(m.first)) {
    score += 1; // first appears anywhere
  }
  // Incumbent flag is a strong signal — current members usually file as 'I'
  if (c.incumbent_challenge === "I") score += 2;
  return score;
}

export type FecResolveInput = {
  lastName: string;
  firstName: string;
  state: string; // two-letter
  chamber: "house" | "senate";
  cycle: number;
};

// Tri-state result so the sync can distinguish "FEC has no candidate
// matching this name" (legit cache-as-no-match) from "the API couldn't
// answer" (do NOT cache — transient failures would lock the member out
// of fundraising data for STALE_DAYS). The earlier null/null collapse
// produced 215 false-negative cache rows the first time we hit the
// api.data.gov hourly cap mid-backfill.
export type ResolveOutcome =
  | { kind: "match"; candidateId: string }
  | { kind: "no_match" }
  | { kind: "api_error"; reason: string };

export async function resolveFecCandidateId(
  input: FecResolveInput,
): Promise<ResolveOutcome> {
  const apiKey = fecApiKey();
  if (!apiKey) {
    throw new Error("FEC_API_KEY or CONGRESS_API_KEY must be set");
  }
  const office = input.chamber === "senate" ? "S" : "H";
  // Search by state + office + cycle + last-name query. `q=` is a full-text
  // search across candidate names; passing the last name dramatically
  // narrows the result set (FEC has 4000+ candidates per cycle without it).
  //
  // `cycle=` (reporting cycle), NOT `election_year=`. Senators in office
  // but not up this cycle still report through FEC committees — Schumer
  // is in `cycles: [..., 2026]` but `election_years: [..., 2022, 2028]`,
  // so an `election_year=2026` filter would drop every non-up incumbent.
  const params = new URLSearchParams({
    state: input.state,
    office,
    cycle: String(input.cycle),
    q: input.lastName,
    per_page: "20",
    api_key: apiKey,
  });
  const url = `${FEC_BASE}/candidates/search/?${params.toString()}`;
  const json = await fetchJson<FecCandidatesResponse>(url);
  if (json === null) {
    // fetchJson returned null only on transient failure (network error,
    // 429 after retry budget, 4xx/5xx). Empty result set comes back as a
    // valid object with results=[].
    return { kind: "api_error", reason: "fetch_failed" };
  }
  const results = json.results ?? [];
  if (results.length === 0) return { kind: "no_match" };

  let best: FecCandidate | null = null;
  let bestScore = 0;
  for (const c of results) {
    const s = scoreCandidate(c, input.lastName, input.firstName);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best || bestScore === 0) return { kind: "no_match" };
  return { kind: "match", candidateId: best.candidate_id };
}

export type FecTotals = {
  candidateId: string;
  // All amounts in INTEGER cents to match the existing donor-pipeline storage
  // convention. FEC returns floats in dollars; we round and multiply at this
  // boundary so every downstream consumer can stay in cent space.
  totalRaised: number | null;
  totalSpent: number | null;
  cashOnHand: number | null;
  debts: number | null;
  coverageEndDate: string | null; // YYYY-MM-DD
  sourceUrl: string; // FEC candidate page (for member_fundraising.source_url)
};

type FecTotalsResponseRow = {
  candidate_id?: string;
  receipts?: number;
  disbursements?: number;
  last_cash_on_hand_end_period?: number;
  last_debts_owed_by_committee?: number;
  coverage_end_date?: string;
};

type FecTotalsResponse = { results?: FecTotalsResponseRow[] };

function dollarsToCents(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

function trimDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // FEC returns "2026-03-31T00:00:00" — strip the time.
  return iso.slice(0, 10);
}

// HO 390 — small/large-dollar split from Schedule A by_size, keyed on the
// candidate_id we already cache (the by_candidate endpoint aggregates across
// the candidate's authorized committees, so no committee-id resolution is
// needed — verified live, HO 390 probe). FEC's `size` bucket floors are
// 0/200/500/1000/2000; size=0 is the unitemized (<$200) small-dollar bucket,
// the rest are itemized $200+ large-dollar. Returns cents, or null on a
// transient API failure / no Schedule A rows (the caller leaves the columns
// untouched — honest gap, no fabricated split).
export type FecBySize = {
  smallDollar: number; // cents, FEC size bucket 0 (<$200 unitemized)
  largeDollar: number; // cents, itemized $200+ buckets summed
};

type FecBySizeRow = { size?: number; total?: number };
type FecBySizeResponse = { results?: FecBySizeRow[] };

export async function fetchFecBySize(
  candidateId: string,
  cycle: number,
): Promise<FecBySize | null> {
  const apiKey = fecApiKey();
  const params = new URLSearchParams({
    candidate_id: candidateId,
    cycle: String(cycle),
    per_page: "20",
    api_key: apiKey,
  });
  const url = `${FEC_BASE}/schedules/schedule_a/by_size/by_candidate/?${params.toString()}`;
  const json = await fetchJson<FecBySizeResponse>(url);
  if (json === null) return null; // transient failure — don't persist
  const rows = json.results ?? [];
  if (rows.length === 0) return null; // no Schedule A data — honest gap
  let small = 0;
  let large = 0;
  for (const r of rows) {
    const cents = dollarsToCents(r.total) ?? 0;
    if (r.size === 0) small += cents;
    else large += cents;
  }
  if (small + large === 0) return null; // nothing to show, skip the degenerate split
  return { smallDollar: small, largeDollar: large };
}

export async function fetchFecTotals(
  candidateId: string,
  cycle: number,
): Promise<FecTotals | null> {
  const apiKey = fecApiKey();
  const params = new URLSearchParams({
    cycle: String(cycle),
    per_page: "1",
    api_key: apiKey,
  });
  const url = `${FEC_BASE}/candidate/${encodeURIComponent(candidateId)}/totals/?${params.toString()}`;
  const json = await fetchJson<FecTotalsResponse>(url);
  const row = json?.results?.[0];
  if (!row) return null;
  return {
    candidateId,
    totalRaised: dollarsToCents(row.receipts),
    totalSpent: dollarsToCents(row.disbursements),
    cashOnHand: dollarsToCents(row.last_cash_on_hand_end_period),
    debts: dollarsToCents(row.last_debts_owed_by_committee),
    coverageEndDate: trimDate(row.coverage_end_date),
    sourceUrl: `https://www.fec.gov/data/candidate/${candidateId}/?cycle=${cycle}`,
  };
}
