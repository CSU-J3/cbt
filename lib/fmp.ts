// Financial Modeling Prep (FMP) client for congressional stock-trade
// disclosures (handoff 70). Single module, no class wrapper — mirrors the
// shape of lib/congress.ts.
//
// FMP free tier: 250 calls/day. Our sync uses 1-3 calls per chamber per
// tick. The /api/v4/ paths (senate-trading + senate-disclosure) were
// retired; current paths live under /stable/. The `-latest` endpoints
// return the most recent disclosures rather than the full archive — what
// our incremental sync wants anyway.

const BASE = "https://financialmodelingprep.com/stable";

// Endpoint paths centralized so a future docs rename only touches one place.
const SENATE_ENDPOINT = "senate-latest";
const HOUSE_ENDPOINT = "house-latest";

export type FmpTrade = {
  // Fields we actually consume — everything else stays in raw_json. FMP
  // sometimes returns keys in different casings across endpoints, so the
  // accessor below normalizes lazily.
  firstName?: string | null;
  lastName?: string | null;
  office?: string | null;
  symbol?: string | null;
  ticker?: string | null;
  assetDescription?: string | null;
  type?: string | null;
  transactionType?: string | null;
  transactionDate?: string | null;
  disclosureDate?: string | null;
  amount?: string | null;
  owner?: string | null;
  representative?: string | null;
  senator?: string | null;
  // Catch-all so callers can pull other fields without losing them.
  [key: string]: unknown;
};

// FMP's Free plan permits `page=0` only. Any `page>=1` request returns a 402
// whose body reads "...The values for 'page' can only be 0 based on your
// current subscription." (HO 579). This is an entitlement gate, not a rate
// limit — it fires regardless of quota (the usage meter reads 0/250 while it
// happens) and is permanent on the current plan, so page 0's data is still
// captured on every tick. It is distinguished from a genuine 402 so the page
// loop can stop cleanly without recording a failure. See `isFmpPlanBoundary`
// for the exact predicate.
export class FmpPlanBoundaryError extends Error {
  readonly endpoint: string;
  readonly page: number;
  constructor(endpoint: string, page: number, body: string) {
    super(
      `FMP ${endpoint} page ${page} beyond Free-plan page-0 boundary (402): ${body.slice(0, 200)}`,
    );
    this.name = "FmpPlanBoundaryError";
    this.endpoint = endpoint;
    this.page = page;
  }
}

// Only true for the page-parameter plan gate. A 402 on some other parameter is
// still a real error and stays a plain Error, so callers must not swallow it.
export function isFmpPlanBoundary(err: unknown): err is FmpPlanBoundaryError {
  return err instanceof FmpPlanBoundaryError;
}

function getApiKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    throw new Error(
      "FMP_API_KEY is not set. Free key at https://site.financialmodelingprep.com",
    );
  }
  return key;
}

// Sleep helper used by the single retry on 429/5xx. Plain promise rather
// than importing a util module.
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(
  endpoint: string,
  page: number,
): Promise<FmpTrade[]> {
  const key = getApiKey();
  const url = `${BASE}/${endpoint}?page=${page}&apikey=${key}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) {
        throw new Error(
          `FMP ${endpoint} page ${page} returned non-array: ${typeof data}`,
        );
      }
      return data as FmpTrade[];
    }
    const isRetryable = res.status === 429 || res.status >= 500;
    if (isRetryable && attempt === 0) {
      // 60-second backoff per the handoff. One retry then give up so we
      // don't burn the daily quota on a stuck endpoint.
      console.warn(
        `[fmp] ${endpoint} page ${page} returned ${res.status}; retrying in 60s`,
      );
      await sleep(60_000);
      continue;
    }
    const body = await res.text().catch(() => "");
    // Match on 402 PLUS the page-parameter text, never 402 alone: FMP names the
    // gated parameter in the body, so a 402 on any other parameter fails this
    // test and keeps throwing a plain Error below (HO 579).
    if (res.status === 402 && /the values for ['"`]?page['"`]?/i.test(body)) {
      throw new FmpPlanBoundaryError(endpoint, page, body);
    }
    throw new Error(
      `FMP ${endpoint} page ${page} failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }

  // Unreachable — the loop above either returns or throws.
  throw new Error(`FMP ${endpoint} page ${page} exhausted retries`);
}

export async function fetchSenateTrades(params: {
  page?: number;
}): Promise<FmpTrade[]> {
  return fetchPage(SENATE_ENDPOINT, params.page ?? 0);
}

export async function fetchHouseTrades(params: {
  page?: number;
}): Promise<FmpTrade[]> {
  return fetchPage(HOUSE_ENDPOINT, params.page ?? 0);
}
