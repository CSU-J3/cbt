import Link from "next/link";
import { ColorKeyStrip } from "@/components/ColorKeyStrip";
import { NAV_ITEMS } from "@/components/HeaderBar";
import { MarketsTape } from "@/components/MarketsTape";
import { formatLastUpdated } from "@/lib/format";
import { getCorpusStats, getDashboardLead } from "@/lib/queries";

// Home-only header chrome (home-dashboard-cleanup). Two-row structure:
//   Row 1: title block (prompt + LEAD on baseline + META line) on the
//          left, boxed COLOR KEY legend (~240px) on the right.
//   Row 2: full-width nav strip — 14px text, 16px icons, active state
//          = amber-bright text + 2px amber bottom border.
// At < 1280px the top row flows to a column so the legend stacks below
// the title block.
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
            <Link
              href="/"
              className="terminal-prompt"
              aria-label="Congress Terminal home"
            >
              Congress Terminal<span className="prompt-accent">{":\\>"}</span>
            </Link>

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
          </div>

          <p className="home-header-meta">
            · LAST SYNC {formatLastUpdated(corpus.lastSync)} ·{" "}
            {corpus.total.toLocaleString()} BILLS TRACKED
          </p>
        </div>

        <ColorKeyStrip />
      </div>

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
