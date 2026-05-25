import Link from "next/link";
import { ColorKeyStrip } from "@/components/ColorKeyStrip";
import { NAV_ITEMS } from "@/components/HeaderBar";
import { formatLastUpdated } from "@/lib/format";
import { getCorpusStats, getDashboardLead } from "@/lib/queries";

// HO 131 / 133 / 134: home-only header chrome. Stack order:
//   1. prompt + LEAD on the same baseline row (prompt 26px mono,
//      lead 14px wrapping to its own column to the right; HO 134)
//   2. `· LAST SYNC · N BILLS TRACKED` meta line (11px dim)
//   3. full-width nav row (NAV_ITEMS)
//   4. persistent COLOR KEY stages strip (HO 134), home-only
//
// Sits outside the no-scroll grid below; --home-header-height drives
// the grid's height calc so the no-scroll body fits exactly.
export async function HomeHeader() {
  const [corpus, lead] = await Promise.all([
    getCorpusStats(),
    getDashboardLead(),
  ]);

  return (
    <header className="home-header">
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
            <p className="home-header-lead">{lead.text}</p>
          ) : null}
        </div>

        <p className="home-header-meta">
          · LAST SYNC {formatLastUpdated(corpus.lastSync)} ·{" "}
          {corpus.total.toLocaleString()} BILLS TRACKED
        </p>
      </div>

      <nav className="home-header-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            title={item.tooltip}
            aria-label={item.tooltip}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <ColorKeyStrip />
    </header>
  );
}
