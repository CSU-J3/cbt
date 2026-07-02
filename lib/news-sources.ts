// RSS feed configuration for handoff 64. All three URLs verified live
// (HTTP 200 + XML content type) at 2026-05-16. If `news_mentions` stops
// growing, first thing to check is whether publishers moved feeds — see
// the watch-out in SKILL.md.

import type { Credibility, Reliability } from "./observation";

export interface NewsSource {
  slug: string; // stored in news_mentions.source
  display: string;
  feedUrl: string;
  // HO 394: per-source Admiralty grade baseline for the Observation (the
  // principled version of match_confidence). Grading is part of ingest: an
  // established congressional outlet is a different trust level than an
  // aggregator. The three current feeds are reputable specialist/mainstream
  // congressional coverage → B2 ("usually reliable" / "probably true"); a later
  // stage can revise upward on corroboration. Soften an individual feed here if
  // warranted — this is the single place source trust is set.
  reliability: Reliability;
  credibility: Credibility;
}

export const NEWS_SOURCES: NewsSource[] = [
  {
    slug: "politico",
    display: "Politico",
    feedUrl: "https://rss.politico.com/congress.xml",
    reliability: "B",
    credibility: 2,
  },
  {
    slug: "the_hill",
    display: "The Hill",
    feedUrl: "https://thehill.com/homenews/feed/",
    reliability: "B",
    credibility: 2,
  },
  {
    slug: "roll_call",
    display: "Roll Call",
    feedUrl: "https://rollcall.com/feed/",
    reliability: "B",
    credibility: 2,
  },
];
