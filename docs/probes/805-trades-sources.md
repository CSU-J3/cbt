Trade data in this file: CapitolStockWatch (https://www.capitolstockwatch.com), CC BY 4.0.

# HO 805: the FMP swap, measured first. CT's trades against CapitolStockWatch's open dataset, the official House and Senate filings tested from the box, and every FMP touchpoint listed

> **Probe, read-only.** Base: `main` at `af27e38`. Read Friday 2026-11-06, in MST (UTC−7) with UTC beside:
> - STEP 0 by 9:37:23 AM (16:37:23Z): the dataset repo's clone at 9:31:32 AM, prod's claim at 9:37:21 AM;
> - § 1, CT's trades and ticks, at 9:37:31 AM (16:37:31Z);
> - § 2, the dataset, from 9:37:45 to 9:37:49 AM (16:37:45 to 16:37:49Z);
> - § 3, the match, at 9:38:15 AM (16:38:15Z);
> - § 4, the House from 9:39:19 to 9:40:12 AM (16:39:19 to 16:40:12Z), and the Senate from 9:40:28 to 9:40:30 AM (16:40:28 to 16:40:30Z);
> - § 5, the grep at `af27e38`.
>
> Prod was read by `SELECT` only, with the schema fingerprint `4e94644350e1d992` before and after every read; 23 statements read 120,887 rows. The network went to four hosts only (GitHub and its raw host, `www.capitolstockwatch.com`, `disclosures-clerk.house.gov`, `efdsearch.senate.gov`): 19 requests through the instrument, each 2 s or more after the last to its host, and one shallow `git clone` of the dataset's repo for STEP 0. None went to FMP. No app code, no dependency, no Gemini call, no flush. Row-level values from CT's FMP rows stay in the repo-ignored `docs/handoffs/805-artifacts/`; this file carries counts, and CapitolStockWatch's own rows where it needs an example. **Corey's ruling, verbatim: *"You pick os approved"* (9:20 AM MST Nov 6).** The swap is HO 806, after the Nov 9 print; this file sizes it and makes no recommendation.

## STEP 0, a check: claims 1 to 6 hold, none a HALT

- **1.** `main` reads `af27e38` on the remote and the box; pointer 804 at `docs/roadmap.md:9132`; highest HO in commit subjects 804; the tree clean but for the two untracked Nov 1 snapshots. Reconcile 270 / 381 on 651, mis-struck 0, the DONE control 0.
- **2.** `docs/backlog.md:30` is the FMP display licence line (HO 786), opened 2026-10-19, *Owner:* Corey, ending as the handoff quotes it.
- **3.** The anchors hold, with three re-derivations recorded:
  - `tradesPlanCap` rides the payload at `app/api/sync/route.ts:160`; `:157` is its comment.
  - *stock_trades is small (hundreds of rows)* spans `lib/queries.ts:3717-3718`, and it's stale: the table holds 2,780 (§ 1).
  - `market_ticks` has no source column (`scripts/migrate.ts:541-548`): a tick's source is its symbol's entry in `lib/markets.ts`'s `MARKET_SYMBOLS`, which is how § 1 groups them.
- **4.** Prod: `stock_trades` carries `id, bioguide_id, member_name_raw, chamber, ticker, asset_description, transaction_type, transaction_date, disclosure_date, amount, owner, raw_json, ingested_at`, and `market_ticks` carries `id, symbol, price, change_pct, ticked_at, market_date`. The fingerprint reads `4e94644350e1d992`, as at HO 804.
- **5.** The dataset: `github.com/MichaelBMiner/capitol-stock-watch-open-data` is one commit, `7a6958f` at 9:01:09 AM MST Nov 6 (16:01:09Z), by `github-actions[bot]`, *Auto-update: Latest congressional disclosures open dataset (2-hour sync)*. It holds `congress_trades_latest.csv` (1,112,004 bytes) with README § 3's 16 columns, `LICENSE` (CC BY 4.0) and README § 6 (*appropriate attribution and a link to CapitolStockWatch.com*), beside `congress_options_trades.csv`, `politicians_directory.csv` and `stock_act_violations.csv`. The README's direct URL and its badge's repo are as the handoff gives them (§ 2 reads both).
- **6.** The official sites: the House answered from the box (§ 4). eFD served its agreement page and refused the agreement's POST, so § 4 reads the Senate from what it could.

## § 1, CT's trades and ticks now (9:37:31 AM MST, 16:37:31Z)

**`stock_trades`: 2,780 rows,** House 2,219 and Senate 561.

- **Filed:** all in 2026, Apr 2 to Nov 5; **none before 2026.** By filing month (House / Senate):

  | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov |
  |---|---|---|---|---|---|---|---|
  | 0 / 27 | 178 / 58 | 244 / 43 | 356 / 130 | 355 / 139 | 602 / 130 | 464 / 28 | 20 / 6 |

- **Transactions:** 2024-03-08 to 2026-10-28. **Ingested:** 2026-05-17 to 2026-11-06 12:00Z.
- **Members:** 99 distinct; `bioguide_id` NULL on 148 rows, one member under one name (April McClain Delaney, spelled short of her name in `members`, § 3).
- **`transaction_type`:** Purchase 1,337 · Sale 1,200 · Sale (Partial) 130 · Sale (Full) 89 · Exchange 24.
- **`owner`:** NULL 1,510 · Joint 674 · Spouse 527 · Self 57 · Dependent 12.
- **`amount`:** $1,001–$15,000 2,069 · $15,001–$50,000 491 · $50,001–$100,000 86 · $100,001–$250,000 80 · $250,001–$500,000 31 · $500,001–$1,000,000 15 · $0–$1,000 2 · $1,000,001–$5,000,000 2 · $5,000,001–$25,000,000 2 · Over $50,000,000 2.
- **`raw_json`** carries FMP's keys (`symbol, senateID, disclosureDate, transactionDate, firstName, lastName, office, district, owner, assetDescription, assetType, type, amount, capitalGainsOver200USD, comment, link`). Every row's `link` names its filing: a House PDF on 2,219, an eFD report on 561. § 3 compares filing by filing on it.
- **The last 8 `/api/sync` rows** (Nov 4 18:00Z to Nov 6 12:00Z): all `success`; `timings.trades` 647 to 3,489 ms; `tradesPlanCap` met FMP's page-1 boundary on 4 of 8 (the House three times, the Senate once).

**`market_ticks`: 24,853 rows,** May 27 to Nov 6.

- **The seven FMP symbols:** 16,618 rows. SPX from May 27 (2,426), NDQ from Jun 2 (2,417), and the five equities from Jun 20 (NVDA 2,354, AAPL 2,355, MSFT 2,355, GOOGL 2,356, LMT 2,355), each through 9:30 AM MST today.
- **The rest:** FRED 3,019 (TNX, CPI, UNEMP, WTI), Kalshi 2,465 (SHUTDOWN, FEDCUT, RECESSION) and Polymarket 1,639 (POLY-FEDCUT, POLY-RECESSION). 15 retired symbols hold 1,112 rows. Two of them, DOW (40) and GOLD (30), were FMP-sourced for part of their history (`git log -S` on `lib/markets.ts`; Stooq before), so up to 70 more rows may be FMP's.
- **The last 7 days, by source:** fmp 924 · fred 168 · kalshi 126 · polymarket 84. The non-FMP ticks land every 4 hours at 00, 04, 08, 12, 16 and 20Z (63 each), so the bare `0 */4` run alone writes them.
  - The longest gap between two was 4.00 h, against the markets health window of 9 h (`lib/cron-health.ts:71`, which reads `MAX(ticked_at)` across all symbols).
  - The newest was 0.62 h old at the read.

## § 2, the dataset (9:37:45 to 9:37:49 AM MST; 4 requests of the 5 allowed)

| Read | HTTP | Bytes | sha256 (16) | Validators | Rows |
|---|---|---|---|---|---|
| the GitHub copy (`raw.githubusercontent.com/MichaelBMiner/…/main/congress_trades_latest.csv`) | 200 | 1,112,004 | `d52f0b1139c8b8f2` | no `Last-Modified`; a weak `ETag` | 4,950 |
| the site's copy (`www.capitolstockwatch.com/data/open-data/congress_trades_latest.csv`) | 200 | 1,112,004 | `d52f0b1139c8b8f2` | no `Last-Modified`; an `ETag` | 4,950 |
| `www.capitolstockwatch.com/data/trades.json` | 200 | 5,493,562 | `185c52258dbb24c4` | | 4,950 records |
| `github.com/CapitolStockWatch/capitol-stock-watch-open-data` | 301 → `github.com/MichaelBMiner/capitol-stock-watch-open-data` | | | | |

- **The two CSVs are byte-identical.** The badge's org redirects to the same repo.
- **`trades.json`:** 4,950 records, the CSV's count, filed 2026-01-01 to 2026-11-05, **all 2026**, so it can't keep 2025. Its 40 fields carry the CSV's (some under other names: `doc_url`, `amount_range_low`, `days_to_file`, `is_late`) and more:
  - `owner`: blank on 2,188; the House's SP 1,123, DC 751 and JT 586; the Senate's Joint 185, Spouse 81, Self 30 and Child 6;
  - `doc_url` and `filing_type` (PTR on all), `asset_type` (the filing's codes), `comment` and `source_id`;
  - performance fields: `ret_since`, `ret_30d`, `ret_1y`, `excess_since`, `window_advantage`;
  - insider tags: `has_insider_alignment`.
  - With `owner` and `comment` added, rows repeating another row on every field fall from 156 to 8.

**The CSV's checks** (the GitHub copy), beside the chat's read of 11 PM MST Nov 5:

| Check | Now | The chat's |
|---|---|---|
| columns | the README's 16, in order; 0 ragged rows | |
| rows | **4,950**: House 4,648, Senate 302 | 4,947: 4,645 and 302 |
| filers | 124 | 124 |
| filings | 2026-01-01 to 2026-11-05 | Jan 1 to Nov 5 |
| transactions dated after the read | 1: Steve Cohen's SONY, dated 2026-12-26, filed 2026-02-09 | the same |
| transactions dated after their filing | 4 | 4 |
| transactions before 2025 | 216 | 216 |
| blank tickers | 1,514 (no `--`, no `N/A`) | 1,514 |
| rows repeating another row's every field | **156** beyond the first of each group (303 rows in 147 groups of two or more) | 977, a six-field key (below) |
| Senate links | 302 rows over 34 links: 33 eFD UUIDs, 1 slug (`/search/view/ptr/2026-10-21-boozman/`, 9 rows) | 9 of 302 in slug form |
| House filings | 402: 389 eight-digit electronic DocIDs, 13 seven-digit paper | 13 of 401 |
| DocID `20035778` | 5 rows, Maria Elvira Salazar, filed 2026-11-05 | matched its PDF |

- By filing month: Jan 610 · Feb 328 · Mar 336 · Apr 408 · May 316 · Jun 323 · Jul 276 · Aug 859 · Sep 727 · Oct 749 · Nov 18.
- `security_type`: stock 4,881 · call_option 46 · put_option 23. A government bond reads `stock` too: Mike Kelly's Fairfax County GO, `[GS]` on its PDF, is `stock` in the CSV.
- `transaction_type`: Purchase 2,465 · Sale (Full) 1,389 · Sale (partial) 615 · Sale (Partial) 467 · Exchange 14 (two casings of the partial sale).
- `amount_range`: the STOCK Act brackets, with a 1,001 lower bound on 3,709 rows. Six rows carry an exact dollar figure instead ($318, $344, $584, $707, $710, $2,722).
- The repeat count doesn't reproduce the chat's 977 by either definition, or with `filing_url` dropped (175 beyond the first, 341 in groups). The chat's 977 counted six fields (`filer_name`, `transaction_date`, `ticker`, `transaction_type`, `amount_range`, `filing_url`), which its handoff called every field; the chat's recount reads 977 on both the Nov 5 and Nov 6 copies, and 156 on all 16.

## § 3, the match (9:38:15 AM MST; prod's `members` read as `lib/trades-ingest.ts:102` reads it)

**Members.** 555 members (House 451, Senate 104). CSW's 124 filers through CT's own `matchMemberName`, unchanged, with each filer's state as the hint: **120 matched, 4 unmatched (18 rows):**

| CSW filer | Chamber | State | Rows | Why it misses, as read |
|---|---|---|---|---|
| Matthew Robert Van Epps | house | TN | 13 | a two-word surname against a last-token match |
| Neal Patrick MD, Facs Dunn | house | FL | 3 | CSW's name carries the credentials, and the comma reads as "Last, First" |
| A. Mitchell | senate | KY | 1 | Mitch McConnell under his first name |
| Linda T. Sanchez | house | CA | 1 | CT spells the surname Sánchez |

Two bioguides take two filer keys each (`K000398`, `M001239`). CT's own 148 unmatched rows are one member, April McClain Delaney, under a shorter spelling than `members` holds.

**Trades.** Normalized on both sides:
- dates to `YYYY-MM-DD`;
- the type to P, S or E (all types mapped);
- the amount to its bracket's lower bound (CT 2 rows and CSW 6 off the brackets);
- the ticker upper-cased, with blank, `--` and `N/A` read as blank;
- the member to the bioguide, or `unmatched:<name>`.

The window is filings from 2026-01-01 to 2026-11-05, both sources' newest. The compare is by multiset, since CSW repeats rows and CT doesn't.

| Key | Chamber | CT | CSW | Matched | CT-only | CSW-only (of which extra copies of a key CT holds) |
|---|---|---|---|---|---|---|
| A: bioguide, date, ticker, type, amount | House | 2,219 | 4,648 | 1,099 | 1,120 | 3,549 (62) |
| | Senate | 561 | 302 | 142 | 419 | 160 (21) |
| | all | 2,780 | 4,950 | **1,241** | 1,539 | 3,709 (83) |
| B: the same, no ticker | House | 2,219 | 4,648 | 1,410 | 809 | 3,238 (295) |
| | Senate | 561 | 302 | 160 | 401 | 142 (33) |
| | all | 2,780 | 4,950 | **1,570** | 1,210 | 3,380 (328) |

**By transaction month (Key B, all; the transaction date is in the key, so each month partitions cleanly):**

| Month | CT | CSW | Matched | CT-only | CSW-only |
|---|---|---|---|---|---|
| before 2026 (2023-10 to 2025-12) | 199 | 908 | 165 | 34 | 743 |
| 2026-01 | 4 | 315 | 4 | 0 | 311 |
| 2026-02 | 3 | 335 | 3 | 0 | 332 |
| 2026-03 | 135 | 400 | 0 | 135 | 400 |
| 2026-04 | 175 | 298 | 41 | 134 | 257 |
| 2026-05 | 291 | 329 | 159 | 132 | 170 |
| 2026-06 | 384 | 263 | 163 | 221 | 100 |
| 2026-07 | 440 | 636 | 291 | 149 | 345 |
| 2026-08 | 571 | 642 | 320 | 251 | 322 |
| 2026-09 | 496 | 743 | 356 | 140 | 387 |
| 2026-10 | 82 | 80 | 68 | 14 | 12 |
| 2026-12 | 0 | 1 | 0 | 0 | 1 |

Key A's months and the full month-by-month rows are in `docs/handoffs/805-artifacts/match-805.out`.

**The 10 members with the most one-sided rows (Key A):**
- **CT-only:** Ro Khanna 490 · April McClain Delaney (unmatched in CT) 148 · Gilbert Cisneros 131 · Michael McCaul 128 · Alan Armstrong (Senate) 105 · Kevin Hern 97 · John Boozman 93 · Richard Blumenthal 48 · Mark Warner 30 · Tommy Tuberville 27.
- **CSW-only:** Ro Khanna 937 · Gilbert Cisneros 632 · April McClain Delaney 338 · Julia Letlow 257 · Scott Peters 134 · David Taylor 118 · Julie Johnson 100 · Josh Gottheimer 82 · Tommy Tuberville 77 · Jared Moskowitz 71.

**CT's rows filed before 2026: none.** The swap loses no pre-2026 filing.

**Filing by filing** (read beyond the letter, on CT's `link` and CSW's `filing_url`; `docs/handoffs/805-artifacts/filings-805.out`):

| Chamber | Filings in both | CT-only filings | CSW-only filings |
|---|---|---|---|
| House | 172 (CT 1,807 rows, CSW 2,459) | 14 (412 rows) | 230 (2,189 rows): Jan 44, Feb 33, Mar 39, Apr 37, May 26, Jun 20, Jul 13, Aug 8, Sep 6, Oct 3, Nov 1 |
| Senate | 27 (CT 225, CSW 260) | **52 (336 rows)**: Apr 8, May 13, Jun 10, Jul 10, Aug 4, Sep 1, Oct 4, Nov 2 | 7 (42 rows) |

- **Inside the 199 shared filings,** 1,391 rows agree on date, ticker, type and amount.
- **CT's 641 rows left over, by the one field that differs:**
  - the ticker on 362: mostly CSW's blank where FMP filled one;
  - no single-field twin on 263;
  - the date on 10;
  - the amount on 6.
- **Where only the date differs,** CT's is one day earlier than CSW's on 63 rows. Every date CSW gave in the PDF sample (§ 4) matched its PDF.
- **Row counts in the shared filings:** equal in 120, fewer in CT in 58, fewer in CSW in 21. CT's id carries no owner, so CT holds two same-day, same-amount buys in two accounts as one row: Salazar's `20035778` is 5 rows in its PDF and CSW, and 3 in CT.

## § 4, the official filings

### The House (9:39:19 to 9:40:12 AM MST; 13 requests, all HTTP 200)

- **The index:** `2026FD.zip`, 65,691 bytes, sha256 `b045cb58a1232e05`, `Last-Modified` Thu, 05 Nov 2026 14:00:11 GMT (7:00 AM MST Nov 5).
  - Its entries were listed first: `2026FD.txt` and `2026FD.xml` and nothing else.
  - It was extracted with the box's own `C:\Windows\System32\tar.exe` (bsdtar 3.8.9). Git Bash's GNU `tar` reads no zip.
- **`2026FD.xml`:** 1,841 entries, all Year 2026. By `FilingType`: C 883 · P 456 · X 247 · W 106 · D 98 · A 47 · H 2 · T 2.
- **PTRs (P): 456,** 400 electronic (8 digits from 2) and 56 paper (7 digits), from 111 members, filed Jan 1 to Nov 5.

  | Filed | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | electronic / paper | 48 / 0 | 34 / 4 | 41 / 5 | 38 / 3 | 41 / 11 | 38 / 5 | 49 / 7 | 36 / 8 | 32 / 4 | 36 / 9 | 7 / 0 |

- **Against CSW's House DocIDs:** in both **401** (electronic 388 of 400, paper 13 of 56). Index-only **55** (12 electronic, 43 paper): Jan 4/0 · Feb 1/4 · Mar 2/5 · Apr 1/3 · May 0/11 · Jun 0/5 · Jul 4/7 · Aug 0/4 · Oct 0/4 (electronic / paper). CSW-only **1** (`20035770`), absent from an index last built at 7:00 AM MST Nov 5.

**The sample, 12 PDFs, read by eye** (`docs/handoffs/805-artifacts/house-check-805.tsv`):

| DocID | Form | Why | Rows: PDF / CSW / checked | Agree on all four | Owner column on the PDF | Read as |
|---|---|---|---|---|---|---|
| 20035778 | electronic | newest | 5 / 5 / 5 | 5 | blank (UBS IRA and UBS Brokerage subholdings) | text |
| 20035662 | electronic | newest | 1 / 1 / 1 | 1 | SP | text |
| 20035765 | electronic | newest | 2 / 2 / 2 | 2 | SP | text |
| 20035763 | electronic | newest | 1 / 1 / 1 | 1 | SP | text |
| 20035751 | electronic | newest | 1 / 1 / 1 | 1 | JT | text |
| 20035743 | electronic | newest | 1 / 1 / 1 | 1 | JT | text |
| 20033945 | electronic | random (seed 805) | 4 / 4 / 4 | 4 | SP, and one blank | text |
| 20033991 | electronic | random | 2 / 2 / 2 | 2 | SP | text |
| 20034998 | electronic | random | 31 / 31 / 31 | 30 | SP | text |
| 9116376 | paper | newest paper in both | about 459 / 455 / 25 | 24 on date, type and amount | DC and SP (trust sections) | image only |
| 9116361 | paper | paper in both | 4 / 4 / 4 | 4 on date, type and amount | JT | image only |
| 9116355 | paper | paper in both | 11 / 10 / 10 | 7 on date, type and amount | blank | image only |

**Electronic: 48 of 48 rows present, 47 agree on date, ticker, type and amount.** The 48th is Dan Newhouse's Honeywell International buy: the PDF prints `(HON)` and CSW's ticker is blank.

**Paper: 35 of the 39 rows checked agree on date, type and amount** (paper forms ask for names, not tickers). As read from the scans:
- **9116376** (Khanna, 31 pages; a partial check of CSW's first 25 rows): the Washington St GO 5% 08/01/31 trade of Sep 29 reads Sale on the scan and Purchase in CSW. The page-by-page count reads about 459 rows against CSW's 455, within the count's own error.
- **9116355** (Harshbarger):
  - North TX Tollway Auth (Aug 20) reads Sale, $100,001–$250,000 on the scan; Purchase, $15,001–$50,000 in CSW.
  - Trinity River Auth (Aug 19) reads Sale on the scan; Purchase in CSW.
  - The Sep 1 US Treasury note reads $15,001–$50,000 on the scan; $1,001–$15,000 in CSW.
  - One of two identical Katy ISD lines (Sep 2) is missing from CSW.

**The owner column:** every PDF carries one (SP, JT, DC, or blank for the filer's own), and CSW's CSV has none. The JSON feed has it (§ 2).

### The Senate (9:40:28 to 9:40:30 AM MST; 2 requests, then stopped)

- **`GET /search/home/`: 200,** 11,880 bytes. The gate is the form the handoff names:
  - `<form action="" method="POST" id="agreement_form">`, its inputs `prohibition_agreement` and `csrfmiddlewaretoken`, and a `csrftoken` cookie.
  - The agreement's text quotes § 105(c): *It shall be unlawful for any person to obtain or use a report: for any unlawful purpose; for any commercial purpose, other than by news and communications media for dissemination to the general public; for determining or establishing the credit rating of any individual; or for* … (solicitation).
  - The page says nothing on automated access: 0 hits for *automat*, *robot*, *scrap*, *crawl*, *bulk* or *rate limit*.
- **The agreement's POST** (`prohibition_agreement=1`, the token, the cookie, `Referer` the home page): **403,** a 394-byte block page, with Akamai bot-manager cookies (`bm_s`, `bm_so`) set on the response.
  - Guard 2 stopped the host there, with no retry.
  - The PTR search, `recordsTotal`, the UUID comparison and the two report pages are **unread from the box**.
- **What could be read without eFD,** from CT's FMP links and CSW's links (a substitute, not the handoff's comparison):
  - **CT's Senate rows:** 561 over **79** eFD reports (77 electronic PTRs, 2 paper), filed Apr to Nov.
  - **CSW's Senate rows:** 302 over **34** (33 UUIDs and the one slug).
  - **The overlap:** 27 in both; 52 CT-only (336 rows); 7 CSW-only (42 rows).
  - **The slug** (`2026-10-21-boozman`, 9 rows in CSW) matches by senator and date **two** eFD reports John Boozman filed Oct 21, with 7 and 10 rows in CT, so the slug can't say which report its rows are from.

## § 5, FMP everywhere

`git grep -n -i -E 'fmp|financialmodelingprep' af27e38`, outside `docs/handoffs/`, `docs/roadmap.md`, `docs/backlog.md`, `docs/oddities.md`, the two handoff archives and `docs/probes/odds-snapshots/`: **166 lines** (`docs/handoffs/805-artifacts/fmp-grep-805.txt`).

| Group | Lines | Files |
|---|---|---|
| **What runs:** `app/`, `lib/`, `vercel.json` | 86 | `lib/markets.ts` 26 · `lib/fmp.ts` 24 · `lib/trades-ingest.ts` 13 · `app/api/cron/markets/route.ts` 5 · `app/api/sync/route.ts` 4 · `lib/matchMember.ts` 3 · `app/api/cron/news/route.ts` 2 · `app/welcome/page.tsx` 2 · `lib/queries.ts` 2 · `app/globals.css` 1 · `lib/cron-health.ts` 1 · `lib/markets-collisions.ts` 1 · `lib/redact.ts` 1 · `vercel.json` 1 |
| **…and `components/`,** outside the handoff's three groups | 2 | `components/MarketsTapeClient.tsx` 1 · `components/TradeRow.tsx` 1 (both comments) |
| **Tooling:** `scripts/` | 42 | `scripts/diagnostic/sync-trades-margin-482.ts` 14 · `tape-source-probe-288.ts` 9 · `sync-trailing-cost-479.ts` 7 · `redact-fixtures-679.ts` 3 · `scripts/migrate.ts` 3 · and one each in `scripts/diagnostic/README.md`, `cron-runs-sync-verify-487.ts`, `fts-probe-336.ts`, `markets-freeze-313.ts`, `markets-read-burn-582.ts`, `roster-check-670.ts` |
| **What documents it** | 36 | SKILL 26 · `README.md` 5 · `.env.example` 1 · `docs/probes/787-gradshow-numbers.md` 1 · `docs/design/mock-797-feed-tabs.html` 2 · `docs/design/mock-767-electoral-general-v18.html` 1 |

Many of the 86 are comments; the code paths are `lib/fmp.ts`, `lib/trades-ingest.ts` and its call in `app/api/sync/route.ts`, `lib/markets.ts`'s seven symbols and `fetchFmp`, the `?source=fmp` cron (`vercel.json:112-113`), `app/welcome/page.tsx`'s `MARKETS_ROSTER` and `lib/redact.ts`'s key name.

**`vercel env ls` for `FMP_API_KEY`:** the CLI is linked (`.vercel/project.json`, project `cbt`), but its token is refused (*The specified token is not valid. Use `vercel login`*), so the scopes are unread.

## What the numbers say for the swap

1. **Coverage for 2026.**
   - **Rows:** CSW holds 4,950 (House 4,648, Senate 302) against CT's 2,780 (2,219 and 561).
   - **The House:** CSW holds 401 of the index's 456 PTRs: 388 of the 400 electronic, 13 of the 56 paper. Filing by filing, it has 230 House filings CT lacks, mostly from before CT's rows begin on Apr 2, and CT has 14 it lacks.
   - **The Senate:** CSW is the thinner, with 34 reports against CT's 79. CT has 52 that CSW lacks (336 rows), and CSW has 7 that CT lacks.
   - **Row by row:** Key A matches 1,241 and Key B 1,570. Inside the 199 shared filings, 1,391 rows agree on all four fields, and most of the rest differ by CSW's blank ticker or a one-day date offset on CT's side.
2. **Accuracy against the sample.**
   - **Electronic:** 9 filings, 48 rows, all present; 47 agree with the PDF on date, ticker, type and amount, and the 48th has a blank ticker.
   - **Paper:** 3 scans, 39 rows checked; 35 agree on date, type and amount and 4 differ (three types, two amounts), plus one duplicated line missing.
   - **The owner column:** in every PDF and in CSW's JSON, not in its CSV.
3. **The filers CT's matcher can't place:** 4 of 124, 18 rows: Van Epps, Dunn, McConnell and Sánchez, each a spelling, not a missing member. CT's own matcher already misses April McClain Delaney's 148 FMP rows.
4. **What goes.**
   - CT's rows from before 2026: none.
   - The seven FMP symbols' 16,618 ticks, plus up to 70 of DOW's and GOLD's retired rows.
   - The 166 FMP lines in § 5: 86 that run, 2 in `components/`, 42 in tooling, 36 in docs.
   - Without the seven, the bare 4-hourly run still writes FRED, Kalshi and Polymarket ticks with gaps of at most 4 h against the 9 h health window.
5. **The official route from the box.**
   - **The House answered:** the 2026 index and 12 PDFs, all HTTP 200. Electronic PDFs read as text and paper ones as scans.
   - **The Senate's eFD did not:** it served the agreement page and refused the agreement's POST with a 403 block page. Its PTR list is unread from here.
