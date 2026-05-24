import Link from "next/link";
import { ColorKey } from "@/components/ColorKey";
import { NAV_ITEMS } from "@/components/HeaderBar";
import { StageFunnel } from "@/components/StageFunnel";
import { formatLastUpdated } from "@/lib/format";
import {
  type DashboardFilters,
  getCorpusStats,
  getDashboardLead,
} from "@/lib/queries";

// HO 131 + HO 133: home-only header chrome replacing the dashboard
// variant of HeaderBar. Three-column band at ≥1280px:
//   Col 1 — title block (capped 700px):
//     1. `Congress Terminal:\>` prompt (26px mono)
//     2. LEAD prose, viewport-tiered line-clamp (3/2/1)
//     3. `· LAST SYNC · N BILLS TRACKED` meta line (11px dim)
//     4. soft border + nav strip (NAV_ITEMS, HO 131 tooltips)
//   Col 2 — Stage Distribution (pulled out of the grid in HO 133)
//   Col 3 — Color Key (pulled out of the grid in HO 133; 5 sections
//     after Bill Types added)
//
// Below 1280px the band reflows to a 2-row stack (title row 1, stage
// + color row 2). Below 800px collapses to a single column.
//
// Sits *outside* the no-scroll grid below. The grid's height is
// computed off var(--home-header-height) so a viewport-fit body never
// depends on hardcoded pixel guesses for this block.
export async function HomeHeader({
  filters,
}: {
  filters?: DashboardFilters;
}) {
  const [corpus, lead] = await Promise.all([
    getCorpusStats(),
    getDashboardLead(),
  ]);

  return (
    <header className="home-header">
      <div className="home-header-title">
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

        <p className="home-header-meta">
          · LAST SYNC {formatLastUpdated(corpus.lastSync)} ·{" "}
          {corpus.total.toLocaleString()} BILLS TRACKED
        </p>

        <nav
          className="home-header-nav"
          aria-label="Primary navigation"
        >
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
      </div>

      <div className="home-header-stage">
        <p className="home-quadrant-label">Stage Distribution</p>
        <StageFunnel filters={filters} />
      </div>

      <div className="home-header-key">
        <p className="home-quadrant-label">Color Key</p>
        <ColorKey />
      </div>
    </header>
  );
}
