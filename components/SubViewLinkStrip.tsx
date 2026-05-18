import Link from "next/link";

const LINKS = [
  { href: "/feed", label: "Feed" },
  { href: "/news", label: "News" },
  { href: "/changes", label: "Changes" },
  { href: "/stale", label: "Stale" },
  { href: "/president", label: "President" },
  { href: "/sponsors", label: "Sponsors" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/reports", label: "Reports" },
] as const;

export function SubViewLinkStrip() {
  return (
    <nav className="flex flex-col gap-2">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber)]"
          style={{ color: "var(--text-secondary)" }}
        >
          ▸ {l.label}
        </Link>
      ))}
    </nav>
  );
}
