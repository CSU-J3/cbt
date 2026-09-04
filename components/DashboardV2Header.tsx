import { auth } from "@/auth";
import { AuthButton } from "@/components/AuthButton";
import { BreadcrumbMasthead } from "@/components/BreadcrumbMasthead";
import { CyclingTimestamp } from "@/components/CyclingTimestamp";
import { NAV_ITEMS, PrimaryNav } from "@/components/HeaderBar";
import { MarketsTape } from "@/components/MarketsTape";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import type { Stage } from "@/lib/enums";
import type { CorpusStats } from "@/lib/queries";

// HO 253 — Dashboard v2 header. A RESTACK of HomeHeader, not a new visual
// language: it reuses every existing header class (.home-header, the 20px brand,
// the .home-stat-readout number tokens, the 11px sync line, the shared
// PrimaryNav) so the type scale (brand 20 / readout + nav 14 / tape + sync 11)
// and styling come for free. Two things differ from `/`'s HomeHeader:
//   1. The corpus numbers are passed IN (summary-gated, fetched once in the v2
//      route) rather than fetched here, so the masthead total + its four stage
//      segments are the SAME gated read as the v2 body — one number page-wide.
//   2. The single combined tape becomes a TWO-tape stack (MARKETS over SIGNALS),
//      each a presentation split of the one getLatestMarketTicks() feed.
// `/` (app/page.tsx + HomeHeader) is untouched.

// The two-tape symbol split. Order here IS render order. HO 289 (B2) expanded
// MARKETS with tech + defense equities; HO 290 moved the econ readings (CPI/UNEMP,
// FRED-monthly → MO badge) here off the second strip, which is now ODDS (markets
// → indices · equities · 10Y · WTI · CPI · UNEMP). The strip is a scrolling marquee
// (scroll prop), so the longer roster crawls rather than clipping the static row.
const MARKETS_TAPE = [
  "SPX",
  "NDQ",
  "NVDA",
  "AAPL",
  "MSFT",
  "GOOGL",
  "LMT",
  "TNX",
  "WTI",
  "CPI",
  "UNEMP",
];
// HO 290: the second strip is ODDS — prediction markets ONLY (no econ). Each
// Kalshi "K" symbol is paired with its Polymarket "P" half so both ticks flow to
// the client and render as a dual-source item (`LABEL K x% P y%`); the POLY-*
// entries are render-skipped (drawn inside the primary). Order = SHUTDOWN, FED
// CUT, RECESSION. CPI/UNEMP moved to MARKETS above.
const ODDS_TAPE = [
  "SHUTDOWN",
  "POLY-SHUTDOWN",
  "FEDCUT",
  "POLY-FEDCUT",
  "RECESSION",
  "POLY-RECESSION",
];
const ODDS_PAIRS = [
  { primary: "SHUTDOWN", secondary: "POLY-SHUTDOWN", label: "SHUTDOWN" },
  // ONE Fed-cut horizon (HO 681). `showMonth` stays ON and is doing MORE work
  // now, not less: with a single row it is no longer disambiguating a pair, it
  // is naming which meeting the roller currently sits on — the label reads
  // "FED CUT SEP" today and rolls to "FED CUT OCT" after 2026-09-16 on its own.
  //
  // RECORD: a second row pinned to September sat beside this one from HO 302
  // until HO 681. The pin existed because soonest-open then resolved to July;
  // once July passed, the roller reached September and the two rows resolved
  // ONE event and printed the same string. `showMonth` was never broken — it
  // faithfully reported that both pairs had the same resolution month.
  { primary: "FEDCUT", secondary: "POLY-FEDCUT", label: "FED CUT", showMonth: true },
  { primary: "RECESSION", secondary: "POLY-RECESSION", label: "RECESSION" },
];

