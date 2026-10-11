// HO 775 leg A: each rater's name links to that rater's own 2026 ratings page
// for the race's chamber, on /race/<id> (RatingChip, read from the server's
// HTML) and in /electoral's open row (RaceOpenRow's three rater tiles, opened in
// Playwright).
//
//   npx tsx scripts/diagnostic/rater-links-775.ts <base URL> [--races H,S,C]
//
// The races, by SELECT: the first 2026 House race and the first 2026 Senate race
// (by id) whose three raters' rows all cite ballotpedia.org, so each chip's
// title must end ", read from Ballotpedia"; and a control, the first 2026 race
// with all three raters whose rows cite both kinds of page, so the title rule's
// other branch is read too (/race only). --races pins the three, so a red and a
// green read the same races. /electoral's list carries every rated 2026 race
// (getRacesIndex), every tier on by default; a row opens from its chamber's tab.
//
// The expected pages are the handoff's six URLs, written out here rather than
// read from lib/enums.ts, so a wrong constant fails too. A build without the
// links fails every link check and holds every control (see `check`).
//
// SAFETY. It reads only our own pages, and the database by SELECT, and never
// follows a rater link: a request to a rater's host is aborted and counted, and
// the count must read 0. SHARE_URL in the environment (optional) is a Vercel
// share link, visited first because Previews sit behind Vercel Authentication;
// it is never printed (its landing path and the cookie names only).
import { config } from "dotenv";
import { chromium, type Page } from "@playwright/test";
import { getDb } from "@/lib/db";
import { RACE_RATING_SOURCES } from "@/lib/enums";

config({ path: ".env", quiet: true });

type Source = "cook" | "sabato" | "inside_elections";
type Chamber = "house" | "senate";
const SOURCES: Source[] = ["cook", "sabato", "inside_elections"];
const EXPECTED: Record<Source, Record<Chamber, string>> = {
  cook: {
    house: "https://www.cookpolitical.com/ratings/house-race-ratings",
    senate: "https://www.cookpolitical.com/ratings/senate-race-ratings",
  },
  sabato: {
    house: "https://centerforpolitics.org/crystalball/2026-house/",
    senate: "https://centerforpolitics.org/crystalball/2026-senate/",
  },
  inside_elections: {
    house: "https://insideelections.com/ratings/house/",
    senate: "https://insideelections.com/ratings/senate/",
  },
};
const CHIP_TEXT: Record<Source, string> = { cook: "Cook", sabato: "Sabato", inside_elections: "Inside Elections" };
const TILE_TEXT: Record<Source, string> = { cook: "Cook", sabato: "Sabato", inside_elections: "Inside" };
const RATER_HOSTS = ["cookpolitical.com", "centerforpolitics.org", "insideelections.com"];
const BP = ", read from Ballotpedia";

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const baseArg = process.argv[2];
if (!baseArg || baseArg.startsWith("--")) {
  console.error("usage: npx tsx scripts/diagnostic/rater-links-775.ts <base URL> [--races H,S,C]");
  process.exit(2);
}
const BASE = new URL(baseArg).origin;
const PINNED = argAt("--races")?.split(",").map((s) => s.trim()).filter(Boolean);

