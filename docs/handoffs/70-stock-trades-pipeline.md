# 70 — Stock trades pipeline (FMP)

## What this is

Member depth theme, step 3. Donors got reverted in handoff 65 when OpenSecrets killed its API. This handoff fills the gap with stock trade disclosures via Financial Modeling Prep (FMP). Storage + sync + a "Recent trades" section on the member hub at `/sponsors/[bioguideId]`. No analytical cross-referencing with bills yet — that's a later theme. V1 just ingests and surfaces.

## Why FMP

Verified live as of March 2026. Free tier covers 250 calls/day. Separate endpoints for Senate and House disclosures, REST + JSON, member-name + date-range filtering. Sync footprint is 1-3 calls/day on a daily incremental, well under the free cap. Caveats:

- Tickers aren't always normalized — store raw and worry about normalization later if a UI need surfaces.
- Amount fields come back as filing strings like `"$1,001 - $15,000"`. Don't try to parse into min/max yet; store raw and render as-is.
- Member names, not bioguide IDs. The matcher has to bridge.

If FMP free tier proves insufficient (rate-limited mid-sync, or coverage gaps), the fallback is Finnhub's congressional trading endpoint. Don't switch unless FMP fails verification — adding a second source without need is over-engineering.

## In scope

- New `stock_trades` table
- New `lib/fmp.ts` client (Senate + House trade endpoints)
- New name-matching helper: FMP name → `members.bioguide_id`
- New `scripts/sync-trades.ts` standalone script (incremental)
- Wire into `/api/sync` route as a post-bills step
- New query helpers in `lib/queries.ts`: `getMemberTrades`, `getMemberTradeCount`
- New `TradeRow` component
- New "Recent trades" section on `/sponsors/[bioguideId]` member hub
- New `FMP_API_KEY` env var (free key signup at https://site.financialmodelingprep.com)
- Migration script entry

## Out of scope

- `/trades` global route. Per the IA rule, "recent trades" is a sub-page link on the member hub. The global view is a future sub-page (one route per member). Don't add it.
- Cross-referencing trades with bills (the headline "did they trade $X in defense stocks before voting for the NDAA" analytical lens). That's a future theme on its own.
- Ticker → company name resolution. Surface tickers raw for now.
- Family member trades. FMP returns them as `"FAMILY"` owner type. Filter to `"OWNER"` and the member's own name only, or include with a `Family` chip if FMP marks it cleanly. Recommendation: include them, mark with chip — family disclosure is the substantive signal half the time.
- Stock trade alerts / notifications / email digest. Read-side only.
- Backfilling historical disclosures further than FMP returns by default. Take what the API gives, sync forward from there.

## Schema

```sql
ALTER TABLE bills /* unchanged */;

CREATE TABLE stock_trades (
  id TEXT PRIMARY KEY,              -- composite: bioguide_id-disclosure_date-ticker-transaction_date-amount
  bioguide_id TEXT REFERENCES members(bioguide_id),  -- nullable; null = unmatched name
  member_name_raw TEXT NOT NULL,    -- as returned by FMP
  chamber TEXT NOT NULL,            -- 'senate' | 'house'
  ticker TEXT,                      -- raw, may be NULL or "N/A"
  asset_description TEXT,           -- raw FMP "assetDescription" / similar
  transaction_type TEXT,            -- 'Purchase' | 'Sale' | 'Sale (Partial)' | 'Sale (Full)' | 'Exchange' | etc, raw
  transaction_date TEXT,            -- ISO date, may be approximate per FMP
  disclosure_date TEXT,             -- ISO date
  amount TEXT,                      -- raw filing string e.g. "$1,001 - $15,000"
  owner TEXT,                       -- 'SELF' | 'SPOUSE' | 'JOINT' | 'DEPENDENT' | etc, raw
  raw_json TEXT NOT NULL,           -- full FMP record for debugging
  ingested_at TEXT NOT NULL         -- ISO timestamp
);

CREATE INDEX idx_trades_bioguide ON stock_trades(bioguide_id);
CREATE INDEX idx_trades_disclosure_date ON stock_trades(disclosure_date DESC);
```

`id` is composite because FMP doesn't return a stable filing ID. The composite key dedupes re-ingestion of the same disclosure. Hash it if the concatenation gets unwieldy.

Add to `scripts/migrate.ts` as a new step. Don't run an automatic migration — keep the migration as a single command (`npm run migrate`) the same way prior handoffs have.

## FMP client (`lib/fmp.ts`)

Mirror the shape of `lib/congress.ts` from handoff 60. Single module, no class wrapper:

```ts
const BASE = 'https://financialmodelingprep.com/api/v4';

export type FmpTrade = {
  // Whatever FMP actually returns. Type the fields we use; preserve raw in raw_json.
};

export async function fetchSenateTrades(params: {
  page?: number;       // FMP paginates
}): Promise<FmpTrade[]>;

export async function fetchHouseTrades(params: {
  page?: number;
}): Promise<FmpTrade[]>;
```

Endpoints (verify exact URLs against FMP docs at runtime; the docs page is `https://site.financialmodelingprep.com/developer/docs/stable/house-trading` and the equivalent senate-trading page):

- Senate: `/senate-trading?page={n}&apikey=...`
- House: `/senate-disclosure?page={n}&apikey=...` — **confirm the House endpoint name; FMP has used different names historically (`senate-disclosure` was the Senate disclosure endpoint; House had its own path). Verify in docs and update the function accordingly. Flag in the run notes if the docs path differs from this handoff.**

Error handling: if FMP returns 429 (rate limit) or 5xx, wait 60s and retry once, then give up for this sync tick. Don't burn the daily quota on a stuck endpoint.

Read `FMP_API_KEY` from `process.env`. Throw if missing.

## Name matching

New helper `lib/matchMember.ts`:

```ts
export function matchMemberName(
  rawName: string,
  members: Array<{ bioguide_id: string; first_name: string; last_name: string; state: string; chamber: string }>,
  chamber: 'senate' | 'house'
): string | null;
```

Strategy, in order:

1. **Exact normalized match**: lowercase + strip punctuation + strip suffixes (Jr, Sr, II, III) + strip prefixes (Sen., Rep., Hon.). Compare `"firstname lastname"` form.
2. **Last name + chamber match if unique**: if `rawName` parses to a last name and exactly one member of that chamber has that last name, match.
3. **Last name + state hint match if FMP returns state**: some FMP rows include `state`. If present, narrow by chamber + last name + state.
4. **No match**: return null. Log to console. Row still gets inserted with `bioguide_id = NULL`.

Don't fuzz aggressively. Better to leave a row unmatched than to misattribute trades. After the first sync, eyeball unmatched rows (a single SQL `SELECT * FROM stock_trades WHERE bioguide_id IS NULL`) and decide whether to harden the matcher.

## Sync script (`scripts/sync-trades.ts`)

Standalone, runs via `npm run sync:trades`.

1. Read `members` from DB into memory once (small table).
2. For each chamber:
   - Fetch the first FMP page (latest disclosures).
   - For each trade record:
     - Compute composite ID. Skip if `id` already exists in `stock_trades`.
     - Match member name → bioguide_id.
     - Insert row.
   - Paginate while the page contains new (unseen) records. Stop when an entire page is all-seen (we've caught up to history).
3. Log summary at the end: `senate: N inserted, M matched / X total; house: ...`.

Watermark approach: instead of a `MAX(disclosure_date)` watermark, the "stop when page is all-seen" loop is simpler and self-correcting if FMP backfills late. Cheaper too — one call per page until caught up.

Initial run: cap pagination at 20 pages per chamber to avoid burning the daily quota on first ingest. Subsequent runs will only need 1-2 pages each.

Add `"sync:trades": "tsx scripts/sync-trades.ts"` to `package.json`.

## Wire into `/api/sync`

After the existing news-ingest block, add a stock-trades step. Same pattern: try-catch, log on failure, don't crash the route. Cap pagination at 3 pages per chamber on the cron path (cron is incremental, not backfill). On success, call `revalidateTag('member-trades')` so member hub pages re-fetch.

## Queries (`lib/queries.ts`)

```ts
export type StockTrade = {
  id: string;
  bioguideId: string | null;
  memberNameRaw: string;
  chamber: 'senate' | 'house';
  ticker: string | null;
  assetDescription: string | null;
  transactionType: string | null;
  transactionDate: string | null;
  disclosureDate: string;
  amount: string | null;
  owner: string | null;
};

export async function getMemberTrades(
  bioguideId: string,
  limit: number = 20
): Promise<StockTrade[]>;

export async function getMemberTradeCount(bioguideId: string): Promise<number>;
```

Wrap with `unstable_cache(..., ['member-trades', bioguideId], { tags: ['member-trades'], revalidate: 3600 })`. Trade data refreshes daily, so a 1-hour backstop revalidate is plenty.

Sort: `ORDER BY disclosure_date DESC, transaction_date DESC, id DESC`.

## UI: member hub `/sponsors/[bioguideId]`

Add a "Recent trades" section to `app/sponsors/[bioguideId]/page.tsx` below the existing sections (sponsored bills, badges, etc.). Layout:

```
Header line: RECENT TRADES · {N} disclosed
[empty state] No disclosed trades on file.
[non-empty] TradeRow × up to 10, with [VIEW ALL N TRADES] link if N > 10
```

`[VIEW ALL]` is a no-op for now — link to `#` or omit. The dedicated trades sub-page is a separate handoff.

### `TradeRow` component

`components/TradeRow.tsx`. Server component. Six-column grid via new `.trade-row` CSS class:

```
60px       — disclosure date (MM-DD-YY)
40px       — chamber chip (`SEN` / `HOU`)
80px       — ticker (uppercase, monospace, dim if NULL → render `—`)
1fr        — asset description
110px      — transaction type (uppercase, color-coded: purchase green, sale red, other muted)
110px      — amount (raw filing string, right-aligned, tabular-nums)
```

Below 700px: hide asset description, show ticker + type + amount only.

Owner cell isn't its own column — if `owner != 'SELF'`, append a small chip after the asset description: `[SPOUSE]`, `[JOINT]`, `[FAMILY]` in `--text-muted` 11px.

## CSS

Add to `globals.css`:

```css
.trade-row {
  display: grid;
  grid-template-columns: 60px 40px 80px 1fr 110px 110px;
  align-items: baseline;
  column-gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-soft);
  font-size: 13px;
}

.trade-row:hover {
  background: var(--bg-row-hover);
}

.trade-row .ticker {
  font-weight: 600;
  letter-spacing: 0.5px;
  font-size: 13px;
}

.trade-row .amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--text-secondary);
}

.trade-row .txn-buy { color: var(--stage-enacted); }
.trade-row .txn-sell { color: var(--party-republican); }
.trade-row .txn-other { color: var(--text-muted); }

.trade-row .owner-chip {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

@media (max-width: 700px) {
  .trade-row {
    grid-template-columns: 60px 80px 110px 80px;
  }
  .trade-row .chamber-chip,
  .trade-row .asset-description {
    display: none;
  }
}
```

Buy = green (matches `--stage-enacted`), sell = red (matches `--party-republican`). Reuses existing palette tokens.

## SKILL.md updates

Add to the schema section: the `stock_trades` table.

Add to "Things to watch for":

- **FMP daily quota.** Free tier is 250 calls/day. The sync uses 1-3 calls per chamber per tick; cron is safe. Initial backfill is capped at 20 pages per chamber to stay under the cap on first run.
- **Name-to-bioguide matching is best-effort.** Unmatched rows have `bioguide_id = NULL` and don't appear on member hubs. Run `SELECT COUNT(*) FROM stock_trades WHERE bioguide_id IS NULL` periodically to audit.

## Env

Add to `.env.example`:

```
FMP_API_KEY=             # https://site.financialmodelingprep.com/developer/docs free tier, 250/day
```

## Verification

1. Migration runs clean. `stock_trades` table exists.
2. `npm run sync:trades` ingests both chambers, prints a summary line. First run inserts 100+ rows (typical FMP page returns ~50-100 trades).
3. `SELECT COUNT(*) FROM stock_trades WHERE bioguide_id IS NOT NULL` — ratio should be > 80% on first run. If below, the matcher needs tuning before pulling more.
4. `/sponsors/[bioguideId]` for a known active trader (search FMP for a member with many trades) shows the new section with TradeRow rendering. Try a Pelosi, Tuberville, etc.
5. For a member with zero matched trades, the empty state renders cleanly.
6. Cron-path sync runs under 60 seconds (Vercel Hobby ceiling). The 3-page-per-chamber cap should keep it well under.
7. Mobile: TradeRow drops asset description, ticker / type / amount remain visible.

## Don't

- Don't parse the amount string into dollar min/max. Raw string is fine for v1. The buckets are wide and inconsistent enough that pretending precision exists is misleading.
- Don't auto-resolve tickers to company names. The asset description already has the name in plain text for most rows.
- Don't write a "trades by ticker" view, or a "biggest movers this week" aggregate. That's the analytical cross-reference layer, separate theme.
- Don't pull more than 20 pages on initial sync. The free quota recovers daily; backfill can finish on day 2.
- Don't add UI for unmatched rows. They're a debugging concern, not a product surface.
