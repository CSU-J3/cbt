// Senate primary candidate scraper (handoff 91 Step 3, +edge-case fixes).
// Pulls 2026 Senate primary rosters from Ballotpedia per-state election pages.
//
// URL: https://ballotpedia.org/United_States_Senate_election_in_{State},_2026
// — SINGULAR "election_in". On a 404 the scraper retries the special-election
// URL (United_States_Senate_special_election_in_{State},_2026), which is how
// the FL and OH 2026 specials are published.
//
// Each page's "Candidates and election results" section holds Ballotpedia
// "votebox" blocks. A votebox opens with <div class="race_header {kind}">
// — democratic / republican / nonpartisan — followed by a
// <table class="results_table"> of <tr class="results_row ..."> rows, one per
// candidate. democratic/republican voteboxes are partisan primaries; a
// nonpartisan votebox is either a top-N primary (AK) or a general election —
// the <h5> text disambiguates ("primary" vs "general"). In a nonpartisan
// votebox each candidate's own party comes from the
// image-candidate-thumbnail-wrapper class on the row. Runoff voteboxes are
// skipped (their roster is a subset of the primary's). Candidate name is the
// <a> in the votebox-results-cell--text cell; incumbents are <u>-wrapped; the
// winner row carries a "winner" class.
//
// Parsing: regex, same approach as lib/race-ratings-scrape.ts and
// lib/primary-calendar-scrape.ts — no HTML-parser dependency.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Which primary row a candidate belongs to: the D or R partisan primary, or
// the "open" all-candidate primary (top-two / top-four / nonpartisan states).
export type CandidateContest = "D" | "R" | "open";

export type ScrapedSenateCandidate = {
  name: string;
  contest: CandidateContest;
  party: string; // the candidate's own party letter (D/R/L/G/I/...)
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

export function senateSpecialPageUrl(slug: string): string {
  return `https://ballotpedia.org/United_States_Senate_special_election_in_${slug},_2026`;
}

// Ballotpedia's full party word -> the one-letter code stored on candidates.
function partyLetter(word: string): string {
  const w = word.toLowerCase();
  if (w.startsWith("republican")) return "R";
  if (w.startsWith("democratic")) return "D";
  if (w.startsWith("libertarian")) return "L";
  if (w.startsWith("green")) return "G";
  if (w.startsWith("independent")) return "I";
  return "I"; // nonpartisan / unaffiliated / unknown
}

// Parse one votebox slice into candidate rows. For D/R contests every row is
// that party; for an "open" contest the party is read per-row.
function parseVotebox(
  slice: string,
  contest: CandidateContest,
): ScrapedSenateCandidate[] {
  const out: ScrapedSenateCandidate[] = [];
  const table = slice.match(
    /<table class="results_table">[\s\S]*?<\/table>/,
  )?.[0];
  if (!table) return out;
  const rows = table.match(/<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    const link = row.match(
      /<a [^>]*href="https:\/\/ballotpedia\.org\/[^"]*"[^>]*>([\s\S]*?)<\/a>/,
    );
    const name = link?.[1] ? stripTags(link[1]) : "";
    if (!name) continue; // "Other/Write-in" aggregate rows carry no link
    let party: string;
    if (contest === "open") {
      const wrap = row.match(/image-candidate-thumbnail-wrapper\s+(\w+)/);
      party = wrap?.[1] ? partyLetter(wrap[1]) : "I";
    } else {
      party = contest; // D or R
    }
    out.push({
      name,
      contest,
      party,
      incumbent: /<u>/.test(row), // Ballotpedia underlines incumbents
      isWinner: /class="results_row[^"]*\bwinner\b/.test(row),
    });
  }
  return out;
}

async function fetchPage(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
    });
    return res;
  } catch {
    return null;
  }
}

export async function scrapeSenateCandidates(
  state: string,
  slug: string,
): Promise<SenateScrapeResult> {
  // Try the standard election page; fall back to the special-election URL
  // (FL / OH 2026 specials live there).
  let url = senatePageUrl(slug);
  let res = await fetchPage(url);
  if (!res || !res.ok) {
    url = senateSpecialPageUrl(slug);
    res = await fetchPage(url);
  }
  if (!res || !res.ok) {
    return { state, url, status: "no_page", candidates: [] };
  }
  const html = await res.text();

  const anchor = html.indexOf('id="Candidates_and_election_results"');
  if (anchor === -1) {
    return { state, url, status: "no_section", candidates: [] };
  }
  const nextH2 = html.indexOf("<h2", anchor + 10);
  const section = html.slice(anchor, nextH2 === -1 ? anchor + 80000 : nextH2);

  const headers = [
    ...section.matchAll(/<div class="race_header([^"]*)">/g),
  ];
  const candidates: ScrapedSenateCandidate[] = [];
  // Dedup by (contest, name): a runoff repeats a subset of the primary
  // roster, and some pages echo a candidate across blocks.
  const seen = new Set<string>();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    const cls = h[1] ?? "";
    const contest: CandidateContest | null = cls.includes("democratic")
      ? "D"
      : cls.includes("republican")
        ? "R"
        : cls.includes("nonpartisan")
          ? "open"
          : null;
    if (!contest) continue;

    const start = h.index ?? 0;
    const end =
      i + 1 < headers.length
        ? (headers[i + 1]!.index ?? section.length)
        : section.length;
    const slice = section.slice(start, end);

    // Keep only primary voteboxes: the <h5> says "primary" and not "runoff".
    // This drops general-election voteboxes (also "nonpartisan"-classed) and
    // primary-runoff voteboxes (a subset of the primary).
    const headerText = stripTags(
      slice.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? "",
    );
    if (!/primary/i.test(headerText) || /runoff/i.test(headerText)) continue;

    for (const c of parseVotebox(slice, contest)) {
      const key = `${c.contest}|${c.name.toLowerCase()}`;
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
