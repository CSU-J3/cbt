// Primary-calendar scraper (handoff 91). Pulls every 2026 state congressional
// primary date from 270toWin's statewide primary calendar.
//
// The calendar is a single server-rendered table. Date-header rows carry one
// cell (`<td rowspan=N>March 3</td>`); each contest row that follows carries
// two cells (`<a>State</a>` + an "elections" cell like "D R Primaries" /
// "D R Runoffs" / "ALL Top 2 Primaries"). A contest row's date is the most
// recent date-header above it — the `<sup>N</sup>` inside a contest cell is a
// footnote marker, NOT a date index. "...General Election" / "...General
// Runoffs" rows are skipped (those aren't primaries).
//
// Parsing: regex over the table rather than an HTML-parser dependency, same
// approach as lib/race-ratings-scrape.ts. A count check throws if fewer than
// 50 state primaries are found, so a 270toWin restructure fails loud.

import { stateAbbr } from "./states";

const CALENDAR_URL = "https://www.270towin.com/2026-state-primary-calendar/";

// Browser-ish UA — 270toWin is fine with it; matches the race-ratings scraper.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type PrimaryType =
  | "closed"
  | "open"
  | "top_two"
  | "top_four"
  | "ranked_choice";

export type StatePrimaryDate = {
  state: string; // 2-letter abbreviation
  primaryDate: string; // ISO date
  runoffDate: string | null;
  primaryType: PrimaryType;
};

// 270toWin marks CA/WA "Top 2" and AK "Top 4" in the table; open-vs-closed for
// the rest isn't on the page, so non-special states default to "open". Maine
// runs ranked-choice tabulation. (DC has no congressional primary on the
// calendar but is kept here for completeness.)
const TOP_TWO_STATES = new Set(["CA", "WA"]);
const TOP_FOUR_STATES = new Set(["AK"]);
const RANKED_CHOICE_STATES = new Set(["ME", "DC"]);

const EXPECTED_STATE_PRIMARIES = 50;

const MONTHS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
};

function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryTypeFor(abbr: string): PrimaryType {
  if (TOP_TWO_STATES.has(abbr)) return "top_two";
  if (TOP_FOUR_STATES.has(abbr)) return "top_four";
  if (RANKED_CHOICE_STATES.has(abbr)) return "ranked_choice";
  return "open";
}

// "March 3" -> "2026-03-03"; null when the text isn't a bare month-day.
function parseDate(text: string): string | null {
  const m = text.match(/^([A-Z][a-z]+)\s+(\d{1,2})$/);
  if (!m || !m[1] || !m[2]) return null;
  const mm = MONTHS[m[1]];
  if (!mm) return null;
  return `2026-${mm}-${m[2].padStart(2, "0")}`;
}

export async function scrapeStatePrimaryCalendar(): Promise<
  StatePrimaryDate[]
> {
  const res = await fetch(CALENDAR_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`270toWin fetch ${res.status}: ${CALENDAR_URL}`);
  const html = await res.text();

  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0];
  if (!table) throw new Error("270toWin: calendar table not found");
  const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];

  const byState = new Map<string, StatePrimaryDate>();
  let currentDate: string | null = null;

  for (const row of rows) {
    const cells = row.match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? [];

    if (cells.length === 1) {
      // Date-header row.
      const d = parseDate(strip(cells[0]!));
      if (d) currentDate = d;
      continue;
    }
    if (cells.length !== 2) continue; // 3-cell header row, anything else

    const electionText = strip(cells[1]!);
    // Skip general-election / general-runoff rows — not primaries. Checked
    // before the runoff branch, since a general-runoff row also says "Runoff".
    if (/general/i.test(electionText)) continue;

    const abbr = stateAbbr(strip(cells[0]!));
    if (!abbr) continue; // "National" and anything not a recognized state
    if (!currentDate) continue; // contest row before any date header

    const entry = byState.get(abbr) ?? {
      state: abbr,
      primaryDate: "",
      runoffDate: null,
      primaryType: primaryTypeFor(abbr),
    };
    if (/runoff/i.test(electionText)) {
      entry.runoffDate = currentDate;
    } else {
      entry.primaryDate = currentDate;
    }
    byState.set(abbr, entry);
  }

  const out = [...byState.values()].filter((e) => e.primaryDate);
  if (out.length < EXPECTED_STATE_PRIMARIES) {
    throw new Error(
      `270toWin calendar shape changed: got ${out.length} state primaries, expected ${EXPECTED_STATE_PRIMARIES}`,
    );
  }
  return out;
}

export const PRIMARY_CALENDAR_URL = CALENDAR_URL;
