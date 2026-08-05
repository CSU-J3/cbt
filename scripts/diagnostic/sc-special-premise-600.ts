// HO 600 STEP 0 — the SC Aug-11 special primary: four measurements, READ-ONLY.
//
// M1  the seeded senate-SC-2026-special-{D,R} rows, their blast radius across
//     every surface that reads them, and what the shipped getPrimaryForRace
//     resolves for both SC senators.
// M2  has the HO 561 C2 dated priority trigger fired since the window opened
//     (2026-08-04), what it returned, and did the cursor stay put (the C2 contract).
// M3  does ANY Ballotpedia page carry the August 11 field, and at what URL —
//     (a) the shape senateSpecialPageUrl builds today, (b) parenthetical shapes
//     on the regular race page (discovered from the page's own links, not
//     guessed), (c) the regular page itself. Plus the substitution-hazard check:
//     if the regular page now carries an August votebox, did the HO 560 C2
//     settled freeze hold on the June row?
// M4  on whatever page carries the August field, does its votebox map to R, or
//     fall through to `open`?
//
// EVERY DB statement goes through sel(), which refuses anything that is not a
// SELECT/WITH. Every network call is a GET. Nothing here writes.
//
//   npx tsx scripts/diagnostic/sc-special-premise-600.ts
import "dotenv/config";
import { getDb } from "../../lib/db";
import {
  getDashboardPrimaries,
  getPrimaryCalendar,
  getPrimaryForRace,
} from "../../lib/queries";
import { parseCandidatesPage } from "../../lib/primary-candidates-scrape";

const SPECIAL_D = "senate-SC-2026-special-D";
const SPECIAL_R = "senate-SC-2026-special-R";
const JUNE_D = "senate-SC-2026-D";
const JUNE_R = "senate-SC-2026-R";
const WINDOW_FROM = "2026-08-04T00:00:00Z";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ANCHOR = 'id="Candidates_and_election_results"';

const db = getDb();

// Read-only gate. A non-SELECT throws rather than executing — this script is a
// measurement, and the one destructive thing in its blast radius (§3's delete)
// is deliberately NOT here.
async function sel(sql: string, args: unknown[] = []) {
  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new Error(`refused non-SELECT statement: ${sql.slice(0, 60)}`);
  }
  return db.execute({ sql, args: args as never[] });
}

function hr(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

async function get(url: string): Promise<{ status: number; html: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    const html = res.ok ? await res.text() : "";
    return { status: res.status, html };
  } catch (e) {
    console.log(`    fetch threw: ${String(e)}`);
    return { status: 0, html: "" };
  }
}

// ---------------------------------------------------------------- M1 --------

