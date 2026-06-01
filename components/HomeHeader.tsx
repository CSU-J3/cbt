import Link from "next/link";
import { LegendBadge } from "@/components/ColorKeyStrip";
import { NAV_ITEMS } from "@/components/HeaderBar";
import { MarketsTape } from "@/components/MarketsTape";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { TerminalPrompt } from "@/components/TerminalPrompt";
import { formatLastUpdated } from "@/lib/format";
import { getCorpusStats, getDashboardLead } from "@/lib/queries";

// Home-only header chrome. HO 162 made the masthead single-column full-width:
//   Row 1: brand prompt (36px desktop hero) + the `?` LegendBadge on one
//          line, then the LEAD prose below it, then the META line — all
//          full-width. The boxed COLOR KEY legend moved to a footer (the old
//          right-rail was what opened the wide-viewport void).
//   Row 2: full-width nav strip — 14px text, 16px icons, active state
//          = amber-bright text + 2px amber bottom border.
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
            <TerminalPrompt name="Congress Terminal" href="/" />
            <LegendBadge />
          </div>

          {/* HO 162: LEAD now stacks below the brand (was baseline-shared
              with the prompt) so it reads as terminal output under the 36px
              hero. Still hidden < 1024px via .home-header-lead. */}
          {lead?.text ? (
            <p className="home-header-lead">
              {lead.text}
              <span aria-hidden className="home-cursor-caret">
                _
              </span>
            </p>
          ) : (
            <p className="home-header-lead">
              <span aria-hidden className="home-cursor-caret">
                _
              </span>
            </p>
          )}

          {/* HO 157: subhead holds 11px at all bands; below 700px it
              abbreviates to `· HH:MM MT · N BILLS` by dropping the
              LAST SYNC / TRACKED affixes via .show-desktop (no size change). */}
          <p className="home-header-meta">
            ·{" "}
            <span className="show-desktop">LAST SYNC </span>
            {formatLastUpdated(corpus.lastSync)} ·{" "}
            {corpus.total.toLocaleString()} BILLS
            <span className="show-desktop"> TRACKED</span>
          </p>
        </div>
      </div>

      <MobileNavDrawer items={NAV_ITEMS} active="dashboard" />

      <MarketsTape />

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