// Two kinds of check. A link check reads what this HO adds, so a build without
// it fails every one. A control reads what the HO leaves alone (the label is
// there, the row is listed, a non-Ballotpedia row's title), so it holds on both
// builds and says the link checks failed for the right reason.
const tally = { link: { pass: 0, fail: 0 }, control: { pass: 0, fail: 0 } };
const check = (kind: "link" | "control", where: string, label: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${kind === "control" ? "control " : ""}[${where}] ${label}: ${detail}`);
  tally[kind][ok ? "pass" : "fail"]++;
};
const isBallotpedia = (url: string | null) => {
  try {
    return !!url && new URL(url).hostname === "ballotpedia.org";
  } catch {
    return false;
  }
};

type Row = { source: Source; rating: string; ratingDate: string | null; sourceUrl: string | null };
type Race = { id: string; chamber: Chamber; rows: Row[]; role: "house" | "senate" | "control" };

async function pickRaces(): Promise<Race[]> {
  const db = getDb();
  const rated = `
    SELECT r.id, r.chamber,
           SUM(CASE WHEN rr.source_url LIKE 'https://ballotpedia.org/%' THEN 1 ELSE 0 END) AS bp,
           COUNT(*) AS n
    FROM races r JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = 2026
    WHERE r.cycle = 2026
    GROUP BY r.id
    HAVING COUNT(DISTINCT rr.source) = 3
    ORDER BY r.id`;
  const all = (await db.execute(rated)).rows.map((r) => ({ id: String(r.id), chamber: String(r.chamber) as Chamber, bp: Number(r.bp), n: Number(r.n) }));
  const picked = {
    house: all.find((r) => r.chamber === "house" && r.bp === r.n)?.id,
    senate: all.find((r) => r.chamber === "senate" && r.bp === r.n)?.id,
    control: all.find((r) => r.bp > 0 && r.bp < r.n)?.id,
  };
  console.log(`races by SELECT: house ${picked.house ?? "none"} · senate ${picked.senate ?? "none"} · control ${picked.control ?? "none"} (of ${all.length} 2026 races carrying all three raters)`);
  const ids = PINNED ?? [picked.house, picked.senate, picked.control];
  if (PINNED) console.log(`races pinned by --races: ${PINNED.join(", ")}${PINNED.join() === [picked.house, picked.senate, picked.control].join() ? " (the same)" : " (the SELECT now picks otherwise)"}`);
  const roles: Race["role"][] = ["house", "senate", "control"];
  const out: Race[] = [];
  for (const [i, id] of ids.entries()) {
    if (!id) throw new Error(`no ${roles[i]} race to read`);
    const meta = all.find((r) => r.id === id);
    if (!meta) throw new Error(`${id} is not a 2026 race carrying all three raters`);
    const rows = (await db.execute({ sql: "SELECT source, rating, rating_date, source_url FROM race_ratings WHERE race_id = ? AND cycle = 2026 ORDER BY source", args: [id] })).rows.map((r) => ({
      source: String(r.source) as Source,
      rating: String(r.rating),
      ratingDate: r.rating_date == null ? null : String(r.rating_date),
      sourceUrl: r.source_url == null ? null : String(r.source_url),
    }));
    out.push({ id, chamber: meta.chamber, rows, role: roles[i]! });
  }
  return out;
}

// The race header, parsed from the server's HTML by the browser's own parser
// (DOMParser loads nothing). Each rater's label is found by its full-name title,
// the one thing the span and the anchor share.
const READ_HEADER = (html: string) => `(() => {
  const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, "text/html");
  const header = doc.querySelector(".race-header");
  const names = ${JSON.stringify(RACE_RATING_SOURCES)};
  const chips = {};
  for (const [source, name] of Object.entries(names)) {
    const el = header ? Array.from(header.querySelectorAll("[title]")).find((e) => e.getAttribute("title") === name) : null;
    chips[source] = el
      ? { tag: el.tagName.toLowerCase(), href: el.getAttribute("href"), target: el.getAttribute("target"), rel: el.getAttribute("rel"), text: (el.textContent || "").trim(), chipTitle: el.parentElement ? el.parentElement.getAttribute("title") : null }
      : null;
  }
  return { header: !!header, anchors: header ? header.querySelectorAll("a[target=_blank]").length : 0, chips };
})()`;
type LabelRead = { tag: string; href: string | null; target: string | null; rel: string | null; text: string; chipTitle: string | null } | null;

async function racePage(page: Page, race: Race) {
  const where = `/race/${race.id}`;
  const res = await page.context().request.get(`${BASE}/race/${race.id}`);
  const html = await res.text();
  const read = (await page.evaluate(READ_HEADER(html))) as { header: boolean; anchors: number; chips: Record<Source, LabelRead> };
  console.log(`\n${where} (${race.role}, ${race.chamber}): HTTP ${res.status()} · ${html.length} bytes · header ${read.header ? "found" : "MISSING"} · ${read.anchors} new-tab anchors in it`);
  for (const source of SOURCES) {
    const row = race.rows.find((r) => r.source === source);
    const l = read.chips[source];
    const label = l ? `<${l.tag}> "${l.text}"` : "no label";
    console.log(`    ${source}: ${label} · row ${row?.rating ?? "—"} dated ${row?.ratingDate ?? "—"} · source_url ${row?.sourceUrl ?? "—"}`);
    const a = l?.tag === "a" ? l : null;
    const want = EXPECTED[source][race.chamber];
    check("control", where, `${source} label in the header`, !!l && l.text === CHIP_TEXT[source], l ? `<${l.tag}> "${l.text}"` : "none");
    check("link", where, `${source} is an anchor`, !!a, l ? `the label is <${l.tag}>` : "no label in the header");
    check("link", where, `${source} href`, a?.href === want, a ? `${a.href} (want ${want})` : "no anchor");
    check("link", where, `${source} target`, a?.target === "_blank", a ? String(a.target) : "no anchor");
    check("link", where, `${source} rel`, a?.rel === "noopener noreferrer", a ? String(a.rel) : "no anchor");
    check("link", where, `${source} text`, a?.text === CHIP_TEXT[source], a ? `"${a.text}"` : "no anchor");
    // The chip's title keeps "Updated <date>" and names Ballotpedia exactly when
    // the row's source_url is Ballotpedia's; a row citing the rater's own page
    // is the branch this HO doesn't change.
    const bp = isBallotpedia(row?.sourceUrl ?? null);
    const wantTitle = row?.ratingDate ? `Updated ${row.ratingDate}${bp ? BP : ""}` : null;
    check(bp ? "link" : "control", where, `${source} chip title ${bp ? "ends with Ballotpedia" : "names no Ballotpedia"}`, !!l && l.chipTitle === wantTitle, `${JSON.stringify(l?.chipTitle ?? null)} (want ${JSON.stringify(wantTitle)})`);
  }
}

const READ_TILES = (id: string) => `(() => {
  const li = document.getElementById(${JSON.stringify(`row-${id}`)});
  const x = li ? li.querySelector(".race-list-expand") : null;
  if (!x) return null;
  const tls = Array.from(x.querySelectorAll(".rl-seatctx .rl-tile .rl-tl"));
  const pick = (text) => {
    const tl = tls.find((t) => (t.textContent || "").trim() === text);
    if (!tl) return null;
    const a = tl.querySelector("a");
    return { anchor: !!a, href: a ? a.getAttribute("href") : null, target: a ? a.getAttribute("target") : null, rel: a ? a.getAttribute("rel") : null, text: a ? (a.textContent || "").trim() : null, title: a ? a.getAttribute("title") : null };
  };
  return { cook: pick("Cook"), sabato: pick("Sabato"), inside_elections: pick("Inside") };
})()`;
type TileRead = { anchor: boolean; href: string | null; target: string | null; rel: string | null; text: string | null; title: string | null } | null;

async function openRow(page: Page, race: Race) {
  const where = `/electoral #row-${race.id}`;
  await page.locator(".rl-tab", { hasText: race.chamber === "senate" ? "SENATE" : "HOUSE" }).click();
  const li = page.locator(`li[id="row-${race.id}"]`);
  const listed = (await li.count()) === 1;
  console.log(`\n${where} (${race.role}, ${race.chamber}): ${listed ? "in the list" : "NOT IN THE LIST"} on its tab, no search, every tier on`);
  check("control", where, "the default list shows the row", listed, `${await li.count()} li`);
  let tiles: Record<Source, TileRead> | null = null;
  if (listed) {
    if (!(await li.locator(".race-list-expand").count())) await li.locator(".race-list-seat").click();
    await li.locator(".race-list-expand").waitFor({ timeout: 10000 });
    tiles = (await page.evaluate(READ_TILES(race.id))) as Record<Source, TileRead> | null;
  }
  for (const source of SOURCES) {
    const t = tiles?.[source] ?? null;
    const want = EXPECTED[source][race.chamber];
    console.log(`    ${source}: ${t ? (t.anchor ? `<a> "${t.text}" → ${t.href}` : `tile "${TILE_TEXT[source]}", no anchor`) : "no tile"}`);
    const a = t?.anchor ? t : null;
    check("control", where, `${source} tile in the open row`, !!t, t ? `"${TILE_TEXT[source]}"` : "none");
    check("link", where, `${source} tile label is an anchor`, !!a, t ? (a ? "yes" : "the label is plain text") : "no tile");
    check("link", where, `${source} href`, a?.href === want, a ? `${a.href} (want ${want})` : "no anchor");
    check("link", where, `${source} target`, a?.target === "_blank", a ? String(a.target) : "no anchor");
    check("link", where, `${source} rel`, a?.rel === "noopener noreferrer", a ? String(a.rel) : "no anchor");
    check("link", where, `${source} text`, a?.text === TILE_TEXT[source], a ? `"${a.text}"` : "no anchor");
    check("link", where, `${source} title`, a?.title === RACE_RATING_SOURCES[source], a ? JSON.stringify(a.title) : "no anchor");
  }
}

