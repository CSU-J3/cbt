// Shared SVG chart primitive (HO 428). Positioned x-axis tick labels along the
// bottom — the block BillsTimeSeries + CommitteeActivityChart each duplicated for
// their month labels, generalized so the caller supplies pre-positioned
// {x, label} items (categorical bars compute bar-center x; a continuous scale
// computes year x). Render it inside an <svg>. Mono font, muted, centered — the
// project's x-tick convention.
export function SvgAxisX({
  items,
  y,
  fontSize = 11,
}: {
  items: { x: number; label: string }[];
  y: number;
  fontSize?: number;
}) {
  return (
    <>
      {items.map((it, i) => (
        <text
          key={`${it.label}-${i}`}
          x={it.x}
          y={y}
          textAnchor="middle"
          fontSize={fontSize}
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
        >
          {it.label}
        </text>
      ))}
    </>
  );
}
