// HO 440 — the TOP CLIENTS / TOP FIRMS ranked mini-bars, shared by the /lobbying
// per-issue drill (IssueDrill) and the /bill/[id] LOBBYING section (BillLobbying).
// Party-neutral amber bars ranked by distinct filings. Server component.

export function LobbyingMiniBars({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; filings: number }[];
}) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => r.filings));
  return (
    <div className="px-[14px] py-3" style={{ borderTop: "0.5px solid var(--border-soft)" }}>
      <div
        className="mb-2 text-[11px] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li
            key={r.name}
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: "minmax(0, 1fr) 90px 40px" }}
          >
            <span
              className="truncate text-[12px]"
              style={{ color: "var(--text-secondary)" }}
              title={r.name}
            >
              {r.name}
            </span>
            <span
              className="block h-[8px] overflow-hidden rounded-[2px]"
              style={{ backgroundColor: "var(--bg-row-hover)" }}
              aria-hidden
            >
              <span
                className="block h-full rounded-[2px]"
                style={{
                  width: `${(r.filings / max) * 100}%`,
                  backgroundColor: "var(--accent-amber)",
                  opacity: 0.55,
                }}
              />
            </span>
            <span
              className="text-right text-[12px] tabular-nums"
              style={{ color: "var(--text-muted)" }}
            >
              {r.filings.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
