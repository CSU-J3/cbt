// HO 601 §2 — pre-flight for the votebox-as-router change. READ-ONLY.
//
// The change under test (§1): `onSpecialPage` stops gating whether a votebox is
// parsed. Instead the box's own <h5> classifies it — a box marked "Special …"
// routes to `senate-{ST}-2026-special-{party}`, everything else to the base id.
//
// Three readings:
//   P1 (GATE) FL/OH must not change behavior — they are the states the current
//             senateSpecialPageUrl shape serves correctly.
//   P2 (GATE) blast radius: every /special/i votebox on every 2026 senate
//             state's REGULAR page, with the id the router would send it to.
//             HALT if any would route to an id that is not seeded (the HO 561
//             contract: the sync writes only seeded special ids, never creates).
//   P3        the freeze's input — is senate-SC-2026-R settled by the HO 560
//             predicate, and its exact roster fingerprint (leg 2's before-image).
//
// MIRRORED LOGIC — this script re-implements the votebox scan and the contest/
// special classification from lib/primary-candidates-scrape.ts::parseCandidatesPage
// as of `36b7731`. It is a copy with no compiler edge to the original, so if that
// function's header regexes change, RECONCILE THIS before trusting a re-run
// (SKILL: a probe re-run against an un-reconciled copy is a replay, not a re-run).
//
// The state roster is read from the DB rather than copying SENATE_STATES_2026,
// so there is one less copy to drift; the count is asserted against 35.
//
//   npx tsx scripts/diagnostic/special-router-preflight-601.ts
import "dotenv/config";
import { getDb } from "../../lib/db";
import { senatePageUrl, senateSpecialPageUrl } from "../../lib/primary-candidates-scrape";
import { stateName } from "../../lib/states";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ANCHOR = 'id="Candidates_and_election_results"';
const POLITE_MS = 700;

const db = getDb();

async function sel(sql: string, args: unknown[] = []) {
  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new Error(`refused non-SELECT: ${sql.slice(0, 60)}`);
  }
  return db.execute({ sql, args: args as never[] });
}

function hr(t: string) {
  console.log(`\n${"=".repeat(74)}\n${t}\n${"=".repeat(74)}`);
}

// Ballotpedia answers a burst of requests with HTTP 202 (a bot challenge) before
// settling — the first few states in a sweep get it. A 202 is transient, so retry
// it like scrapeHouseCandidates retries a 200-without-anchor; a 404 is
// deterministic and returns immediately.
const GET_ATTEMPTS = 3;
const GET_BACKOFF_MS = 2500;

