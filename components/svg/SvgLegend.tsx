// Shared chart primitive (HO 101). The swatch legend that sits below a
// hand-rolled SVG chart — plain HTML, rendered as a sibling of the <svg>,
// not inside it. `shape` is "square" for category fills (stacked bars) or
// "dot" for point series (scatter); `trailing` is an optional muted caption.
export function SvgLegend({
  items,
  shape = "square",
  trailing,
}: {
  items: { label: string; color: string }[];
  shape?: "square" | "dot";
  trailing?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.5px]">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className={`inline-block h-2 w-2${shape === "dot" ? " rounded-full" : ""}`}
            style={{ backgroundColor: it.color }}
          />
          <span style={{ color: it.color }}>{it.label}</span>
        </span>
      ))}
      {trailing ? (
        <span className="ml-2" style={{ color: "var(--text-muted)" }}>
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