async function main() {
  console.log(`=== HO 775 leg A: rater links · ${BASE} · ${new Date().toISOString()} ===`);
  const races = await pickRaces();
  for (const r of races) console.log(`  ${r.role}: ${r.id} (${r.chamber}) · ${r.rows.map((x) => `${x.source}=${x.rating} [${isBallotpedia(x.sourceUrl) ? "Ballotpedia" : x.sourceUrl}]`).join(" · ")}`);

  const browser = await chromium.launch();
  let raterRequests = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await context.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      if (RATER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
        raterRequests++;
        return route.abort();
      }
      return route.continue();
    });
    const share = process.env.SHARE_URL;
    if (share) {
      const p0 = await context.newPage();
      await p0.goto(share, { waitUntil: "load", timeout: 60000 });
      console.log(`share link visited; landed on ${new URL(p0.url()).pathname}`);
      await p0.close();
    }
    await context.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
    const ver = await context.request.get(`${BASE}/api/version`);
    const sha = ver.ok() ? (((await ver.json()) as { sha?: string }).sha ?? null) : null;
    console.log(`/api/version: HTTP ${ver.status()} · sha ${sha ?? "—"} · cookies ${(await context.cookies(BASE)).map((c) => c.name).sort().join(", ")}`);

    const parser = await context.newPage();
    await parser.goto("about:blank");
    for (const race of races) await racePage(parser, race);
    await parser.close();

    const page = await context.newPage();
    const res = await page.goto(`${BASE}/electoral`, { waitUntil: "load", timeout: 60000 });
    await page.locator(".rl-tabs").waitFor({ timeout: 20000 });
    console.log(`\n/electoral: HTTP ${res?.status() ?? "—"} · landed on ${new URL(page.url()).pathname}`);
    for (const race of races.filter((r) => r.role !== "control")) await openRow(page, race);
  } finally {
    await browser.close();
  }
  console.log(`\nrequests to a rater's host: ${raterRequests} (aborted; must read 0)`);
  const { link, control } = tally;
  console.log(`=== link checks: ${link.pass} pass, ${link.fail} fail · controls: ${control.pass} pass, ${control.fail} fail ===`);
  if (raterRequests > 0 || link.fail > 0 || control.fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