async function get(url: string): Promise<{ status: number; html: string }> {
  let last = { status: 0, html: "" };
  for (let i = 0; i < GET_ATTEMPTS; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, GET_BACKOFF_MS));
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        redirect: "follow",
      });
      const html = res.ok ? await res.text() : "";
      last = { status: res.status, html };
      if (res.status === 404) return last; // deterministic
      if (res.status === 200 && html.includes(ANCHOR)) return last;
    } catch {
      last = { status: 0, html: "" };
    }
  }
  return last;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function pageTitle(html: string): string {
  return (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
}

// Mirror of isSpecialElectionPage() — reads the <title>, NOT the URL.
function pageSpecial(html: string): boolean {
  return /special election/i.test(pageTitle(html));
}

type Box = {
  cls: string;
  h5: string;
  contest: "D" | "R" | "open" | null;
  isPrimary: boolean;
  isRunoff: boolean;
  isSpecial: boolean;
  rows: number;
};

// Mirror of parseCandidatesPage's section slice + header walk + contest ladder.
function scanBoxes(html: string): Box[] {
  const anchor = html.indexOf(ANCHOR);
  if (anchor === -1) return [];
  const nextH2 = html.indexOf("<h2", anchor + 10);
  const section = html.slice(anchor, nextH2 === -1 ? anchor + 80000 : nextH2);
  const headers = [...section.matchAll(/<div class="race_header([^"]*)">/g)];
  const out: Box[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]!;
    const cls = h[1] ?? "";
    const start = h.index ?? 0;
    const end =
      i + 1 < headers.length ? (headers[i + 1]!.index ?? section.length) : section.length;
    const slice = section.slice(start, end);
    const h5 = stripTags(slice.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? "");
    let contest: "D" | "R" | "open" | null = cls.includes("democratic")
      ? "D"
      : cls.includes("republican")
        ? "R"
        : cls.includes("nonpartisan")
          ? "open"
          : null;
    if (!contest && /nonpartisan/i.test(h5)) contest = "open";
    out.push({
      cls: cls.trim(),
      h5,
      contest,
      isPrimary: /primary/i.test(h5),
      isRunoff: /runoff/i.test(h5),
      isSpecial: /special/i.test(h5),
      rows: [...slice.matchAll(/<tr class="results_row/g)].length,
    });
  }
  return out;
}

// A box is only ever a candidate for writing if it is a non-runoff primary with
// a resolved contest. Shared by all three models below.
function writable(b: Box): boolean {
  return Boolean(b.contest) && b.isPrimary && !b.isRunoff;
}

// MODEL A — TODAY. The shipped page-type gate: a box is parsed only when its
// specialness AGREES with the page's, and whatever survives goes to the BASE id.
// `pageIsSpecial` is isSpecialElectionPage(), which reads the <title> — and the
// <title> is NOT the URL: Ballotpedia serves the FL/OH *special-election article*
// under the regular `United_States_Senate_election_in_{State},_2026` URL (HTTP
// 200, no redirect), so those pages self-report as special. That is exactly why
// FL/OH work today and SC does not.
function todayId(state: string, b: Box, pageIsSpecial: boolean): string | null {
  if (!writable(b)) return null;
  if (b.isSpecial !== pageIsSpecial) return null; // dropped by the gate
  return `senate-${state}-2026-${b.contest}`;
}

// MODEL B — the §1 router as written: the <h5> alone decides, so ANY special box
// goes to a `-special-` id regardless of whether that id is seeded.
function routerId(state: string, b: Box): string | null {
  if (!writable(b)) return null;
  return b.isSpecial
    ? `senate-${state}-2026-special-${b.contest}`
    : `senate-${state}-2026-${b.contest}`;
}

// MODEL C — the seeded router (the correction this pre-flight arrives at). The
// <h5> says the box is a SPECIAL CONTEST; it does not say whether that contest is
// ADDITIONAL to a regular one for the same seat, which is the fact that decides
// the destination. The seed registry already encodes exactly that, so: a special
// box goes to the `-special-` id IFF that id is seeded, else to the base id.
function seededRouterId(state: string, b: Box, seeded: Set<string>): string | null {
  if (!writable(b)) return null;
  if (!b.isSpecial) return `senate-${state}-2026-${b.contest}`;
  const sp = `senate-${state}-2026-special-${b.contest}`;
  return seeded.has(sp) ? sp : `senate-${state}-2026-${b.contest}`;
}

async function main() {
  console.log("HO 601 §2 — votebox-router pre-flight (READ-ONLY)");
  console.log(`today (UTC) = ${new Date().toISOString().slice(0, 10)}\n`);

  // Live seeded/base rows, so nothing here is a copied constant.
  const seededRs = await sel(
    `SELECT id, state, party, primary_date FROM primaries
      WHERE chamber = 'senate' AND election_round = 'primary'
        AND id LIKE '%-special-%' ORDER BY id`,
  );
  const seeded = new Set(seededRs.rows.map((r) => String(r.id)));
  console.log(`seeded -special- senate rows (${seeded.size}):`);
  for (const r of seededRs.rows) {
    console.log(`    ${String(r.id).padEnd(28)} ${String(r.primary_date)}`);
  }

  const baseRs = await sel(
    `SELECT DISTINCT state FROM primaries
      WHERE chamber = 'senate' AND election_round = 'primary'
        AND district IS NULL AND id NOT LIKE '%-special-%'
      ORDER BY state`,
  );
  const states = baseRs.rows.map((r) => String(r.state));
  console.log(
    `\n2026 senate states with base rows: ${states.length}` +
      `${states.length === 35 ? " (matches SENATE_STATES_2026)" : "  <<< NOT 35 — check the roster"}`,
  );

  const allBaseRs = await sel(
    `SELECT id FROM primaries WHERE chamber='senate' AND election_round='primary'`,
  );
  const allIds = new Set(allBaseRs.rows.map((r) => String(r.id)));

  // ------------------------------------------------------------------ P1 ---
  hr("P1 (GATE) — does the router change FL / OH?");
  for (const st of ["FL", "OH"]) {
    const slug = stateName(st).replace(/ /g, "_");
    const seededHere = [...seeded].filter((id) => id.startsWith(`senate-${st}-`));
    console.log(`\n  ${st}:`);
    console.log(
      `    seeded -special- rows: ${seededHere.length ? seededHere.join(", ") : "NONE"}`,
    );

    const reg = await get(senatePageUrl(slug));
    await new Promise((r) => setTimeout(r, POLITE_MS));
    const pageIsSpecial = pageSpecial(reg.html);
    console.log(`    regular page  HTTP ${reg.status}  ${senatePageUrl(slug)}`);
    console.log(
      `    <title>       ${pageTitle(reg.html)}\n` +
        `    isSpecialElectionPage() = ${pageIsSpecial}` +
        (pageIsSpecial
          ? "   <- the SPECIAL article is served at the REGULAR url (no redirect)"
          : ""),
    );
    const regBoxes = reg.status === 200 ? scanBoxes(reg.html) : [];
    for (const b of regBoxes) {
      console.log(
        `      [${b.isSpecial ? "SPECIAL" : "regular"}] contest=${String(b.contest).padEnd(4)} ` +
          `rows=${String(b.rows).padStart(2)} class="race_header${b.cls}"\n` +
          `         h5: ${b.h5.slice(0, 110)}`,
      );
    }
    const specialsOnReg = regBoxes.filter((b) => b.isSpecial);

    const sp = await get(senateSpecialPageUrl(slug));
    await new Promise((r) => setTimeout(r, POLITE_MS));
    console.log(`    special page  HTTP ${sp.status}  ${senateSpecialPageUrl(slug)}`);

    // The three models, on the page the sync actually reads. scrapeSenateCandidates
    // tries the REGULAR url first and falls back only on a non-ok response, so a
    // 200 regular page IS the input.
    const fmt = (f: (b: Box) => string | null) => {
      const w = regBoxes.map((b) => ({ b, id: f(b) })).filter((x) => x.id);
      return w.length ? w.map((x) => `${x.id}(${x.b.rows})`).join(", ") : "nothing";
    };
    console.log(`    TODAY  writes:          ${fmt((b) => todayId(st, b, pageIsSpecial))}`);
    console.log(`    §1 ROUTER would write:  ${fmt((b) => routerId(st, b))}`);
    console.log(`    SEEDED ROUTER writes:   ${fmt((b) => seededRouterId(st, b, seeded))}`);
    const same = fmt((b) => todayId(st, b, pageIsSpecial)) === fmt((b) => seededRouterId(st, b, seeded));
    console.log(
      `    /special/i boxes: ${specialsOnReg.length}` +
        `\n    -> §1 router changes this state: ${
          fmt((b) => todayId(st, b, pageIsSpecial)) !== fmt((b) => routerId(st, b))
        }` +
        `\n    -> seeded router changes this state: ${!same}${same ? "  (NO-OP — P1 satisfied)" : "  <<< P1 GATE"}`,
    );
  }

  // ------------------------------------------------------------------ P2 ---
  hr("P2 (GATE) — blast radius across all 2026 senate states");
  console.log(
    `  Fetching ${states.length} regular pages (${POLITE_MS}ms apart). Only boxes whose\n` +
      `  <h5> matches /special/i are listed; a state with none is a router no-op.\n`,
  );

  const findings: {
    state: string;
    h5: string;
    contest: string | null;
    rows: number;
    pageIsSpecial: boolean;
    today: string | null;
    router: string | null;
    seededRouter: string | null;
  }[] = [];
  const unreachable: string[] = [];
  const changedByRouter: string[] = [];
  const changedBySeeded: string[] = [];

  for (const st of states) {
    const slug = stateName(st).replace(/ /g, "_");
    const res = await get(senatePageUrl(slug));
    await new Promise((r) => setTimeout(r, POLITE_MS));
    if (res.status !== 200 || !res.html.includes(ANCHOR)) {
      unreachable.push(`${st} (HTTP ${res.status}${res.status === 200 ? ", no anchor" : ""})`);
      process.stdout.write(`  ${st}:x`);
      continue;
    }
    const pageIsSpecial = pageSpecial(res.html);
    const boxes = scanBoxes(res.html);

    // Whole-state comparison across the three models (this is what P1 asks for,
    // applied to every state rather than just FL/OH).
    const sig = (f: (b: Box) => string | null) =>
      boxes
        .map((b) => ({ b, id: f(b) }))
        .filter((x) => x.id)
        .map((x) => `${x.id}(${x.b.rows})`)
        .join(",");
    const sToday = sig((b) => todayId(st, b, pageIsSpecial));
    const sRouter = sig((b) => routerId(st, b));
    const sSeeded = sig((b) => seededRouterId(st, b, seeded));
    if (sToday !== sRouter) changedByRouter.push(st);
    if (sToday !== sSeeded) changedBySeeded.push(st);

    const specials = boxes.filter((b) => b.isSpecial);
    process.stdout.write(
      specials.length ? `  ${st}:${specials.length}${pageIsSpecial ? "S" : "!"}` : `  ${st}:-`,
    );
    for (const b of specials) {
      findings.push({
        state: st,
        h5: b.h5,
        contest: b.contest,
        rows: b.rows,
        pageIsSpecial,
        today: todayId(st, b, pageIsSpecial),
        router: routerId(st, b),
        seededRouter: seededRouterId(st, b, seeded),
      });
    }
  }
  console.log("\n");

  if (unreachable.length) {
    console.log(`  pages not readable (${unreachable.length}): ${unreachable.join(", ")}`);
  }
  console.log(`  /special/i voteboxes found on regular pages: ${findings.length}\n`);
  for (const f of findings) {
    console.log(
      `    ${f.state}  contest=${String(f.contest).padEnd(4)} rows=${String(f.rows).padStart(2)}  page-special=${f.pageIsSpecial}\n` +
        `        h5:     ${f.h5.slice(0, 100)}\n` +
        `        TODAY:  ${f.today ?? "(dropped)"}\n` +
        `        §1:     ${f.router ?? "(dropped)"}${
          f.router && !seeded.has(f.router) && f.router.includes("-special-")
            ? "   [NOT SEEDED <<<]"
            : ""
        }\n` +
        `        SEEDED: ${f.seededRouter ?? "(dropped)"}`,
    );
  }

  const routerViolations = findings.filter(
    (f) => f.router && f.router.includes("-special-") && !seeded.has(f.router),
  );
  const seededViolations = findings.filter(
    (f) => f.seededRouter && f.seededRouter.includes("-special-") && !seeded.has(f.seededRouter),
  );

  console.log(
    `\n  §1 ROUTER      — unseeded targets: ${routerViolations.length}` +
      ` | states whose writes change: ${changedByRouter.length ? changedByRouter.join(", ") : "none"}` +
      `\n                   verdict: ${routerViolations.length === 0 && changedByRouter.length === 0 ? "PASS" : "HALT"}`,
  );
  console.log(
    `  SEEDED ROUTER  — unseeded targets: ${seededViolations.length}` +
      ` | states whose writes change: ${changedBySeeded.length ? changedBySeeded.join(", ") : "none"}` +
      `\n                   verdict: ${seededViolations.length === 0 && changedBySeeded.length === 0 ? "PASS" : "HALT"}`,
  );
  console.log(
    `\n  NOTE: SC's August box is invisible to BOTH gates on the regular page today\n` +
      `  (page-special=false, box-special=true), which is the HO 600 defect. Under the\n` +
      `  seeded router it lands on the seeded senate-SC-2026-special-R. A "states whose\n` +
      `  writes change" list of exactly [SC] is the intended outcome.`,
  );

  // ------------------------------------------------------------------ P3 ---
  hr("P3 (report) — the freeze's input: senate-SC-2026-R");
  const today = new Date().toISOString().slice(0, 10);
  const settledRs = await sel(
    `SELECT 1 AS settled FROM primaries p
      WHERE p.id = 'senate-SC-2026-R' AND p.primary_date < ?
        AND EXISTS (SELECT 1 FROM primary_candidates pc
                     WHERE pc.primary_id = p.id AND pc.vote_pct IS NOT NULL)
      LIMIT 1`,
    [today],
  );
  console.log(
    `\n  isSettled('senate-SC-2026-R', '${today}') = ${settledRs.rows.length > 0}` +
      `  (HO 560 predicate: past-dated AND >=1 recorded share)`,
  );

  for (const id of ["senate-SC-2026-R", "senate-SC-2026-D", "senate-SC-2026-special-R"]) {
    const rs = await sel(
      `SELECT name, party, incumbent, bioguide_id, status, vote_pct, updated_at
         FROM primary_candidates WHERE primary_id = ?
        ORDER BY name`,
      [id],
    );
    const fp = rs.rows
      .map(
        (r) =>
          `${String(r.name)}|${String(r.party)}|${String(r.status)}|${String(r.vote_pct)}`,
      )
      .join(" ;; ");
    console.log(`\n  ${id} — ${rs.rows.length} row(s)`);
    for (const r of rs.rows) {
      console.log(
        `      ${String(r.name).padEnd(28)} party=${String(r.party)} status=${String(r.status)} ` +
          `pct=${String(r.vote_pct)} updated=${String(r.updated_at)}`,
      );
    }
    console.log(`      FINGERPRINT: ${fp || "(empty)"}`);
  }

  // Standing regression guard (HO 600 §4 C3).
  console.log(
    `\n  standing guard — senate-SC-2026-special-D present: ${allIds.has("senate-SC-2026-special-D")} (must be false)`,
  );

  hr("VERDICT");

  // COVERAGE FIRST. A state whose page did not load contributes nothing to
  // `changedBy*`, so an unreachable FL/OH would silently read as "unchanged" and
  // flip a HALT into a PASS — the skip-on-empty inversion (oddities: a guard that
  // skips on empty goes green for the wrong reason). Coverage is therefore a
  // precondition of any verdict here, not a footnote: if the gate's own inputs
  // are missing, the only honest reading is INCONCLUSIVE.
  const covered = states.length - unreachable.length;
  const flohCovered = !unreachable.some((u) => u.startsWith("FL") || u.startsWith("OH"));
  console.log(
    `  coverage: ${covered}/${states.length} regular pages read` +
      `${unreachable.length ? `  (missing: ${unreachable.join(", ")})` : ""}\n` +
      `  FL+OH readable this run: ${flohCovered}`,
  );
  if (!flohCovered || unreachable.length > 0) {
    console.log(
      `\n  VERDICT: INCONCLUSIVE — re-run. A page that failed to load cannot be\n` +
        `  distinguished from a page that would not change, so no PASS is available.\n`,
    );
    return;
  }

  const p1Router = changedByRouter.some((s) => s === "FL" || s === "OH") ? "HALT" : "PASS";
  const p1Seeded = changedBySeeded.some((s) => s === "FL" || s === "OH") ? "HALT" : "PASS";
  const p2Router = routerViolations.length === 0 ? "PASS" : "HALT";
  const p2Seeded = seededViolations.length === 0 ? "PASS" : "HALT";
  console.log(`\n  P1 (FL/OH unchanged)          — §1 router: ${p1Router} | seeded router: ${p1Seeded}`);
  console.log(`  P2 (no unseeded write target) — §1 router: ${p2Router} | seeded router: ${p2Seeded}`);
  console.log(`  P3: recorded above as leg 2's before-image.`);

  const routerOk = p1Router === "PASS" && p2Router === "PASS";
  const seededOk =
    p1Seeded === "PASS" &&
    p2Seeded === "PASS" &&
    changedBySeeded.every((s) => s === "SC"); // SC changing IS the goal
  console.log(
    `\n  => §1 as specified: ${
      routerOk ? "buildable" : `HALT — moves ${changedByRouter.filter((s) => s !== "SC").join("/")} off their base ids onto unseeded ids`
    }` +
      `\n  => seeded-router correction: ${
        seededOk
          ? `PASS both gates; states changed = [${changedBySeeded.join(", ")}]`
          : "HALT"
      }\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