export async function DashboardV2Header({
  corpus,
  stageDist,
}: {
  corpus: CorpusStats;
  // Structurally just needs the bars' stage + count; StageDistribution[] (which
  // also carries percentage) is assignable here.
  stageDist: { bars: { stage: Stage; count: number }[] };
}) {
  // HO 355: identity for the AuthButton island (no SessionProvider). A1 gates
  // nothing — the dashboard renders identically logged-out. This is the LIVE `/`
  // header; HomeHeader backed only the classic dashboard, removed at HO 608, and
  // is now unreferenced (left in place — deleting it is not this slice's scope).
  const session = await auth();
  // HO 608 (C5 — no number appears twice on one screen): the masthead used to read
  // FIVE counts and the stage funnel ~240px below redrew the same five as bars. It
  // now reads TWO — the corpus total and enacted — and the three middle counts
  // (committee / floor / other chamber) belong to StageFunnel alone. `stageDist`
  // is still passed in whole (no query change); the header just renders less of it.
  const stageCount = (stage: Stage) =>
    stageDist.bars.find((b) => b.stage === stage)?.count ?? 0;
  const enacted = stageCount("enacted");

  return (
    <header className="home-header">
      <div className="home-header-top">
        <div className="home-header-title">
          <div className="home-header-prompt-row">
            <BreadcrumbMasthead segments={["Dashboard"]} cursor={false} />

            <p className="home-stat-readout">
              <span className="stat-num stat-total">
                {corpus.total.toLocaleString()}
              </span>{" "}
              tracked
              <span className="stat-sep"> · </span>
              <span className="stat-num stat-enacted">
                {enacted.toLocaleString()}
              </span>{" "}
              enacted
              <span
                className="home-cursor-caret home-readout-caret"
                aria-hidden
              >
                _
              </span>
            </p>

            {/* HO 608: LAST SYNC joins the masthead line (the mock's single `.mast`
                row: brand · counts · sync · SIGN IN) instead of taking a second
                line under the readout. The prompt row wraps, so narrow widths
                still stack it rather than overflowing. */}
            <p className="home-header-meta">
              ·{" "}
              <span className="show-desktop">LAST SYNC </span>
              <CyclingTimestamp iso={corpus.lastSync} />
            </p>

            {/* HO 355: the auth affordance. HO 610 (C1) moved it INTO the prompt
                row and deleted the `margin-left:auto` spacer that pinned it to the
                masthead's right edge — a deliberate deviation from the mock, whose
                own `.mast` uses a `.sp{flex:1}` spacer for exactly this. That
                spacer IS the C1 pattern (SIGN IN sat ~700px right of LAST SYNC at
                2560), and SKILL owns the conventions, so the mock loses this one.
                It follows the sync with a `·` like every other masthead item. */}
            <p className="home-header-meta">
              ·{" "}
              <AuthButton
                user={session?.user ? { name: session.user.name ?? null } : null}
              />
            </p>
          </div>
        </div>
      </div>

      <MobileNavDrawer items={NAV_ITEMS} active="dashboard" />

      {/* HO 690 — THE NAV MOVED ABOVE THE TAPES (ruled by Corey 2026-09-03, "3.
          yes", against docs/design/mock-690-chrome.html § 03). It had sat under
          them since the B2 stack landed, so the two market strips separated the
          masthead from the destinations, and the reader's route out of the page
          was the last thing in the header rather than the first. The tapes are
          ambient; the nav is chrome you act on.

          Nothing about the tapes changes — `.dv2-tapes` and both `MarketsTape`
          mounts are byte-identical below, and only this one JSX node moved. The
          separator comes for free: `.home-header-nav` already carries the
          `border-top` + `margin-top` that used to divide the nav from the tapes
          (globals.css), and it now divides it from the masthead instead.

          INNER PAGES ARE UNTOUCHED BY THE MOVE — they mount the same PrimaryNav
          through HeaderBar, which has no tapes at all (HO 323 removed them). */}
      <PrimaryNav active="dashboard" variant="home" />

      {/* Two stacked tapes — MARKETS (closes) over ODDS (prediction markets, always
          LIVE). HO 258: each its own marquee (scroll); HO 290 relabelled the second
          strip ODDS and made it prediction-markets-only (CPI/UNEMP moved up). */}
      <div className="dv2-tapes">
        <MarketsTape symbols={MARKETS_TAPE} kind="markets" scroll label="MARKETS" />
        <MarketsTape
          symbols={ODDS_TAPE}
          pairs={ODDS_PAIRS}
          kind="signals"
          scroll
          reverse
          label="ODDS"
        />
      </div>
    </header>
  );
}
