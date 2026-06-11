import { BreadcrumbMasthead } from "@/components/BreadcrumbMasthead";
import { CyclingTimestamp } from "@/components/CyclingTimestamp";
import { DualMarketsTape } from "@/components/DualMarketsTape";
import { NAV_ITEMS, PrimaryNav } from "@/components/HeaderBar";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { getCorpusStats, getDashboardLead } from "@/lib/queries";

// Home-only header chrome. HO 178 reflow:
//   Masthead row: brand prompt (36px desktop hero) + the META line stacked on
//     the LEFT (fixed width); the weekly-summary LEAD prose sits
//     to the RIGHT, fills the remaining width, full-wrap (NO clamp), and the row
//     height follows the prose when it runs taller than the title block. The
//     blinking `_` cursor rides the end of the prose. Below 700px the prose is
//     removed and the cursor rides the end of the title (`Congress Terminal:\>_`).
//   Tapes: two counter-scrolling markets tapes (equities one way, commodities/
//     macro the other) between the masthead and the nav.
//   Nav: full-width strip — 14px text, 16px icons, active = amber-bright + 2px
//     amber bottom border.
export async function HomeHeader() {
  const [corpus, lead] = await Promise.all([
    getCorpusStats(),
    getDashboardLead(),
  ]);

  return (
    <header className="home-header">
      <div className="home-header-top">
        <div className="home-header-title">
          <div className="home-header-prompt-row">
            {/* HO 185 adopted the shared breadcrumb path masthead
                (`Congress Terminal:\119TH\Dashboard>_`), sized to the 36px hero
                via the .home-header-prompt-row scope. HO 230 (item 7): the
                blinking caret moved to the END of the lead-in prose (below) — the
                masthead's built-in caret is suppressed (`cursor={false}`), and a
                <700 fallback caret rides the path end here (the lead is hidden
                <700, so the caret falls back to the title). Exactly one caret at
                any width: `.home-cursor-title` is CSS-gated hidden ≥700 / shown
                <700, the prose caret rides its hidden-<700 parent. */}
            <BreadcrumbMasthead segments={["Dashboard"]} cursor={false} />
            <span className="home-cursor-caret home-cursor-title" aria-hidden>
              _
            </span>
          </div>

          {/* HO 157: subhead holds 11px at all bands; below 700px it
              abbreviates to `· HH:MM <ZONE> · N BILLS` by dropping the
              LAST SYNC / TRACKED affixes via .show-desktop (no size change).
              HO 183: the time token now cycles through US zones (ET→CT→MT→PT→
              UTC) via CyclingTimestamp — the third named motion exception;
              still cycles <700px (plain text, no cost). */}
          <p className="home-header-meta">
            ·{" "}
            <span className="show-desktop">LAST SYNC </span>
            <CyclingTimestamp iso={corpus.lastSync} /> ·{" "}
            {corpus.total.toLocaleString()} BILLS
            <span className="show-desktop"> TRACKED</span>
          </p>
        </div>

        {/* HO 178: LEAD prose to the RIGHT of the path — full-wrap, no clamp,
            grows the row taller as the window narrows. Removed entirely <700px
            (`.home-header-lead { display:none }`). HO 185: its trailing caret is
            gone — the single caret now lives at the breadcrumb path's `>_`. */}
        <p className="home-header-lead">
          {lead?.text ?? ""}
          <span className="home-cursor-caret" aria-hidden>
            _
          </span>
        </p>
      </div>

      <MobileNavDrawer items={NAV_ITEMS} active="dashboard" />

      {/* HO 178: two counter-scrolling tapes — equities → , commodities/macro ←.
          HO 185: extracted to the shared <DualMarketsTape> (same mount HeaderBar
          now uses on every page) — the .markets-tape-block stacking, the
          bottom-only AS OF stamp, and the HO 183 cycling zones all live there. */}
      <DualMarketsTape />

      <PrimaryNav active="dashboard" variant="home" />
    </header>
  );
}
