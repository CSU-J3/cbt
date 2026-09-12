// HO 717: one pass over every synced 119th committee meeting, detail re-fetched,
// its meetingDocuments[] written to committee_meeting_documents as filed.
//
// Why it exists: the sync only re-reads an event when its updateDate passes the
// watermark, so every event synced before HO 717 was fetched while documents were
// still being discarded. Documents only — writeMeetingDocuments touches neither
// committee_meetings nor meeting_bills, so no cursor moves and no column the walk
// owns is rewritten. Idempotent: the per-event write is delete-then-insert, so a
// second run rewrites the same rows.
//
// A detail that answers 200 without a JSON committeeMeeting is counted as a
// soft_404_page and NOT written (HO 715: a 200 is not a file) — its existing rows,
// if any, stay. A 404 is counted as gone_upstream and does not fail the run: the
// first run met 14, all events committee_meetings still holds that Congress.gov has
// since deleted (the sync never deletes). Any other HTTP error is counted and fails
// the run; network failures retry 3x and fail it too.
//
//   npm run backfill:meeting-documents
//   npm run backfill:meeting-documents -- --chamber house --limit 200
import "dotenv/config";
import { getDb } from "../lib/db";
import { type ApiMeeting, writeMeetingDocuments } from "../lib/meetings-sync";

const API_BASE = "https://api.congress.gov/v3";
const CONGRESS = 119;
const CONCURRENCY = 4;
const SLEEP_MS = 80; // per worker between calls — shares the CONGRESS_API_KEY budget

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const key = process.env.CONGRESS_API_KEY?.trim();
  if (!key) throw new Error("CONGRESS_API_KEY is not set");
  const chamber = arg("chamber");
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  if (chamber && chamber !== "house" && chamber !== "senate") throw new Error(`bad --chamber ${chamber}`);

  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT event_id, chamber FROM committee_meetings
          WHERE congress = ? ${chamber ? "AND chamber = ?" : ""}
          ORDER BY chamber, event_id${limit ? " LIMIT ?" : ""}`,
    args: [CONGRESS, ...(chamber ? [chamber] : []), ...(limit ? [limit] : [])],
  });
  const events = rs.rows.map((r) => ({ id: String(r.event_id), chamber: String(r.chamber) }));
  console.log(`[backfill:meeting-documents] ${events.length} events (congress ${CONGRESS}${chamber ? `, ${chamber}` : ""})`);

  const t0 = Date.now();
  let next = 0;
  let requests = 0;
  let eventsRead = 0;
  let documentsStored = 0;
  let recordedVoteDocs = 0;
  let soft404 = 0;
  let goneUpstream = 0;
  let httpErrors = 0;
  let networkFailures = 0;
  let rlFirst: string | null = null;
  let rlLast: string | null = null;
  const soft404Ids: string[] = [];
  const goneIds: string[] = [];
  const httpErrorIds: string[] = [];

  async function worker() {
    while (next < events.length) {
      const e = events[next++];
      if (!e) break;
      const url = `${API_BASE}/committee-meeting/${CONGRESS}/${e.chamber}/${e.id}?api_key=${key}&format=json`;
      let res: Response | null = null;
      let body = "";
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try {
          requests++;
          const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
          body = await r.text();
          res = r;
        } catch {
          await sleep(1000 * (attempt + 1));
        }
      }
      if (!res) {
        networkFailures++;
        continue;
      }
      const rl = res.headers.get("x-ratelimit-remaining");
      if (rl) {
        rlFirst ??= rl;
        rlLast = rl;
      }
      if (res.status === 404) {
        goneUpstream++;
        goneIds.push(`${e.chamber}/${e.id}`);
        continue;
      }
      if (!res.ok) {
        httpErrors++;
        httpErrorIds.push(`${e.chamber}/${e.id}:${res.status}`);
        continue;
      }
      let m: ApiMeeting | undefined;
      try {
        m = (JSON.parse(body) as { committeeMeeting?: ApiMeeting }).committeeMeeting;
      } catch {
        m = undefined;
      }
      if (!m || !m.eventId) {
        soft404++;
        soft404Ids.push(`${e.chamber}/${e.id}`);
        continue;
      }
      const w = await writeMeetingDocuments(m);
      eventsRead++;
      documentsStored += w.documents;
      recordedVoteDocs += w.recordedVoteDocs;
      if (eventsRead % 250 === 0) {
        console.log(`  … ${eventsRead}/${events.length} read, documents_stored=${documentsStored}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
      await sleep(SLEEP_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const secs = (Date.now() - t0) / 1000;
  console.log(`\n[backfill:meeting-documents] done in ${secs.toFixed(1)}s`);
  console.log(`  events_read=${eventsRead} documents_stored=${documentsStored} recorded_vote_docs=${recordedVoteDocs} soft_404_pages=${soft404}`);
  console.log(`  gone_upstream=${goneUpstream} http_errors=${httpErrors} network_failures=${networkFailures}`);
  console.log(`  budget: ${requests} api.congress.gov requests; x-ratelimit-remaining ${rlFirst} → ${rlLast} (limit 20,000/hour)`);
  if (soft404Ids.length) console.log(`  soft_404: ${soft404Ids.slice(0, 20).join(", ")}`);
  if (goneIds.length) console.log(`  gone_upstream: ${goneIds.slice(0, 20).join(", ")}`);
  if (httpErrorIds.length) console.log(`  http_errors: ${httpErrorIds.slice(0, 20).join(", ")}`);
  process.exit(httpErrors || networkFailures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
