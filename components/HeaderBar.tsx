import Link from "next/link";
import { formatLastUpdated } from "@/lib/format";
import { getFeedStats } from "@/lib/queries";

export async function HeaderBar() {
  const stats = await getFeedStats();
  return (
    <header
      className="border-b"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-strong)",
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
        <Link
          href="/"
          className="text-[11px] font-medium uppercase tracking-[0.5px]"
          style={{ color: "var(--accent-amber)" }}
        >
          CBT <span style={{ color: "var(--text-dim)" }}>//</span> 119th Congress
        </Link>
        <nav className="flex items-center gap-4 text-[10px] uppercase tracking-[0.5px]" style={{ color: "var(--text-dim)" }}>
          <Link
            href="/watchlist"
            className="transition hover:text-[var(--text-secondary)]"
          >
            ★ Watchlist
          </Link>
          <span>
            {stats.total.toLocaleString()} bills
            <span style={{ color: "var(--text-dim)" }}> · </span>
            updated {formatLastUpdated(stats.lastUpdated)}
          </span>
        </nav>
      </div>
    </header>
  );
}
