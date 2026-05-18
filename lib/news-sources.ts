// RSS feed configuration for handoff 64. All three URLs verified live
// (HTTP 200 + XML content type) at 2026-05-16. If `news_mentions` stops
// growing, first thing to check is whether publishers moved feeds — see
// the watch-out in SKILL.md.

export interface NewsSource {
  slug: string; // stored in news_mentions.source
  display: string;
  feedUrl: string;
}

export const NEWS_SOURCES: NewsSource[] = [
  {
    slug: "politico",
    display: "Politico",
    feedUrl: "https://rss.politico.com/congress.xml",
  },
  {
    slug: "the_hill",
    display: "The Hill",
    feedUrl: "https://thehill.com/homenews/feed/",
  },
  {
    slug: "roll_call",
    display: "Roll Call",
    feedUrl: "https://rollcall.com/feed/",
  },
];
