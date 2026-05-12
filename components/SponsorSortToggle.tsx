import Link from "next/link";

const SEGMENTS = [
  { value: "volume", label: "VOLUME" },
  { value: "passrate", label: "PASS RATE" },
] as const;

export function SponsorSortToggle({
  current,
  carry,
  basePath,
}: {
  current: string;
  carry: URLSearchParams;
  basePath: string;
}) {
  return (
    <div
      className="inline-flex items-center overflow-hidden rounded-sm border"
      style={{ borderColor: "var(--border-strong)" }}
      role="group"
      aria-label="Sort by"
    >
      {SEGMENTS.map(({ value, label }, i) => {
        const sp = new URLSearchParams(carry);
        sp.delete("page");
        sp.delete("expanded");
        if (value === "volume") sp.delete("sort");
        else sp.set("sort", value);
        const qs = sp.toString();
        const href = qs ? `${basePath}?${qs}` : basePath;
        const isActive = current === value;
        return (
          <Link
            key={value}
            href={href}
            scroll={false}
            className="px-2 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition"
            style={{
              backgroundColor: isActive
                ? "var(--bg-row-hover)"
                : "var(--bg-base)",
              color: isActive
                ? "var(--accent-amber-bright)"
                : "var(--text-muted)",
              borderLeft:
                i === 0 ? undefined : "0.5px solid var(--border-strong)",
            }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
