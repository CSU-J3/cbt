# Backlog

Raw ideas not yet ready for a handoff. Graduate entries to `docs/handoffs/` with a number when the shape sharpens.

- **Stage-change feed.** Bills that moved stage in the last 7 days. Turns the dashboard into something closer to legislative news. Likely a `/changes` route; mechanism TBD (stage history table vs. snapshot diff at sync time).
- **Substack data post.** Dashboard has enough surface area to support a piece pointing readers at specific bills. Hooks include total tracked, enacted count, presidential-desk count (once `/president` ships). Angle: what's actually moving in this Congress.
- **Mobile redesign of dashboard surfaces.** Desktop ships first across HO 126/131/133. Consolidates HO 123 (mobile touch tooltip equivalents), HO 125 (BillRow mobile-responsive audit), HO 127 (WatchStar mobile tooltip parity), HO 131 (mobile-first redesign), HO 133 (mobile redesign for new header + grid). Trigger when desktop layout stabilizes.
- **/search v2/v3 enhancements.** Per-tab filter rail (v2), type-ahead in SearchBox (v2), LLM-synthesized answer at top (v3). All deferred from HO 129.
- **Breaking news ticker.** Scrolling marquee on the dashboard surfacing recent `news_mentions`. Data layer shipped through HOs 64/75/86/102/103/104/111; this is the open UI block in the news signal theme. Component lives in the design chat once scoped.
- **Member stock-trades pipeline + ticker.** Surfaces member PTR disclosures and ties them to bill/committee context. Quiver Quantitative is the obvious paid source ($300/yr Hobbyist tier). Free alternative is direct STOCK Act PTR scraping from House Clerk + Senate eFD. Parked until CBT has a revenue story; HO 70 left schema work behind that's reusable when the pipeline gets built.
- **SVG primitive extraction across chart components** (HO 100).
- **`revalidateTag('primaries')` wiring** (HO 103).
- **Backfill ~26 bills that lost a topic tag during the HO 120 drain.** Trigger: analyst view depends on full tag coverage.
- **Topic taxonomy expansion** if unmapped category counts exceed a useful threshold (HO 121).
- **Cross-Congress historical members** (HO 124); 119th only today.
- **External member scoring sources** (DW-NOMINATE etc.) (HO 124).
- **Member-hub layout polish** (HO 124).
- **`/bill/[id]` page redesign** (HO 125).
- **Per-source weighting in media-attention count** (HO 130).
- **Additional time windows beyond 7d for media-attention** (HO 130).
- **Filter/sort within Breaking/Top Stalls tab strip** (HO 133).
- **VIX intraday source.** Stooq doesn't carry it and Yahoo's unauthed endpoints are too unstable for a daily refresh contract. Worth picking back up when a free source emerges or when a paid plan covers it incidentally.
