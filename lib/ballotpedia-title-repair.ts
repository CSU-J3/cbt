// HO 751 — repairing members' Ballotpedia titles ONCE, from the ballot itself.
//
// The general-ballot reader ties a ballot row to a member by identity only: the
// row's person_key (the person link's page title) against titleKey of the
// member's stored title. 42 stored incumbents printed on their own ballot were
// untied at HO 750 because their title was stale (33, WA-09's included) or
// missing (9), and three moved incumbents (Casar, Moore, Kennedy) were untied
// in the districts they moved to. HO 750's rule still found the 42 by the
// underline and the surname, so nothing was published wrongly; what stayed was
// data, and this repairs it.
//
// THE KEY IS ALREADY ON THE PAGE. For each of the 42 the row the rule picked has
// a person_key, which is the member's CURRENT page title; for the three moved,
// the underlined, untied row in the district they moved to holds it. So the
// learned title is that key, decoded. A fetch is used only to CONFIRM it, by
// three signals (ruled by the architect at HO 751, after the dry run found
// Ballotpedia had turned 12 stale bare-name titles into disambiguation pages):
//   · `redirect`: one GET of the stale title's page at the reader's pacing and
//     user agent, one attempt, following the redirect; the landing page's
//     canonical key equals the learned key;
//   · `disambiguation`: that page is a Ballotpedia disambiguation page (its
//     wgCategories carry "Disambiguation pages") and it links the learned key,
//     Ballotpedia's own pointer, the same class of evidence as a redirect;
//   · `ballot` / `ballot-prefix`: the name check, for a missing title (the 9 and
//     the three moved) and as the FALLBACK for a stale title whose page
//     confirms neither way (it lands elsewhere, or has no page): the learned
//     title carries every surname token of members.last_name and a first-name
//     token, whole (`ballot`) or as a prefix of three or more letters either way
//     (`ballot-prefix`, NJ-04's "Chris" against "Christopher").
// An unreadable page (the wall) is not "confirms neither way": it stops the
// fetching and the rest stay "not attempted", the reader's first-UNREAD rule.
// A confirmed title is written to member_ids.ballotpedia_title_resolved (never
// ballotpedia_title, which the crosswalk owns and overwrites), and the reader's
// loadIdentity keys COALESCE(resolved, ballotpedia_title). No runtime heuristic
// is added: the reader keeps tying by identity only, and the harvest payload's
// incumbentRoutes["underline-surname"] stays the alarm for the next stale title.
//
// HO 773: TWO CLASSES THE BALLOT RULE CAN'T REACH. Both finds above start from an
// underlined row, and two members were left that no underline marks:
//   · `senate`: a sitting House member printed on their state's Senate ballot in
//     a row that's untied, not underlined (they aren't that seat's incumbent) and
//     not taken by the race's own rule. The row's name must pass the name check
//     for exactly ONE sitting House member of the state; two or more go on the
//     ambiguous list, and none is no case (most of a Senate ballot isn't a
//     member). AL-01's Barry Moore found it: S-AL prints him under
//     Barry_Moore_(Alabama_U.S._representative), which his stale stored title,
//     "Barry Moore (Alabama)", doesn't tie.
//   · `primary`: a sitting member who is the stored incumbent of a race of the
//     cycle, carries no bioguide on any primary row of the cycle, and isn't
//     already a case. Their own race's primary rows, both rounds (the race id
//     derived as lib/primary-identity-repair.ts derives it), that are keyed,
//     untied and pass the name check give the key: one distinct key is the case,
//     two or more go on the ambiguous list. GA-13's Everton Blair Jr. found it:
//     he has no member_ids row, and the page doesn't underline his row, so HO
//     764's match left it NULL.
// Both confirm as the others do (a stored title by its page, a missing one by
// the name check). A `senate` case is tied by re-reading its race; a `primary`
// case is on no ballot, and is tied by `repair:primary-identity -- --saved-only
// --write`.
import type { Client, InStatement, Row } from "@libsql/client";
import { findIncumbentOnBallot, surnameMatches, tokenCheck, type BallotPerson } from "./ballot-incumbent";
import { hrefKey, titleKey, type IO } from "./general-ballot";

const BP = "https://ballotpedia.org/";