async function m1() {
  hr("M1 — the special rows, their live state, and blast radius");

  const rows = await sel(
    `SELECT p.id, p.state, p.district, p.chamber, p.party, p.primary_date,
            p.runoff_date, p.primary_type, p.race_id, p.election_round, p.updated_at,
            (SELECT COUNT(*) FROM primary_candidates pc WHERE pc.primary_id = p.id) AS cand_count,
            (SELECT COUNT(*) FROM primary_candidates pc
              WHERE pc.primary_id = p.id AND pc.vote_pct IS NOT NULL) AS shares
       FROM primaries p
      WHERE p.id IN (?, ?, ?, ?)
      ORDER BY p.id`,
    [SPECIAL_D, SPECIAL_R, JUNE_D, JUNE_R],
  );

  console.log("\n  Rows (the two special ids + the two June ids for contrast):");
  const seen = new Set<string>();
  for (const r of rows.rows) {
    seen.add(String(r.id));
    console.log(
      `    ${String(r.id).padEnd(26)} date=${String(r.primary_date)} runoff=${String(r.runoff_date)} ` +
        `round=${String(r.election_round)} race_id=${String(r.race_id)} type=${String(r.primary_type)}\n` +
        `      ${" ".repeat(24)} candidates=${String(r.cand_count)} with_shares=${String(r.shares)} updated_at=${String(r.updated_at)}`,
    );
  }
  for (const id of [SPECIAL_D, SPECIAL_R, JUNE_D, JUNE_R]) {
    if (!seen.has(id)) console.log(`    ${id.padEnd(26)} ABSENT`);
  }

  // Every other 2026 contest sharing race_id S-SC-2026 (so nothing is missed).
  const byRace = await sel(
    `SELECT id, party, primary_date, election_round FROM primaries
      WHERE race_id = 'S-SC-2026' ORDER BY primary_date, id`,
  );
  console.log("\n  All primaries rows carrying race_id='S-SC-2026':");
  for (const r of byRace.rows) {
    console.log(
      `    ${String(r.id).padEnd(26)} ${String(r.primary_date)} round=${String(r.election_round)} party=${String(r.party)}`,
    );
  }

  // --- surface 1: getPrimaryCalendar -> PrimaryTimeline (/electoral) --------
  const cal = await getPrimaryCalendar(2026);
  const aug = cal.filter((c) => c.date === "2026-08-11");
  console.log(
    `\n  SURFACE getPrimaryCalendar -> PrimaryTimeline (/electoral):` +
      `\n    ticks on 2026-08-11: ${aug.length}` +
      (aug.length
        ? `\n    -> ONE tick, contestCount=${aug[0]!.contestCount}, states=[${aug[0]!.states.join(",")}]` +
          `\n       (the timeline groups BY date, so two rows render as one bar of height ${aug[0]!.contestCount})`
        : `\n    -> no Aug 11 tick`),
  );
  const augRows = await sel(
    `SELECT id, state, party FROM primaries
      WHERE election_round = 'primary' AND primary_date = '2026-08-11' ORDER BY id`,
  );
  console.log(`    contests behind that tick (${augRows.rows.length}):`);
  for (const r of augRows.rows) {
    console.log(`      ${String(r.id)}  state=${String(r.state)} party=${String(r.party)}`);
  }

  // --- surface 2: getDashboardPrimaries (dashboard PRIMARIES tab) -----------
  // Runs unconditionally in CompetitiveRacesBlock (both `/` v2 and
  // /dashboard-classic), 6-month forward window — Aug 11 is inside it.
  const dash = await getDashboardPrimaries();
  const stripHit = dash.strip.filter((p) => p.date === "2026-08-11");
  const cardHit = dash.cards.filter((c) => c.date === "2026-08-11");
  console.log(
    `\n  SURFACE getDashboardPrimaries (dashboard PRIMARIES tab, ${dash.windowStart}..${dash.windowEnd}):` +
      `\n    strip points on Aug 11: ${stripHit.length}` +
      (stripHit.length
        ? ` (count=${stripHit[0]!.count}, soon=${stripHit[0]!.soon})`
        : "") +
      `\n    cards on Aug 11: ${cardHit.length}`,
  );
  for (const c of cardHit) {
    console.log(
      `      card states=[${c.states.join(",")}] count=${c.count} seats=${c.seats
        .map((s) => `${s.label}${s.rated ? "*" : ""}`)
        .join(" | ")} more=${c.moreSeats}`,
    );
  }

  // --- surface 3: /race/S-SC-2026 ------------------------------------------
  // The race hub reads getRunoffsForRace(race.id), which filters
  // election_round='runoff'. Measure rather than assert.
  const runoffRows = await sel(
    `SELECT id, party, primary_date FROM primaries
      WHERE race_id = 'S-SC-2026' AND election_round = 'runoff' ORDER BY party`,
  );
  console.log(
    `\n  SURFACE /race/S-SC-2026 (getRunoffsForRace, election_round='runoff'):` +
      `\n    rows returned: ${runoffRows.rows.length}` +
      `\n    -> the -special- rows are election_round='primary', so they do NOT render here`,
  );

  // --- surface 4: the member chip, via the SHIPPED function ----------------
  const sens = await sel(
    `SELECT bioguide_id, name, party, state, district, chamber
       FROM members WHERE state = 'SC' AND chamber = 'senate' AND is_current = 1
      ORDER BY name`,
  );
  console.log(`\n  SURFACE member chip — getPrimaryForRace run for each SC senator:`);
  for (const s of sens.rows) {
    const party = String(s.party ?? "");
    const p = await getPrimaryForRace(
      String(s.state),
      s.district == null ? null : Number(s.district),
      party,
      "senate",
    );
    console.log(
      `    ${String(s.name).padEnd(28)} [${party}-SC] ${String(s.bioguide_id)}\n` +
        `      -> resolved: ${p ? `${p.id}  date=${p.primary_date}  candidates=${p.candidates.length}` : "NULL (no chip)"}`,
    );
  }

  // Also run the D case explicitly: no SC Democrat holds a seat, so this is the
  // hypothetical the handoff asks about, stated as a measurement not a deduction.
  const hypoD = await getPrimaryForRace("SC", null, "D", "senate");
  console.log(
    `    [hypothetical] a D senator from SC would resolve: ` +
      `${hypoD ? `${hypoD.id} date=${hypoD.primary_date}` : "NULL"}`,
  );
  const houseD = await getPrimaryForRace("SC", 1, "D", "house");
  console.log(
    `    [control] an SC-01 House D resolves: ` +
      `${houseD ? `${houseD.id} date=${houseD.primary_date}` : "NULL"} (must never be a -special- row)`,
  );
}

