import Link from "next/link";
import { NAV_ITEMS } from "@/components/HeaderBar";
import { formatLastUpdated } from "@/lib/format";
import { getCorpusStats, getDashboardLead } from "@/lib/queries";

// HO 131: home-only header chrome replacing the dashboard variant of
// HeaderBar. Layout:
//   1. `Congress Terminal:\>` prompt (26px mono, white + amber accent)
//   2. ` · LAST SYNC HH:MM MT · N BILLS TRACKED ` meta line (11px dim)
//   3. LEAD prose (capped to 3 lines via line-clamp) — only when a lead
//      has been generated; otherwise the slot collapses to nothing.
//   4. Nav strip — same 12-item NAV_ITEMS list as HeaderBar, wraps on
//      narrow widths, separated from the prose by a soft border-top.
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
      <div className="home-header-top">
        <Link href="/" className="terminal-prompt" aria-label="Congress Terminal home">
          Congress Terminal<span className="prompt-accent">{":\\>"}</span>
        </Link>
        <span className="home-header-meta">
          · LAST SYNC {formatLastUpdated(corpus.lastSync)} ·{" "}
          {corpus.total.toLocaleString()} BILLS TRACKED
        </span>
      </div>

      {lead?.text ? (
        <p className="home-header-lead">{lead.text}</p>
      ) : null}

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
