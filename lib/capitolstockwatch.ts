// HO 806: CapitolStockWatch's open dataset of congressional stock-trade
// disclosures (https://www.capitolstockwatch.com), under CC BY 4.0: anyone may
// show it with credit, a link to the licence and a note of changes. The credit
// sits on /trades and on the member hub's Trades tab. One JSON array of the
// year's filings, both chambers, rebuilt every two hours from the House Clerk's
// PTRs and the Senate's eFD. Each record carries its own `id`
// (house_<DocID>_g<n>, senate_<uuid>_t<n>), one per line of a filing, and
// lib/trades-ingest.ts keys on it. No key, no auth.

export const CSW_TRADES_URL = "https://www.capitolstockwatch.com/data/trades.json";

// The fields CT reads. Each is `unknown` because the feed is upstream data:
// lib/trades-ingest.ts checks every one before it trusts it.
export type CswRecord = {
  id?: unknown;
  branch?: unknown;
  chamber?: unknown;
  filer_name?: unknown;
  state?: unknown;
  transaction_date?: unknown;
  filing_date?: unknown;
  ticker?: unknown;
  asset_name?: unknown;
  transaction_type?: unknown;
  amount_range_label?: unknown;
  owner?: unknown;
  comment?: unknown;
  doc_url?: unknown;
  [key: string]: unknown;
};

export async function fetchCswTrades(): Promise<unknown[]> {
  const res = await fetch(CSW_TRADES_URL, {
    headers: {
      "User-Agent": "CBT-trades-sync/1.0 (+https://github.com/CSU-J3/cbt)",
      Accept: "application/json",
    },
    // The feed is about 5.5 MB, over the data cache's 2 MB item limit, and the
    // ingest diffs it against the database every run, so nothing caches it.
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const contentType = res.headers.get("content-type") ?? "no content-type";
  const text = await res.text();
  // The body's first 120 characters, whitespace collapsed so a block page's
  // title reads on one log line.
  const head = text.slice(0, 120).replace(/\s+/g, " ");
  if (!res.ok) {
    throw new Error(`CSW trades.json HTTP ${res.status} (${contentType}): ${head}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`CSW trades.json isn't JSON (${contentType}): ${head}`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`CSW trades.json isn't a JSON array (${typeof data}): ${head}`);
  }
  return data;
}