export type TitleCase = {
  bioguide: string;
  member: string;
  firstName: string | null;
  lastName: string | null;
  stored: string | null; // member_ids.ballotpedia_title, trimmed, or null
  resolved: string | null; // member_ids.ballotpedia_title_resolved, if the column exists
  hasRow: boolean; // a member_ids row exists
  kind: "stale" | "missing" | "moved" | "senate" | "primary";
  race: string; // the race the member is printed in (`primary`: the race they're the stored incumbent of)
  key: string; // the printed row's person_key
  learned: string; // the key decoded to a title
};
// A row no one member can be learned from, by its kind: for `moved` and `senate`
// the printed row and the members whose names fit it (for `moved`, none or two or
// more; for `senate`, two or more); for `primary` the member and the distinct keys
// of their race's rows that fit them.
export type Ambiguous = { kind: "moved" | "senate" | "primary"; race: string; row: string; candidates: string[] };
export type Finding = { cases: TitleCase[]; ambiguous: Ambiguous[] };

// The learned title from a person_key: underscores to spaces. titleKey of it
// returns the key again (STEP 0 read 45 of 45).
export const learnedTitle = (key: string) => key.replace(/_/g, " ");

// Every stored 2026 incumbent printed on a ballot but untied by identity, with
// the row that holds their current key, and (HO 773) every sitting incumbent
// tied to no primary row whose own race's primaries hold their key. One read
// batch; SELECT only.
export async function findStaleTitles(db: Client, cycle = 2026): Promise<Finding> {
  const cols = (await db.execute(`SELECT name FROM pragma_table_info('member_ids')`)).rows.map((r) => String(r.name));
  const hasResolved = cols.includes("ballotpedia_title_resolved");
  const [racesRs, membersRs, midsRs, readsRs, gbRs, primRs] = await db.batch(
    [
      { sql: `SELECT id, state, incumbent_bioguide_id FROM races WHERE cycle = ?`, args: [cycle] },
      { sql: `SELECT bioguide_id, name, first_name, last_name, state, chamber, is_current FROM members`, args: [] },
      { sql: `SELECT bioguide_id, ballotpedia_title${hasResolved ? ", ballotpedia_title_resolved" : ""} FROM member_ids`, args: [] },
      { sql: `SELECT race_id FROM general_ballot_reads WHERE status = 'box'`, args: [] },
      {
        sql: `SELECT g.race_id, g.person_key, g.name, g.bioguide_id, g.incumbent_marked, g.on_ballot
                FROM general_ballot g JOIN general_ballot_reads rd ON rd.race_id = g.race_id AND rd.status = 'box'`,
        args: [],
      },
      {
        sql: `SELECT c.primary_id, c.name, c.person_key, c.bioguide_id, p.chamber, p.state, p.district
                FROM primary_candidates c JOIN primaries p ON p.id = c.primary_id
               WHERE substr(p.primary_date, 1, 4) = ?`,
        args: [String(cycle)],
      },
    ],
    "read",
  );
  const S = (v: unknown) => (v == null ? null : String(v).trim() || null);
  const members = new Map(membersRs!.rows.map((m) => [String(m.bioguide_id), m]));
  const mids = new Map(midsRs!.rows.map((m) => [String(m.bioguide_id), { stored: S(m.ballotpedia_title), resolved: hasResolved ? S(m.ballotpedia_title_resolved) : null }]));
  const box = new Set(readsRs!.rows.map((r) => String(r.race_id)));
  const byRace = new Map<string, BallotPerson[]>();
  for (const g of gbRs!.rows) {
    const p: BallotPerson = { person_key: String(g.person_key), name: String(g.name), bioguide_id: S(g.bioguide_id), incumbent_marked: Number(g.incumbent_marked), on_ballot: Number(g.on_ballot) };
    (byRace.get(String(g.race_id)) ?? byRace.set(String(g.race_id), []).get(String(g.race_id))!).push(p);
  }
  const caseOf = (b: string, kind: TitleCase["kind"], race: string, key: string): TitleCase => {
    const m = members.get(b);
    return {
      bioguide: b,
      member: String(m?.name ?? b),
      firstName: S(m?.first_name),
      lastName: S(m?.last_name),
      stored: mids.get(b)?.stored ?? null,
      resolved: mids.get(b)?.resolved ?? null,
      hasRow: mids.has(b),
      kind,
      race,
      key,
      learned: learnedTitle(key),
    };
  };
  const cases: TitleCase[] = [];
  const picked = new Set<string>();
  // The own-ballot cases: the rule finds the stored incumbent by underline and surname.
  for (const r of racesRs!.rows) {
    const id = String(r.id), inc = S(r.incumbent_bioguide_id);
    if (!inc || !box.has(id)) continue;
    const found = findIncumbentOnBallot(byRace.get(id) ?? [], { bioguideId: inc, lastName: S(members.get(inc)?.last_name) });
    if (found.row) picked.add(`${id}|${found.row.person_key}`);
    if (found.route !== "underline-surname") continue;
    cases.push(caseOf(inc, mids.get(inc)?.stored ? "stale" : "missing", id, found.row!.person_key));
  }
  // The moved cases: an underlined, untied, printed row no race's rule picked,
  // matched by surname to the ONE sitting House member of the state with no
  // STORED title (a member already resolved still matches, and reads "already
  // resolved" below rather than vanishing before the race is re-read).
  const noTitleHouse = [...members.values()].filter((m) => !mids.get(String(m.bioguide_id))?.stored && Number(m.is_current ?? 1) === 1 && String(m.chamber ?? "").toLowerCase().startsWith("house"));
  const stateOf = new Map(racesRs!.rows.map((r) => [String(r.id), String(r.state)]));
  const ambiguous: Ambiguous[] = [];
  for (const [id, rows] of byRace) {
    for (const p of rows) {
      if (p.on_ballot !== 1 || p.incumbent_marked !== 1 || p.bioguide_id !== null || picked.has(`${id}|${p.person_key}`)) continue;
      const cands = noTitleHouse.filter((m) => m.state === stateOf.get(id) && surnameMatches(p.name, S(m.last_name)));
      if (cands.length === 1) cases.push(caseOf(String(cands[0]!.bioguide_id), "moved", id, p.person_key));
      else ambiguous.push({ kind: "moved", race: id, row: p.name, candidates: cands.map((m) => String(m.name)) });
    }
  }
  const nameOf = (m: Row) => ({ firstName: S(m.first_name), lastName: S(m.last_name), member: String(m.name ?? "") });
  // HO 773, the senate cases: a printed, untied, un-underlined row on a Senate
  // ballot of the cycle that the race's rule didn't take, whose name passes the
  // name check for exactly one sitting House member of the state (title stored
  // or not, so a stale stored title like Moore's is reached).
  const sittingHouse = [...members.values()].filter((m) => Number(m.is_current ?? 1) === 1 && String(m.chamber ?? "").toLowerCase().startsWith("house"));
  for (const [id, rows] of byRace) {
    if (!id.startsWith("S-") || !stateOf.has(id)) continue;
    for (const p of rows) {
      if (p.on_ballot !== 1 || p.incumbent_marked === 1 || p.bioguide_id !== null || picked.has(`${id}|${p.person_key}`)) continue;
      const cands = sittingHouse.filter((m) => m.state === stateOf.get(id) && tokenCheck(p.name, nameOf(m)).ok);
      if (cands.length === 1) cases.push(caseOf(String(cands[0]!.bioguide_id), "senate", id, p.person_key));
      else if (cands.length > 1) ambiguous.push({ kind: "senate", race: id, row: p.name, candidates: cands.map((m) => String(m.name)) });
    }
  }
  // HO 773, the primary cases: a sitting member who is the stored incumbent of a
  // race of the cycle, carries no bioguide on any primary row of the cycle and
  // isn't already a case, from their own race's keyed, untied rows that pass the
  // name check. The race id is lib/primary-identity-repair.ts's derivation, at
  // the cycle.
  const raceOfPrimary = (chamber: string, state: string, district: string | null) =>
    chamber === "senate" ? `S-${state}-${cycle}` : `${state}-${district === "00" ? "AL" : district}-${cycle}`;
  const tiedInPrimaries = new Set<string>();
  const primByRace = new Map<string, { name: string; key: string | null; bioguide: string | null }[]>();
  for (const r of primRs!.rows) {
    const bioguide = S(r.bioguide_id);
    if (bioguide) tiedInPrimaries.add(bioguide);
    const race = raceOfPrimary(String(r.chamber), String(r.state), S(r.district));
    (primByRace.get(race) ?? primByRace.set(race, []).get(race)!).push({ name: String(r.name), key: S(r.person_key), bioguide });
  }
  const isCase = new Set(cases.map((c) => c.bioguide));
  for (const r of racesRs!.rows) {
    const id = String(r.id), inc = S(r.incumbent_bioguide_id);
    if (!inc || tiedInPrimaries.has(inc) || isCase.has(inc)) continue;
    const m = members.get(inc);
    if (!m || Number(m.is_current ?? 1) !== 1) continue;
    const fits = (primByRace.get(id) ?? []).filter((p) => p.key && !p.bioguide && tokenCheck(p.name, nameOf(m)).ok);
    const keys = [...new Set(fits.map((p) => p.key!))].sort();
    if (keys.length === 1) {
      cases.push(caseOf(inc, "primary", id, keys[0]!));
      isCase.add(inc);
    } else if (keys.length > 1) {
      ambiguous.push({ kind: "primary", race: id, row: String(m.name ?? inc), candidates: keys });
    }
  }
  const order: Record<TitleCase["kind"], number> = { stale: 0, missing: 0, moved: 1, senate: 2, primary: 3 };
  cases.sort((a, b) => order[a.kind] - order[b.kind] || a.race.localeCompare(b.race));
  return { cases, ambiguous };
}