// ---------------------------------------------------------------- M2 --------

async function m2() {
  hr(`M2 — /api/cron/primaries ticks since ${WINDOW_FROM}`);

  const runs = await sel(
    `SELECT id, started_at, ended_at, elapsed_ms, status, payload, error_message
       FROM cron_runs
      WHERE route = '/api/cron/primaries' AND started_at >= ?
      ORDER BY started_at ASC`,
    [WINDOW_FROM],
  );

  if (runs.rows.length === 0) {
    console.log(
      `\n  NO ROWS in the window. That is itself a finding and it is TWO different\n` +
        `  bugs — either the cron did not run, or it ran and the window query\n` +
        `  selected zero. Disambiguating below with the most recent ticks:`,
    );
    const recent = await sel(
      `SELECT id, started_at, status, elapsed_ms FROM cron_runs
        WHERE route = '/api/cron/primaries'
        ORDER BY started_at DESC LIMIT 8`,
    );
    for (const r of recent.rows) {
      console.log(
        `    id=${String(r.id).padStart(5)} ${String(r.started_at)} ${String(r.status)} ${String(r.elapsed_ms)}ms`,
      );
    }
    console.log(
      `    -> if the most recent started_at is inside the window, the cron RAN and\n` +
        `       the window query is at fault; if it predates the window, the cron did not fire.`,
    );
    return;
  }

  console.log(`\n  ${runs.rows.length} tick(s):`);
  for (const r of runs.rows) {
    let p: Record<string, unknown> = {};
    try {
      p = JSON.parse(String(r.payload ?? "{}")) as Record<string, unknown>;
    } catch {
      /* leave empty; printed raw below */
    }
    const inner = (p.payload ?? p) as Record<string, unknown>;
    const prio = inner.priorityScraped;
    const fails = inner.fetchFailures;
    const skipped = inner.settledSkipped;
    const refused = inner.rosterDeletesRefused;
    console.log(
      `\n    id=${String(r.id)} ${String(r.started_at)} -> ${String(r.ended_at)} ` +
        `${String(r.status)} ${String(r.elapsed_ms)}ms`,
    );
    console.log(`      cursorStart      = ${JSON.stringify(inner.cursorStart)}`);
    console.log(`      cursorEnd        = ${JSON.stringify(inner.cursorEnd ?? inner.cursor)}`);
    console.log(`      priorityScraped  = ${JSON.stringify(prio)}`);
    console.log(`      fetchFailures    = ${JSON.stringify(fails)}`);
    console.log(`      settledSkipped   = ${JSON.stringify(skipped)}`);
    console.log(`      rosterDeletesRefused = ${JSON.stringify(refused)}`);
    if (r.error_message) console.log(`      error_message    = ${String(r.error_message)}`);
    const keys = Object.keys(inner);
    console.log(`      (payload keys: ${keys.join(", ")})`);
  }

  // The C2 contract: the priority pass must NOT advance the cursor.
  const cursors = runs.rows.map((r) => {
    let p: Record<string, unknown> = {};
    try {
      p = JSON.parse(String(r.payload ?? "{}")) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    const inner = (p.payload ?? p) as Record<string, unknown>;
    return { at: String(r.started_at), start: inner.cursorStart };
  });
  console.log(`\n  cursorStart across ticks (C2: the priority pass never advances it):`);
  for (const c of cursors) console.log(`    ${c.at}  cursorStart=${JSON.stringify(c.start)}`);

  const cur = await sel(
    `SELECT key, value, updated_at FROM dashboard_state WHERE key = 'primaries_cron_cursor'`,
  );
  for (const r of cur.rows) {
    console.log(
      `\n  live cursor row: value=${String(r.value)} updated_at=${String(r.updated_at)}`,
    );
  }
}

// ---------------------------------------------------------------- M3 --------

type Probe = { label: string; url: string; status: number; html: string };

function anchorReport(html: string): string {
  return html.includes(ANCHOR) ? "anchor PRESENT" : "anchor ABSENT";
}

async function m3(): Promise<Probe[]> {
  hr("M3 — does any Ballotpedia page carry the August 11 field, and at what URL");

  const probes: Probe[] = [];

  // (a) what senateSpecialPageUrl builds today.
  const aUrl =
    "https://ballotpedia.org/United_States_Senate_special_election_in_South_Carolina,_2026";
  console.log(`\n  (a) the shape the code builds today (senateSpecialPageUrl):`);
  console.log(`      ${aUrl}`);
  const a = await get(aUrl);
  console.log(`      HTTP ${a.status}  ${a.status === 200 ? anchorReport(a.html) : ""}`);
  probes.push({ label: "(a) special-election page", url: aUrl, ...a });

  // (c) the regular race page — fetched BEFORE (b) because (b)'s candidate URLs
  //     are harvested from its own links (the HO 214 precedent: take the
  //     canonical link off the page, don't template-guess it).
  const cUrl =
    "https://ballotpedia.org/United_States_Senate_election_in_South_Carolina,_2026";
  console.log(`\n  (c) the regular race page:`);
  console.log(`      ${cUrl}`);
  const c = await get(cUrl);
  console.log(`      HTTP ${c.status}  ${c.status === 200 ? anchorReport(c.html) : ""}`);
  probes.push({ label: "(c) regular race page", url: cUrl, ...c });

  // (b) parenthetical per-primary pages. Discover from the regular page's own
  //     hrefs first; fall back to the templated shapes if the page links none.
  console.log(`\n  (b) parenthetical per-primary pages on the regular race page:`);
  const discovered = new Set<string>();
  if (c.html) {
    for (const m of c.html.matchAll(
      /href="(\/United_States_Senate_(?:special_)?election_in_South_Carolina,_2026_\([^")]+\))"/g,
    )) {
      discovered.add(`https://ballotpedia.org${m[1]!}`);
    }
  }
  console.log(
    discovered.size
      ? `      discovered ${discovered.size} parenthetical link(s) IN the page HTML:`
      : `      no parenthetical links found in the page HTML (falling back to templated shapes)`,
  );
  for (const u of discovered) console.log(`        ${decodeURIComponent(u)}`);

  const templated = [
    "https://ballotpedia.org/United_States_Senate_election_in_South_Carolina,_2026_(June_9_Republican_primary)",
    "https://ballotpedia.org/United_States_Senate_election_in_South_Carolina,_2026_(June_9_Democratic_primary)",
    "https://ballotpedia.org/United_States_Senate_election_in_South_Carolina,_2026_(August_11_Republican_primary)",
    "https://ballotpedia.org/United_States_Senate_election_in_South_Carolina,_2026_(August_11_special_Republican_primary)",
    "https://ballotpedia.org/United_States_Senate_special_election_in_South_Carolina,_2026_(August_11_Republican_primary)",
  ];
  const bUrls = [...new Set([...discovered, ...templated])];
  console.log(`\n      probing ${bUrls.length} candidate URL(s):`);
  for (const u of bUrls) {
    const r = await get(u);
    console.log(
      `        HTTP ${String(r.status).padStart(3)}  ${
        r.status === 200 ? anchorReport(r.html).padEnd(14) : "".padEnd(14)
      } ${decodeURIComponent(u.replace("https://ballotpedia.org/", ""))}`,
    );
    probes.push({ label: `(b) ${u}`, url: u, ...r });
    await new Promise((res) => setTimeout(res, 1200)); // politeness
  }

  // What parseCandidatesPage actually returns for each 200 that has the anchor.
  console.log(`\n  parseCandidatesPage() on every 200-with-anchor page:`);
  for (const p of probes) {
    if (p.status !== 200 || !p.html.includes(ANCHOR)) continue;
    const parsed = parseCandidatesPage(p.html, "SC", p.url);
    const byContest = new Map<string, number>();
    for (const cand of parsed.candidates) {
      byContest.set(cand.contest, (byContest.get(cand.contest) ?? 0) + 1);
    }
    console.log(
      `    ${p.label}\n      status=${parsed.status} candidates=${parsed.candidates.length} ` +
        `byContest={${[...byContest].map(([k, v]) => `${k}:${v}`).join(", ")}}`,
    );
    for (const cand of parsed.candidates.slice(0, 12)) {
      console.log(
        `        ${cand.contest.padEnd(4)} ${cand.name.padEnd(28)} party=${cand.party} ` +
          `inc=${cand.incumbent ? 1 : 0} win=${cand.isWinner ? 1 : 0} pct=${String(cand.votePct)}`,
      );
    }
  }

  // --- the substitution hazard (the sharpest check) -------------------------
  console.log(`\n  SUBSTITUTION HAZARD — does the regular page now carry an August votebox?`);
  if (c.status === 200 && c.html.includes(ANCHOR)) {
    const anchorIdx = c.html.indexOf(ANCHOR);
    const nextH2 = c.html.indexOf("<h2", anchorIdx + 10);
    const section = c.html.slice(
      anchorIdx,
      nextH2 === -1 ? anchorIdx + 80000 : nextH2,
    );
    const headers = [...section.matchAll(/<div class="race_header([^"]*)">/g)];
    console.log(`    voteboxes in the candidates section: ${headers.length}`);
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i]!;
      const start = h.index ?? 0;
      const end =
        i + 1 < headers.length ? (headers[i + 1]!.index ?? section.length) : section.length;
      const slice = section.slice(start, end);
      const h5 = (slice.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const cls = (h[1] ?? "").trim();
      const isAug = /august/i.test(h5);
      console.log(
        `      [${String(i).padStart(2)}] class="race_header${cls}"${isAug ? "  <<< AUGUST" : ""}\n` +
          `           h5: ${h5.slice(0, 130)}`,
      );
    }
    const augBoxes = headers.filter((h, i) => {
      const start = h.index ?? 0;
      const end =
        i + 1 < headers.length ? (headers[i + 1]!.index ?? section.length) : section.length;
      return /august/i.test(section.slice(start, end));
    });
    console.log(
      `    -> ${augBoxes.length} votebox(es) mention August. ` +
        (augBoxes.length === 0
          ? "The regular page does NOT carry the August field, so the standard pass cannot substitute it."
          : "The standard pass could see this — the freeze check below is load-bearing."),
    );
  } else {
    console.log(`    regular page unavailable (HTTP ${c.status}) — cannot assess.`);
  }

  // The June row's shares, in full: if the freeze failed we would see them
  // replaced by an August roster.
  const june = await sel(
    `SELECT pc.primary_id, pc.name, pc.party, pc.status, pc.vote_pct, pc.updated_at
       FROM primary_candidates pc
      WHERE pc.primary_id IN (?, ?)
      ORDER BY pc.primary_id, pc.vote_pct DESC NULLS LAST`,
    [JUNE_D, JUNE_R],
  );
  console.log(`\n  June rows' stored rosters (the freeze target), ${june.rows.length} candidate(s):`);
  for (const r of june.rows) {
    console.log(
      `    ${String(r.primary_id).padEnd(20)} ${String(r.name).padEnd(28)} ` +
        `party=${String(r.party)} status=${String(r.status)} pct=${String(r.vote_pct)} updated=${String(r.updated_at)}`,
    );
  }
  console.log(
    `    -> shares present + updated_at predating the window == the June row was not rewritten.`,
  );

  return probes;
}

