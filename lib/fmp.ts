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
