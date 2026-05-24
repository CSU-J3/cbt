import Link from "next/link";
import { NAV_ITEMS } from "@/components/HeaderBar";
import { formatLastUpdated } from "@/lib/format";
import { getCorpusStats, getDashboardLead } from "@/lib/queries";

// HO 131: home-only header chrome replacing the dashboard variant of
// HeaderBar. Stacking order (top → bottom):
//   1. `Congress Terminal:\>` prompt on its own line (26px mono, white +
//      amber accent)
//   2. LEAD prose — line-clamp scales by viewport via .home-header-lead
//      media queries (3 lines ≥1920px, 2 lines 1199–1919, 1 line <1199);
//      slot collapses entirely when no lead has been generated yet
//   3. `· LAST SYNC HH:MM MT · N BILLS TRACKED ` meta line (11px dim)
//   4. Nav strip — same 12-item NAV_ITEMS list as HeaderBar, separated
//      from the meta by a soft border-top; wraps on narrow widths
//
// Sits *outside* the no-scroll grid below. The grid's height is computed
// off var(--home-header-height) so a viewport-fit body never depends on
// hardcoded pixel guesses for this block.
export async function HomeHeader() {
  const [corpus, lead] = await Promise.all([
    getCorpusStats(),
    getDashboardLead(),
  ]);

  return (
    <header className="home-header">
      <Link href="/" className="terminal-prompt" aria-label="Congress Terminal home">
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
    </header>
  );
}
