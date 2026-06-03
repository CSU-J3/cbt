import Link from "next/link";
import { CyclingTimestamp } from "@/components/CyclingTimestamp";
import { NAV_ITEMS } from "@/components/HeaderBar";
import { MarketsTape } from "@/components/MarketsTape";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { TerminalPrompt } from "@/components/TerminalPrompt";
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
            {/* HO 178: brand + the <700 title-cursor wrapped as one flex child
                so the cursor sits tight against `:\>` (no prompt-row gap). The
                cursor is shown only <700 (where the prose, and its own cursor,
                are removed) — globals.css .home-cursor-title. */}
            <span className="home-header-brand">
              <TerminalPrompt name="Congress Terminal" href="/" />
              <span aria-hidden className="home-cursor-caret home-cursor-title">
                _
              </span>
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

        {/* HO 178: LEAD prose to the RIGHT of the title — full-wrap, no clamp,
            grows the row taller as the window narrows. Removed entirely <700px
            (the cursor then rides the title via .home-cursor-title). The caret
            here is the prose-end cursor shown >=700. */}
        <p className="home-header-lead">
          {lead?.text ?? ""}
          <span aria-hidden className="home-cursor-caret">
            _
          </span>
        </p>
      </div>

      <MobileNavDrawer items={NAV_ITEMS} active="dashboard" />

      {/* HO 178: two counter-scrolling tapes — equities → , commodities/macro ←.
          HO 179.1: wrapped in .markets-tape-block so the top (equities) tape gets
          a higher stacking order than the bottom — its hover popover (trapped in
          the track's animated-transform stacking context) then paints above the
          bottom tape. Only the bottom tape shows the shared AS OF stamp. */}
      <div className="markets-tape-block">
        <MarketsTape group="equities" showMeta={false} />
        <MarketsTape group="commodities" reverse />
      </div>

      <nav className="home-header-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            title={item.tooltip}
            aria-label={item.tooltip}
            aria-current={item.key === "dashboard" ? "page" : undefined}
          >
            <span className="nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span className="nav-label">{item.label}</span>
          </Link>
        ))}
      </nav>
    </header>
  );
}
