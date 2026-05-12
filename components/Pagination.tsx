import Link from "next/link";

function buildHref(
  carry: URLSearchParams,
  page: number,
  basePath: string,
): string {
  const sp = new URLSearchParams(carry);
  sp.delete("expanded");
  if (page <= 1) sp.delete("page");
  else sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function pageList(current: number, total: number): (number | "…")[] {
  if (total <= 1) return [1];
  const window = 2;
  const start = Math.max(1, current - window);
  const end = Math.min(total, current + window);
  const pages: (number | "…")[] = [];

  if (start > 1) {
    pages.push(1);
    if (start === 3) pages.push(2);
    else if (start > 3) pages.push("…");
  }

  for (let i = start; i <= end; i++) pages.push(i);

  if (end < total) {
    if (end === total - 2) pages.push(total - 1);
    else if (end < total - 2) pages.push("…");
    pages.push(total);
  }

  return pages;
}

export function Pagination({
  currentPage,
  totalPages,
  carry,
  basePath = "/",
}: {
  currentPage: number;
  totalPages: number;
  carry: URLSearchParams;
  basePath?: string;
}) {
  if (totalPages <= 1) return null;

  const pages = pageList(currentPage, totalPages);
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;

  const navClass =
    "text-[12px] font-medium uppercase tracking-[0.5px] transition";
  const dimStyle = { color: "var(--text-dim)" };
  const mutedStyle = { color: "var(--text-muted)" };
  const currentStyle = { color: "var(--accent-amber-bright)" };

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t px-4 py-3"
      style={{ borderColor: "var(--border-strong)" }}
    >
      {prevDisabled ? (
        <span className={navClass} style={dimStyle}>
          ‹ PREV
        </span>
      ) : (
        <Link
          href={buildHref(carry, currentPage - 1, basePath)}
          scroll={false}
          className={`${navClass} hover:text-[var(--accent-amber)]`}
          style={mutedStyle}
        >
          ‹ PREV
        </Link>
      )}

      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`gap-${i}`}
              className="text-[12px]"
              style={dimStyle}
              aria-hidden
            >
              …
            </span>
          ) : p === currentPage ? (
            <span
              key={p}
              className="text-[12px] font-medium tabular-nums"
              style={currentStyle}
              aria-current="page"
            >
              {p}
            </span>
          ) : (
            <Link
              key={p}
              href={buildHref(carry, p, basePath)}
              scroll={false}
              className="text-[12px] tabular-nums transition hover:text-[var(--accent-amber)]"
              style={mutedStyle}
            >
              {p}
            </Link>
          ),
        )}
      </span>

      {nextDisabled ? (
        <span className={navClass} style={dimStyle}>
          NEXT ›
        </span>
      ) : (
        <Link
          href={buildHref(carry, currentPage + 1, basePath)}
          scroll={false}
          className={`${navClass} hover:text-[var(--accent-amber)]`}
          style={mutedStyle}
        >
          NEXT ›
        </Link>
      )}

      <span
        className="ml-2 text-[11px] uppercase tracking-[0.5px] tabular-nums"
        style={dimStyle}
      >
        Page {currentPage} of {totalPages}
      </span>
    </nav>
  );
}
