// HO 419 — Voteview DW-NOMINATE source loader (shared by sync-ideology.ts and
// the ideology-coverage-419 diagnostic).
//
// Both consumers need the live 119th member file: the sync to write scores, the
// diagnostic to compute the off-roster skip count and the party_code-vs-members
// disagreements (neither of which is stored in member_ideology). Extracting the
// fetch + parse here keeps them byte-for-byte identical.
//
// Served as a static application/octet-stream file, HTTP 200, no bot wall — read
// as UTF-8 text and parse; do NOT gate on content-type (verified HO 419).
//
// THE TRAP: `bioname` is a quoted field with an embedded comma
// ("ROGERS, Mike Dennis") sitting BEFORE bioguide_id and every nominate_* field.
// A naive split(',') shifts all later columns one right and silently corrupts the
// scores. Parse quote-aware and index columns by header NAME. The parser below is
// vendored from scripts/sync-palestine.ts (a working sync — not refactored to
// dedup ~15 lines); no npm CSV package is added.

// Both chambers, 119th only (~535 rows) — not the ~50k-row HSall history. File
// scheme confirmed by UCLA: HSnnn_members.csv for both chambers of congress nnn.
export const VOTEVIEW_119_URL =
  "https://voteview.com/static/data/out/members/HS119_members.csv";

// Quote-aware CSV tokenizer — handles quoted fields with embedded commas/newlines
// and the doubled-quote ("") escape.
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

// One 119th Voteview member row, columns picked by header name. Numeric fields
// with no estimate yet (a member with zero votes) come through as null.
export type VoteviewMember = {
  congress: number;
  chamber: string; // 'House' | 'Senate' | 'President'
  icpsr: number;
  state_abbrev: string;
  party_code: number | null; // 100=D, 200=R, 328=I
  bioname: string;
  bioguide_id: string; // '' for the President row (gated out downstream)
  nominate_dim1: number | null; // headline: economic left/right
  nominate_dim2: number | null;
  nokken_poole_dim1: number | null; // per-congress variant
  nokken_poole_dim2: number | null;
  number_of_votes: number | null; // nominate_number_of_votes
  conditional: number | null; // 1 = provisional estimate
};

function numOrNull(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Fetch + parse HS119_members.csv into header-indexed rows. Throws on non-200 or
// an empty/headerless body. Does not gate on membership — callers apply that.
export async function fetchVoteview119(): Promise<VoteviewMember[]> {
  const res = await fetch(VOTEVIEW_119_URL);
  if (!res.ok) {
    throw new Error(`${VOTEVIEW_119_URL} HTTP ${res.status}`);
  }
  const rows = parseCSV(await res.text());
  const header = rows[0];
  if (!header || header.length === 0) {
    throw new Error("HS119_members.csv returned no rows — aborting");
  }

  // Column name -> index. Parsing by name (not position) is the whole defense
  // against the bioname-comma shift.
  const col = new Map<string, number>();
  header.forEach((name, i) => col.set(name.trim(), i));
  const require = (name: string): number => {
    const i = col.get(name);
    if (i === undefined) {
      throw new Error(`HS119_members.csv missing expected column '${name}'`);
    }
    return i;
  };

  const iCongress = require("congress");
  const iChamber = require("chamber");
  const iIcpsr = require("icpsr");
  const iState = require("state_abbrev");
  const iParty = require("party_code");
  const iBioname = require("bioname");
  const iBioguide = require("bioguide_id");
  const iDim1 = require("nominate_dim1");
  const iDim2 = require("nominate_dim2");
  const iVotes = require("nominate_number_of_votes");
  const iConditional = require("conditional");
  const iNp1 = require("nokken_poole_dim1");
  const iNp2 = require("nokken_poole_dim2");

  const out: VoteviewMember[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length <= iBioguide) continue; // trailing blank line
    out.push({
      congress: Number(row[iCongress]),
      chamber: (row[iChamber] ?? "").trim(),
      icpsr: Number(row[iIcpsr]),
      state_abbrev: (row[iState] ?? "").trim(),
      party_code: numOrNull(row[iParty]),
      bioname: (row[iBioname] ?? "").trim(),
      bioguide_id: (row[iBioguide] ?? "").trim(),
      nominate_dim1: numOrNull(row[iDim1]),
      nominate_dim2: numOrNull(row[iDim2]),
      nokken_poole_dim1: numOrNull(row[iNp1]),
      nokken_poole_dim2: numOrNull(row[iNp2]),
      number_of_votes: numOrNull(row[iVotes]),
      conditional: numOrNull(row[iConditional]),
    });
  }
  return out;
}