// The page's own canonical link, keyed like a ballot row's href. MediaWiki
// serves a redirect's TARGET under the requested URL, so the canonical link is
// where the stale title lands.
export function canonicalKeyOf(html: string): string | null {
  const m = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i);
  const href = m?.[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
  return href ? hrefKey(href) : null;
}
export function redirectedFromOf(html: string): string | null {
  return html.match(/"wgRedirectedFrom":"([^"]*)"/)?.[1] ?? null;
}

// Ballotpedia's own category list: a disambiguation page carries "Disambiguation
// pages" in wgCategories (read on HO 751's recorded pages).
export function isDisambiguation(html: string): boolean {
  const cats = html.match(/"wgCategories":\[([^\]]*)\]/)?.[1] ?? "";
  return /"Disambiguation pages"/.test(cats);
}
// Every Ballotpedia page a page links, keyed like a ballot row's href.
export function linkedKeys(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\bhref=["']((?:https:\/\/ballotpedia\.org)?\/[^"'#?]+)["']/gi)) {
    const href = m[1]!.startsWith("/") ? `https://ballotpedia.org${m[1]}` : m[1]!;
    const k = hrefKey(href);
    if (k) out.add(k);
  }
  return out;
}

// The name check (tokenCheck) lives in lib/ballot-incumbent.ts since HO 759,
// unchanged, so lib/incumbent-qualifier.ts can use it without this module's
// import of lib/general-ballot.ts (and its next/cache revalidateTag); it is
// re-exported here for this module's callers.
export { tokenCheck };

