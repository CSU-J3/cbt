# CBT news-signal matcher audit (2026-05-20)

Audit of the LLM news → bill matcher (HO 86): how reliably does it link an
RSS article to the bills it is actually about?

## Method

**The matcher** — `lib/news-matcher.ts::matchBillsToArticle`. Fallback layer
behind the regex matcher (`lib/bill-id-extract.ts`); fires only when the
regex finds no spelled-out bill ID in the article text.

- **Model:** Gemini Flash (`SUMMARY_MODEL` from `lib/summarize.ts`),
  `thinkingBudget: 0`.
- **Pre-filter (in-memory, no LLM cost):** of a ~30-bill recent-candidate
  pool, keep only bills whose title shares at least one ≥5-character token
  with the article title + summary. If nothing survives, no LLM call.
- **Prompt:** system prompt asks for *only* a JSON array of bill IDs drawn
  from the candidate list; rules tell it to return `[]` when nothing is
  clearly the subject and to exclude tangential/background mentions.
- **Anti-hallucination:** returned IDs are intersected with the candidate
  set actually sent, so invented IDs are dropped.
- **Stored:** matches go to `news_mentions` (`bill_id`, `article_title`,
  `article_summary`, `matched_via`, `match_confidence`, …).

**Sample.** `SELECT COUNT(*) FROM news_mentions` → **21**, all
`matched_via = 'llm_match'`. Under 50, so **all 21 were audited** (Pass 1
heuristic + Pass 2 eyeball on every row).

**Pass 1 — textual corroboration** (per match, computed from the DB join to
`bills`): bill number present in the article title; sponsor surname present
in the article title; fraction of the bill title's ≥5-char tokens that also
appear in the article title. *Strong* = bill number or sponsor hit; *weak* =
≥30% title-word overlap, no strong hit; *none* = neither.

**Pass 2 — manual eyeball** of all 21: article title + summary vs. matched
bill title, classed Correct / Defensible / Wrong.

## Headline numbers

Total `news_mentions`: **21** — 21 `llm_match`, **0 `bill_id_regex`**. The
regex matcher contributes nothing to stored mentions: RSS subheads cite
legislation by topic, never by `HR 1234`, so the LLM matcher carries the
entire feature. `match_confidence` is **NULL on all 21** — the column
exists but the ingestion path (`lib/news-ingest.ts`) always writes `null`.

**Pass 1 (heuristic):** strong **0/21 (0%)**, weak **5/21 (24%)**, none
**16/21 (76%)**.

Pass 1 is a **weak instrument for this corpus** and the 0% strong is an
artifact, not a matcher failure: news headlines never print a bill number
(the very reason the LLM matcher exists — HO 86), they lead with the
political actor in the news (Schumer, Johnson, Cassidy) not the bill's
sponsor, and bills carry legalese titles ("To amend the Internal Revenue
Code of 1986…") that share no words with a headline even when the match is
correct. So Pass 2 is the real measure.

**Pass 2 (eyeball, all 21):** Correct **10/21 (48%)**, Defensible **6/21
(29%)**, Wrong **5/21 (24%)**. Correct-or-defensible: **76%**.

- *Correct* — the article is plainly about the matched bill (every ballroom
  article → a ballroom bill; the Iran war-powers article → the Iran
  war-powers joint resolution; the prediction-market article → the
  Prediction Market Act).
- *Defensible* — topically right, subject is arguable (housing-package
  articles → housing tax-credit bills; the DOJ "anti-weaponization fund"
  article → the appropriations bill that funds DOJ).
- *Wrong* — see below.

## Failure modes

All five Wrong matches share one root cause: **over-matching** — attaching a
bill that is topically adjacent or merely mentioned in the RSS summary
teaser, rather than one the article is genuinely the subject of.

| # | Article title | Matched bill | Why it's wrong |
|---|---|---|---|
| 24 | "Senate panel advances part of GOP's immigration enforcement bill" | `119-hr-8543` Build the Ballroom Act | Headline is about immigration. The RSS *summary* teaser mentions the ballroom; the matcher matched the teaser, not the article's subject. |
| 25 | (same immigration article) | `119-hr-8537` TRUMP Ballroom Act | Same — one mis-read article produced two wrong rows. |
| 28 | "Republicans and Democrats are in dealmaking mode as time runs out for legislative action" | `119-hres-1224` (a multi-bill consideration rule) | The article names no bill at all; the matcher still picked one specific procedural rule. |
| 30 | "Trump pushes to attach his SAVE act to must-pass bipartisan bills" | `119-s-4465` (FISA Title VII extension) | The article is about the SAVE Act; surveillance is collateral context in the summary. The matcher's own prompt says to exclude background mentions. |
| 37 | "5M people may drop coverage from ACA marketplaces" | `119-hr-8585` (community-coverage grant program) | Article is about ACA premium-tax-credit expiry; HR 8585 is an unrelated health-grant bill — topic-adjacent only. |

The pattern: the matcher weights the article **summary** as heavily as the
**title**, and Politico's RSS summaries are sometimes generic teasers not
specific to the headline (cases 24/25). It also reaches for a topically
near bill when the article is generic (28) or names a different bill (30,
37). Recall is good — when an article has a real bill, the matcher finds it
(the 10 Correct cases). The leak is precision, via over-eagerness.

## Recommendation

**Tune the prompt** (option 2 of the handoff's four).

The matcher core is sound — recall is good, hallucination is already guarded,
cost is controlled by the pre-filter. The single failure mode is a precision
leak that is cheap and prompt-addressable; it is not a model or
infrastructure problem, so no rebuild and no `news-signal` theme-blocking
work. A small follow-up handoff should:

1. Anchor the prompt on the **article title** as the article's subject;
   instruct the model to treat the summary as supporting context only, and
   not to match a bill on a summary mention alone (fixes 24/25, 30).
2. Sharpen the existing tangential-exclusion rule with the concrete pattern:
   do not match a bill merely because it shares a topic with the article
   (fixes 28, 37).
3. Have the model emit a 0–1 confidence per match and store it in the
   already-present `news_mentions.match_confidence` column (currently always
   NULL) — enabling a later low-confidence post-filter with no model change.

**Caveat:** 21 matches is a small sample. Re-audit once the corpus passes
~100 mentions; the failure rate here (24%) should be treated as indicative,
not precise.

**Theme status:** news-signal stays at ~70% until the prompt tuning lands.
The tuning is small and well-scoped — it is the carried "HO 86 pre-filter /
matcher tuning" thread closing as a concrete next handoff, not an open-ended
investigation.
