// Senate primary candidate scraper (handoff 91 Step 3). Pulls 2026 Senate
// primary rosters from Ballotpedia per-state election pages.
//
// URL: https://ballotpedia.org/United_States_Senate_election_in_{State},_2026
// — SINGULAR "election_in". The handoff's plural "elections_in" 404s.
//
// Each page's "Candidates and election results" section holds Ballotpedia
// "votebox" blocks. A votebox opens with <div class="race_header {party}">
// labelling the contest (democratic / republican / general), followed by a
// <table class="results_table"> of <tr class="results_row ..."> rows — one
// per candidate. The candidate name is the <a> in the
// votebox-results-cell--text cell; incumbents are <u>-wrapped; the winner
// row carries a "winner" class.
//
// Parsing: regex, same approach as lib/race-ratings-scrape.ts and
// lib/primary-calendar-scrape.ts — no HTML-parser dependency. Each state is
// classified (ok / no_page / no_section / no_candidates) so the sync can
// report failures rather than silently producing empty rosters.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type ScrapedSenateCandidate = {
  name: string;
  party: "D" | "R";
  incumbent: boolean;
  isWinner: boolean;
};

export type SenateScrapeStatus =
  | "ok"
  | "no_page"
  | "no_section"
  | "no_candidates";

export type SenateScrapeResult = {
  state: string;
  url: string;
  status: SenateScrapeStatus;
  candidates: ScrapedSenateCandidate[];
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#0?34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .trim();
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

export function senatePageUrl(slug: string): string {
  return `https://ballotpedia.org/United_States_Senate_election_in_${slug},_2026`;
}

// Parse one D/R votebox slice into candidate rows. `party` comes from the
// votebox's race_header class.
function parseVotebox(
  slice: string,
  party: "D" | "R",
): ScrapedSenateCandidate[] {
  const out: ScrapedSenateCandidate[] = [];
  // The first results_table after the race_header is this contest's roster.
  const table = slice.match(
    /<table class="results_table">[\s\S]*?<\/table>/,
  )?.[0];
  if (!table) return out;
  const rows = table.match(/<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    // The candidate is the row's lone ballotpedia.org person link.
    const link = row.match(
      /<a [^>]*href="https:\/\/ballotpedia\.org\/[^"]*"[^>]*>([\s\S]*?)<\/a>/,
    );
    const name = link?.[1] ? stripTags(link[1]) : "";
    if (!name) continue; // "Other/Write-in" aggregate rows carry no link
    out.push({
      name,
      party,
      incumbent: /<u>/.test(row), // Ballotpedia underlines incumbents
      isWinner: /class="results_row[^"]*\bwinner\b/.test(row),
    });
  }
  return out;
}

export async function scrapeSenateCandidates(
  state: string,
  slug: string,
): Promise<SenateScrapeResult> {
  const url = senatePageUrl(slug);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
    });
  } catch {
    return { state, url, status: "no_page", candidates: [] };
  }
  if (!res.ok) return { state, url, status: "no_page", candidates: [] };
  const html = await res.text();

  const anchor = html.indexOf('id="Candidates_and_election_results"');
  if (anchor === -1) {
    return { state, url, status: "no_section", candidates: [] };
  }
  // The section runs from its heading to the next <h2.
  const nextH2 = html.indexOf("<h2", anchor + 10);
  const section = html.slice(
    anchor,
    nextH2 === -1 ? anchor + 80000 : nextH2,
  );

  // Every race_header (general / democratic / republican) is a slice
  // boundary; only democratic and republican voteboxes carry primary rosters.
  const headers = [
    ...section.matchAll(/<div class="race_header([^"]*)">/g),
  ];
  const candidates: ScrapedSenateCandidate[] = [];
  // Dedup by (party, name): a runoff votebox repeats a subset of the primary
  // roster, and some pages echo a candidate across blocks.
  const seen = new Set<string>();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    const cls = h[1] ?? "";
    const party = cls.includes("democratic")
      ? "D"
      : cls.includes("republican")
        ? "R"
        : null;
    if (!party) continue;
    const start = h.index ?? 0;
    const end =
      i + 1 < headers.length
        ? (headers[i + 1]!.index ?? section.length)
        : section.length;
    const slice = section.slice(start, end);
    // Skip runoff voteboxes — a runoff is a separate contest whose roster is
    // a subset of the primary's; parsing it would double-count candidates.
    const headerText = stripTags(
      slice.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? "",
    );
    if (/runoff/i.test(headerText)) continue;
    for (const c of parseVotebox(slice, party)) {
      const key = `${c.party}|${c.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(c);
    }
  }

  if (candidates.length === 0) {
    return { state, url, status: "no_candidates", candidates: [] };
  }
  return { state, url, status: "ok", candidates };
}