export type Signal = "redirect" | "disambiguation" | "ballot" | "ballot-prefix";
export type Verdict = "confirmed" | "unconfirmed" | "already resolved" | "not attempted";
export type Confirmation = TitleCase & { signal: Signal | null; evidence: string; verdict: Verdict; reason: string | null };
export type Fetched = { url: string; status: number | null; canonicalKey: string | null; redirectedFrom: string | null; disambiguation: boolean; bytes: number; kind: string };

export const pageUrl = (title: string) => BP + encodeURIComponent(title.trim().replace(/ /g, "_")).replace(/%2F/g, "/");

// Confirm each case. `io` must already be paced (pacedIO at the reader's gap);
// every stale title is ONE attempt, and a page that is not a readable page
// (no canonical link and not a 404: the challenge, a timeout) stops further
// fetching, the reader's first-UNREAD rule, leaving the rest "not attempted".
const nameSignal = (c: TitleCase, why: string): Pick<Confirmation, "signal" | "evidence" | "verdict" | "reason"> => {
  const t = tokenCheck(c.learned, c);
  return {
    signal: t.ok ? (t.form === "prefix" ? "ballot-prefix" : "ballot") : null,
    evidence: `${why}${why ? " · " : ""}name check: ${t.detail}`,
    verdict: t.ok ? "confirmed" : "unconfirmed",
    reason: t.ok ? null : "the learned title does not carry the member's name",
  };
};
export async function confirmCases(cases: TitleCase[], io: IO, identity: Map<string, string | null>): Promise<{ confirmations: Confirmation[]; fetched: Fetched[] }> {
  const fetched: Fetched[] = [];
  const out: Confirmation[] = [];
  let walled = false;
  // A key two cases learn, or two members' titles already share (the map holds
  // null for it), names no one person: never confirmed (the HO 751 review).
  const learnedBy = new Map<string, number>();
  for (const c of cases) learnedBy.set(c.key, (learnedBy.get(c.key) ?? 0) + 1);
  for (const c of cases) {
    const held = identity.get(c.key);
    if (c.resolved && titleKey(c.resolved) === c.key && held === c.bioguide) {
      out.push({ ...c, signal: null, evidence: `resolved already: ${c.resolved}`, verdict: "already resolved", reason: null });
      continue;
    }
    if ((learnedBy.get(c.key) ?? 0) > 1) {
      out.push({ ...c, signal: null, evidence: `${c.key} is learned by ${learnedBy.get(c.key)} cases`, verdict: "unconfirmed", reason: "the learned key names more than one case" });
      continue;
    }
    if (identity.has(c.key) && held !== c.bioguide) {
      out.push({ ...c, signal: null, evidence: held ? `the learned key is held by ${held}` : "the learned key is shared by two members' titles", verdict: "unconfirmed", reason: held ? "the learned key already ties another member" : "the learned key is ambiguous in the identity map" });
      continue;
    }
    if (c.stored) {
      if (walled) {
        out.push({ ...c, signal: null, evidence: "", verdict: "not attempted", reason: "fetching stopped at an unreadable page" });
        continue;
      }
      const url = pageUrl(c.stored);
      const raw = await io.get(url);
      const body = raw.kind === "response" ? raw.body : "";
      const f: Fetched = raw.kind === "response"
        ? { url, status: raw.status, canonicalKey: canonicalKeyOf(body), redirectedFrom: redirectedFromOf(body), disambiguation: isDisambiguation(body), bytes: body.length, kind: "response" }
        : { url, status: null, canonicalKey: null, redirectedFrom: null, disambiguation: false, bytes: 0, kind: raw.kind };
      fetched.push(f);
      if (f.status === 404) {
        // No page: the stale title confirms neither way, so the name check decides.
        out.push({ ...c, ...nameSignal(c, `${c.stored} → 404, no page`) });
      } else if (f.status !== 200 || !f.canonicalKey) {
        walled = true;
        out.push({ ...c, signal: null, evidence: `${url} → ${f.status ?? f.kind}, no readable page`, verdict: "unconfirmed", reason: "no readable page (the wall?); fetching stops here" });
      } else if (f.canonicalKey === c.key) {
        out.push({ ...c, signal: "redirect", evidence: `${c.stored} → ${f.redirectedFrom ? "redirected to " : "lands on "}${f.canonicalKey}`, verdict: "confirmed", reason: null });
      } else if (f.disambiguation && linkedKeys(body).has(c.key)) {
        out.push({ ...c, signal: "disambiguation", evidence: `${c.stored} is the disambiguation page ${f.canonicalKey}, which links ${c.key}`, verdict: "confirmed", reason: null });
      } else {
        // Lands elsewhere, or a disambiguation page that does not list the learned key.
        out.push({ ...c, ...nameSignal(c, f.disambiguation ? `${c.stored} is the disambiguation page ${f.canonicalKey}, which does not link ${c.key}` : `${c.stored} lands on ${f.canonicalKey}, not ${c.key}`) });
      }
    } else {
      out.push({ ...c, ...nameSignal(c, "") });
    }
  }
  return { confirmations: out, fetched };
}

