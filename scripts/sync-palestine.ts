// handoff 90: pulls the USCPR Senate Palestine voting scorecard from a public
// Google Sheet and upserts it into `palestine_scorecard`. The sheet is the
// authoritative source — no LLM matching. Members are matched by last name +
// state against the `members` table; unmatched rows are logged and skipped.
import "dotenv/config";
import { getDb } from "../lib/db";

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1VU1y_jSb2hanU2MrLsjRx8tujB-C--UAQ2EahaTXGUo/export?format=csv&gid=1260635943";

// The 23 vote/sponsorship columns by 0-based index into the raw CSV row
// (columns 9-31 in the sheet's 1-based numbering).
const VOTE_COLUMN_INDICES = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30,
];

// Column indices for key metadata.
const COL = {
  grade: 0,
  rank: 1,
  firstName: 2,
  lastName: 3,
  state: 4,
  sponsorScore: 5,
  votingScore: 6,
  totalScore: 7,
};

// Basic CSV parser — handles quoted fields with embedded commas/newlines and
// the doubled-quote ("") escape.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      current.push(field);
      field = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      current.push(field);
      field = "";
      rows.push(current);
      current = [];
    } else {
      field += ch;
    }
  }
  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

// Convert a full state name to its 2-letter abbreviation (the sheet uses full
// names; the members table uses abbreviations).
function stateAbbr(name: string): string {
  const map: Record<string, string> = {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
    Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
    Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
    Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
    Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO",
    Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
    Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
    Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  };
  return map[name] ?? name;
}

async function main() {
  const db = getDb();
  const now = new Date().toISOString();

  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const text = await res.text();

  const rows = parseCSV(text);
  const headerRow = rows[0];
  if (!headerRow) throw new Error("Sheet returned no rows");

  // Build vote labels from the header row at the vote column positions.
  const voteLabels = VOTE_COLUMN_INDICES.map(
    (i) => headerRow[i]?.trim() ?? `vote_${i}`,
  );

  let upserted = 0;
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const firstName = row[COL.firstName]?.trim();
    const lastName = row[COL.lastName]?.trim();
    const state = row[COL.state]?.trim();
    const grade = row[COL.grade]?.trim();

    if (!firstName || !lastName || !state || !grade) continue;

    // Match to the members table by last name + state (Senate only). The
    // sheet's first-name variants (e.g. "Bernie" vs "Bernard") are sidestepped
    // by matching on last name only.
    const memberResult = await db.execute({
      sql: `SELECT bioguide_id FROM members
            WHERE LOWER(name) LIKE LOWER(?) AND state = ?
              AND chamber = 'senate'
            LIMIT 1`,
      args: [`%${lastName}%`, stateAbbr(state)],
    });

    const bioguideId = memberResult.rows[0]?.bioguide_id as string | undefined;
    if (!bioguideId) {
      console.log(`  No match: ${firstName} ${lastName} (${state})`);
      skipped++;
      continue;
    }

    // Build the votes JSON object.
    const votesObj: Record<string, string> = {};
    VOTE_COLUMN_INDICES.forEach((colIndex, j) => {
      const val = row[colIndex]?.trim();
      const label = voteLabels[j];
      if (val && label) votesObj[label] = val;
    });

    await db.execute({
      sql: `INSERT INTO palestine_scorecard
              (bioguide_id, grade, rank, sponsor_score, voting_score, total_score, votes_json, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bioguide_id) DO UPDATE SET
              grade = excluded.grade,
              rank = excluded.rank,
              sponsor_score = excluded.sponsor_score,
              voting_score = excluded.voting_score,
              total_score = excluded.total_score,
              votes_json = excluded.votes_json,
              synced_at = excluded.synced_at`,
      args: [
        bioguideId,
        grade,
        parseInt(row[COL.rank] ?? "") || null,
        row[COL.sponsorScore]?.trim() ?? null,
        row[COL.votingScore]?.trim() ?? null,
        row[COL.totalScore]?.trim() ?? null,
        JSON.stringify(votesObj),
        now,
      ],
    });
    upserted++;
  }

  console.log(
    `Done — upserted: ${upserted}, skipped (no member match): ${skipped}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
