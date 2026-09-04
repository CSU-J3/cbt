// HO 692 site 7 — the dual-rendered `leader` line, proven by construction.
//
// WHY THIS EXISTS RATHER THAN A CAPTURE. The `leader` shape fires only for a
// genuinely contested field, and after HO 691 gave every all-nominated seat the
// `general` shape there is no such seat on the dashboard: at HO 692 all six
// featured cards were general x1 / nominee x2 / nolead x1, and `.rc-dagger`
// counted ZERO across the page. So the odds-off fallback would have shipped
// UNEXERCISED — unproven rather than protected — and no screenshot of the live
// site could have said otherwise.
//
// WHAT IT ASSERTS, and the third one is the point:
//   1. a `leader` card renders the market line inside `odds-only`
//   2. the same card renders a fallback inside `odds-off-only`
//   3. that fallback is BYTE-IDENTICAL to the challenger line of a real `nolead`
//      card built from the SAME active set — compared against the other card's
//      own output, never against a string typed here, which is the only way the
//      claim "the fallback is what we'd have shown without a market" can be
//      checked rather than asserted.
//
// NO DB, NO NETWORK, NO WRITES.
//
//   npx tsx scripts/diagnostic/odds-leader-fallback-692.ts
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RaceCard } from "@/components/RaceCard";
import type { RaceCandidate, RaceIndexRow } from "@/lib/queries";
import { deriveMatchup } from "@/lib/race-matchup";

// tsx compiles the imported components' JSX with the CLASSIC runtime (tsconfig
// sets `jsx: "preserve"` for Next), so nothing puts React in scope inside them
// outside the Next build. Publishing it globally before the first render is the
// whole fix (HO 691 precedent).
(globalThis as { React?: typeof React }).React = React;

let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        actual   ${JSON.stringify(actual)}`);
  }
}

const cand = (name: string, party: string): RaceCandidate =>
  ({ name, party, status: "running", bioguide_id: null }) as unknown as RaceCandidate;

// Two active, same party, neither nominated — the post-691 shape of a genuinely
// contested field, which is the only thing `leader` still fires for.
const ACTIVE = [cand("Haley Stevens", "D"), cand("Abdul El-Sayed", "D")];

const baseRow = (odds: RaceIndexRow["kalshiOdds"]): RaceIndexRow =>
  ({
    raceId: "S-XX-2026",
    chamber: "senate",
    incumbentBioguideId: null,
    incumbentName: "Test Incumbent",
    incumbentParty: "D",
    incumbentRunning: 1,
    margin2024: null,
    incumbentCashOnHand: null,
    consensusRating: "Toss Up",
    ratings: {},
    kalshiOdds: odds,
    polymarketOdds: null,
  }) as unknown as RaceIndexRow;

// WITH a market naming one of them -> `leader`. WITHOUT one -> `nolead`.
const leaderRow = baseRow({
  favoriteLabel: "Abdul El-Sayed",
  favoriteIsParty: false,
  favoriteParty: "D",
  impliedPct: 64,
  closeTime: null,
} as unknown as RaceIndexRow["kalshiOdds"]);
const noleadRow = baseRow(null);

console.log("HO 692 — leader dual render (constructed; no such seat exists live)\n");

check(
  "constructed roster + market favourite -> leader",
  deriveMatchup(leaderRow, ACTIVE).challenger.kind,
  "leader",
);
check(
  "same roster, no market -> nolead",
  deriveMatchup(noleadRow, ACTIVE).challenger.kind,
  "nolead",
);

const leaderHtml = renderToStaticMarkup(
  createElement(RaceCard, { row: leaderRow, candidates: ACTIVE }),
);
const noleadHtml = renderToStaticMarkup(
  createElement(RaceCard, { row: noleadRow, candidates: ACTIVE }),
);

// The matchup block, then the challenger line inside it. NOT a split on
// `class="rc-line` — `class="rc-line-meta"` matches that prefix too, which is
// what the first cut of this helper tripped on: it silently extracted an
// incumbent meta span and every assertion below read false. The helper was
// wrong, not the markup.
const matchupBlock = (html: string): string => {
  const i = html.indexOf('class="rc-matchup"');
  if (i < 0) return "";
  const end = html.indexOf('class="sb-wrap"', i);
  return html.slice(i, end < 0 ? undefined : end);
};
const challengerLine = (html: string): string => {
  const block = matchupBlock(html);
  const m = [...block.matchAll(/<div class="rc-line[^"]*"/g)];
  const last = m[m.length - 1];
  return last?.index != null ? block.slice(last.index) : "";
};
const pick = (html: string, cls: string): string => {
  const i = html.indexOf(`class="${cls}"`);
  if (i < 0) return "";
  // Walk to the matching </span> by depth so a nested span cannot end it early.
  let depth = 0;
  let j = html.indexOf(">", i) + 1;
  const start = j;
  while (j < html.length) {
    if (html.startsWith("<span", j)) depth++;
    else if (html.startsWith("</span>", j)) {
      if (depth === 0) return html.slice(start, j);
      depth--;
    }
    j++;
  }
  return "";
};

const leaderChallenger = challengerLine(leaderHtml);
const onBranch = pick(leaderChallenger, "odds-only");
const offBranch = pick(leaderChallenger, "odds-off-only");
const realNolead = challengerLine(noleadHtml);

check("leader card has an odds-only branch", onBranch.length > 0, true);
check("leader card has an odds-off-only branch", offBranch.length > 0, true);
check("the market reading (dagger) is INSIDE odds-only", onBranch.includes("rc-dagger"), true);
check("the dagger is NOT in the odds-off branch", offBranch.includes("rc-dagger"), false);
check("'leads' is NOT in the odds-off branch", offBranch.includes("leads"), false);

// THE ASSERTION THAT MATTERS. The real nolead card's challenger line contains
// exactly the fallback markup, so the fallback is that card's own output rather
// than a lookalike.
check(
  "odds-off fallback is byte-identical to a real nolead card's challenger line",
  realNolead.includes(offBranch) && offBranch.length > 0,
  true,
);

console.log(`\n  fallback markup: ${offBranch}`);
console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILURE(S)`}`);
process.exit(fail === 0 ? 0 : 1);