// The writes, for confirmed members only. A member with no member_ids row at
// all (CA-14's Wahab at HO 751) gets a minimal row the repair marks as its own;
// the crosswalk's upsert fills the rest later and never touches the resolved
// columns.
export function resolvedWriteStatements(confirmations: Confirmation[], at: string): InStatement[] {
  const out: InStatement[] = [];
  for (const c of confirmations) {
    if (c.verdict !== "confirmed" || !c.signal) continue;
    if (c.hasRow) {
      out.push({
        sql: `UPDATE member_ids SET ballotpedia_title_resolved = ?, ballotpedia_title_resolved_at = ?, ballotpedia_title_resolved_from = ?
               WHERE bioguide_id = ?`,
        args: [c.learned, at, c.signal, c.bioguide],
      });
    } else {
      out.push({
        // ON CONFLICT: idempotent, so getDb's retry after a timed-out request
        // (lib/db.ts boundedFetch) cannot fail on a row the first attempt wrote.
        sql: `INSERT INTO member_ids (bioguide_id, raw_json, fetched_at, ballotpedia_title_resolved, ballotpedia_title_resolved_at, ballotpedia_title_resolved_from)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(bioguide_id) DO UPDATE SET
                ballotpedia_title_resolved = excluded.ballotpedia_title_resolved,
                ballotpedia_title_resolved_at = excluded.ballotpedia_title_resolved_at,
                ballotpedia_title_resolved_from = excluded.ballotpedia_title_resolved_from`,
        args: [c.bioguide, JSON.stringify({ id: { bioguide: c.bioguide }, note: "row created by repair:ballotpedia-titles (HO 751): no crosswalk row" }), at, c.learned, at, c.signal],
      });
    }
  }
  return out;
}
