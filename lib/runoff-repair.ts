// HO 761 — repair:runoffs. The runoff rounds Ballotpedia already prints, read
// once from every page whose first round carries a past runoff_date, and
// written the way the sync now writes them (lib/primaries-sync.ts,
// writeRunoffRounds): a missing runoff row arrives with its marks in one batch;
// an existing one (the seeded three) is updated by name. The one difference
// from the cron is `reopenExpired`: the seeded GA and LA rows sat past-dated,
// unmarked and older than the HO 661 window at HO 761's STEP 0, which isSettled
// reads as settled, so the cron alone would never mark them.
//
// WHICH PAGES. Every first round (election_round 'primary') with a runoff_date
// before today, one page per House district and one per Senate state (a
// special's first round shares its state's page, as SC's does). A runoff_date
// today or later is left out and listed: Louisiana's House Dec 12 is its own
// line. At HO 761's STEP 0: 215 first rounds, 110 pages, 6 of them LA's House.
//
// HOW. The ballot reader's fetch (lib/general-ballot.ts readRacePage): its URL
// builders, its user agent, one attempt, a page READ only with the candidates
// anchor, so a challenge page never reads as "no runoff". The caller supplies
// the IO; the CLI paces it at the reader's 6s start to start. The first UNREAD
// page ends the pass (the reader's rule): what was read stays written, and a
// re-run picks up the rest, because a decided runoff row is skipped as settled.
//
// Read-only unless the caller passes write: true (the CLI's --write).
import type { Client } from "@libsql/client";
import { readRacePage, type IO } from "./general-ballot";
import { parseCandidatesPage } from "./primary-candidates-scrape";
import {
  createRunoffWriter,
  emptyRunoffReport,
  settleWindowFloor,
  type RunoffPage,
  type RunoffWriteReport,
} from "./primaries-sync";

export type RunoffUnit = RunoffPage & { raceId: string; firstRounds: string[] };
export type RunoffPageLine = { raceId: string; verdict: string; cause: string | null; url: string; boxes: number };
export type RunoffRepairResult = {
  at: string;
  write: boolean;
  units: number;
  leftFuture: string[]; // "id (runoff_date)" — first rounds whose runoff is today or later
  pages: RunoffPageLine[];
  noPage: string[];
  stoppedAt: string | null; // the first UNREAD page, which ended the pass
  notReached: string[];
  report: RunoffWriteReport;
};

export async function runoffRepairUnits(
  db: Client,
  today: string,
): Promise<{ units: RunoffUnit[]; leftFuture: string[] }> {
  const rs = await db.execute(
    `SELECT id, state, chamber, district, runoff_date FROM primaries
      WHERE election_round = 'primary' AND runoff_date IS NOT NULL
      ORDER BY chamber DESC, state, district, id`,
  );
  const units = new Map<string, RunoffUnit>();
  const leftFuture: string[] = [];
  for (const r of rs.rows) {
    const id = String(r.id);
    const runoffDate = String(r.runoff_date);
    if (runoffDate >= today) {
      leftFuture.push(`${id} (${runoffDate})`);
      continue;
    }
    const state = String(r.state);
    const senate = r.chamber === "senate";
    const dd = senate ? null : String(r.district ?? "00");
    const raceId = senate ? `S-${state}-2026` : `${state}-${dd === "00" ? "AL" : dd}-2026`;
    const u =
      units.get(raceId) ??
      units
        .set(raceId, { raceId, chamber: senate ? "senate" : "house", state, district: senate ? null : Number(dd), firstRounds: [] })
        .get(raceId)!;
    u.firstRounds.push(id);
  }
  return { units: [...units.values()], leftFuture };
}

export async function repairRunoffs(
  db: Client,
  io: IO,
  opts: { write: boolean; log?: (line: string) => void },
): Promise<RunoffRepairResult> {
  const log = opts.log ?? (() => {});
  const now = new Date().toISOString();
  const at = { now, today: now.slice(0, 10), windowFloor: settleWindowFloor(now) };
  const { units, leftFuture } = await runoffRepairUnits(db, at.today);
  const write = await createRunoffWriter(db);
  const report = emptyRunoffReport();
  const pages: RunoffPageLine[] = [];
  const noPage: string[] = [];
  let stoppedAt: string | null = null;
  const notReached: string[] = [];
  for (const u of units) {
    if (stoppedAt) {
      notReached.push(u.raceId);
      continue;
    }
    const page = await readRacePage({ id: u.raceId, chamber: u.chamber, state: u.state, district: u.district }, io);
    if (page.verdict === "NO_PAGE") {
      noPage.push(`${u.raceId} (${page.url})`);
      pages.push({ raceId: u.raceId, verdict: page.verdict, cause: page.cause, url: page.url, boxes: 0 });
      log(`${u.raceId} · NO_PAGE ${page.url}`);
      continue;
    }
    if (page.verdict !== "READ" || !page.html) {
      stoppedAt = `${u.raceId} (${page.cause ?? "unread"}, ${page.url})`;
      pages.push({ raceId: u.raceId, verdict: page.verdict, cause: page.cause, url: page.url, boxes: 0 });
      log(`${u.raceId} · UNREAD ${page.cause} ${page.url} — the pass stops here`);
      continue;
    }
    const parsed = parseCandidatesPage(page.html, u.state, page.url);
    const runoffs = parsed.runoffs ?? [];
    const before = JSON.stringify(report);
    await write(u, runoffs, at, { write: opts.write, reopenExpired: true }, report);
    pages.push({ raceId: u.raceId, verdict: page.verdict, cause: page.cause, url: page.url, boxes: runoffs.length });
    // A dry run's report says what a write would do, and its line says so.
    log(`${u.raceId} · READ · ${runoffs.length} runoff box${runoffs.length === 1 ? "" : "es"}${runoffs.length ? ` · ${opts.write ? "" : "dry, nothing written: "}${diffReport(before, report)}` : ""}`);
  }
  return { at: now, write: opts.write, units: units.length, leftFuture, pages, noPage, stoppedAt, notReached, report };
}

// What one page added to the report, for its log line.
function diffReport(before: string, after: RunoffWriteReport): string {
  const b = JSON.parse(before) as RunoffWriteReport;
  const parts: string[] = [];
  for (const k of Object.keys(after) as (keyof RunoffWriteReport)[]) {
    const a = after[k];
    const p = b[k];
    if (Array.isArray(a) && Array.isArray(p) && a.length > p.length) parts.push(`${k}: ${a.slice(p.length).join("; ")}`);
  }
  return parts.join(" · ") || "no change";
}
