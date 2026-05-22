import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import {
  getClusterStats,
  getUnmatchedClusterCount,
  sanitizeIncludeCeremonial,
} from "@/lib/queries";

type SearchParams = {
  ceremonial?: string;
};

export default async function PatternsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const includeCeremonial = sanitizeIncludeCeremonial(params.ceremonial);

  const [stats, unmatched] = await Promise.all([
    getClusterStats(),
    getUnmatchedClusterCount(includeCeremonial),
  ]);

  const matched = stats.reduce((s, c) => s + c.count, 0);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />

      <main className="w-full flex-1 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Bill patterns
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {stats.length} patterns · {matched.toLocaleString()} bills matched ·{" "}
            {unmatched.toLocaleString()} unmatched
          </span>
        </div>

        <p
          className="mb-3 text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          Pattern-matched cluster identities for bills that share a structural pattern.
          Click a pattern to filter the feed to it.
        </p>

        <div
          className="border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div className="cluster-header-row">
            <span>Pattern</span>
            <span className="text-right">Count</span>
            <span>Example</span>
          </div>
          <ul>
            {stats.map((c) => {
              const href = `/feed?cluster=${encodeURIComponent(c.id)}`;
              return (
                <li key={c.id}>
                  <Link
                    href={href}
                    className="cluster-row"
                    title={c.description}
                  >
                    <span className="flex flex-col leading-tight">
                      <span
                        className="text-[14px] font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {c.name}
                      </span>
                      <span
                        className="text-[12px]"
                        style={{ color: "var(--text-dim)" }}
                      >
                        {c.id}
                      </span>
                    </span>
                    <span
                      className="text-right text-[14px] font-medium tabular-nums"
                      style={{
                        color:
                          c.count > 0
                            ? "var(--accent-amber-bright)"
                            : "var(--text-dim)",
                      }}
                    >
                      {c.count.toLocaleString()}
                    </span>
                    <span
                      className="truncate text-[13px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {c.exampleTitle ?? "—"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </div>
  );
}