// ---------------------------------------------------------------- M4 --------

async function m4(probes: Probe[]) {
  hr("M4 — votebox -> party mapping on whatever page carries the August field");

  const carriers = probes.filter(
    (p) => p.status === 200 && p.html.includes(ANCHOR) && /august\s*11/i.test(p.html),
  );
  if (carriers.length === 0) {
    console.log(
      `\n  No probed page carries an "August 11" string alongside the candidates anchor.\n` +
        `  M4 does not run — per the handoff it is conditional on M3 finding a page.\n` +
        `  If no page carries the field, the fix is a SOURCE change, not a parse fix.`,
    );
    return;
  }

  for (const p of carriers) {
    console.log(`\n  ${p.label}\n    ${decodeURIComponent(p.url)}`);
    const isSpecialTitle = /special election/i.test(
      p.html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "",
    );
    console.log(
      `    page <title> reads "special election": ${isSpecialTitle}  ` +
        `(this is isSpecialElectionPage() — it inverts parseCandidatesPage's special gate)`,
    );

    const anchorIdx = p.html.indexOf(ANCHOR);
    const nextH2 = p.html.indexOf("<h2", anchorIdx + 10);
    const section = p.html.slice(anchorIdx, nextH2 === -1 ? anchorIdx + 80000 : nextH2);
    const headers = [...section.matchAll(/<div class="race_header([^"]*)">/g)];

    for (let i = 0; i < headers.length; i++) {
      const h = headers[i]!;
      const cls = h[1] ?? "";
      const start = h.index ?? 0;
      const end =
        i + 1 < headers.length ? (headers[i + 1]!.index ?? section.length) : section.length;
      const slice = section.slice(start, end);
      const h5 = (slice.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!/august/i.test(slice)) continue;

      // Replay the exact contest-resolution ladder parseCandidatesPage uses.
      const contest = cls.includes("democratic")
        ? "D"
        : cls.includes("republican")
          ? "R"
          : cls.includes("nonpartisan")
            ? "open"
            : /nonpartisan/i.test(h5)
              ? "open"
              : null;
      const gateDrop =
        !/primary/i.test(h5) ||
        /runoff/i.test(h5) ||
        /special/i.test(h5) !== isSpecialTitle;
      console.log(
        `\n    AUGUST votebox [${i}]\n` +
          `      class      = "race_header${cls}"\n` +
          `      h5         = ${h5.slice(0, 130)}\n` +
          `      contest    = ${contest ?? "NULL (skipped — no recognized contest)"}\n` +
          `      special gate: h5-special=${/special/i.test(h5)} page-special=${isSpecialTitle} ` +
          `-> ${gateDrop ? "DROPPED" : "KEPT"}`,
      );
      const names = [
        ...slice.matchAll(
          /votebox-results-cell--text[^>]*>([\s\S]*?)<\/(?:td|div)>/g,
        ),
      ]
        .map((m) =>
          (m[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        )
        .filter(Boolean)
        .slice(0, 10);
      if (names.length) console.log(`      rows       = ${names.join(" | ")}`);
    }
  }
}

async function main() {
  console.log(`HO 600 STEP 0 — SC special-primary premise check (READ-ONLY)`);
  console.log(`today (UTC) = ${new Date().toISOString().slice(0, 10)}`);
  await m1();
  await m2();
  const probes = await m3();
  await m4(probes);
  console.log(`\n${"=".repeat(72)}\nDone. No writes were performed.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
