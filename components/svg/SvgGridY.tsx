// Shared SVG chart primitive (HO 101). Horizontal gridlines with right-aligned
// y-axis tick labels — the block every hand-rolled SVG chart in the project
// repeats. Render it inside an <svg>. `max` is the value at the top tick;
// `format` turns a tick's value into its label (counts, percentages, etc.).
export function SvgGridY({
  padLeft,
  padTop,
  innerWidth,
  innerHeight,
  max,
  format,
  labelGap = 6,
  ticks = [0, 0.25, 0.5, 0.75, 1],
}: {
  padLeft: number;
  padTop: number;
  innerWidth: number;
  innerHeight: number;
  max: number;
  format: (value: number) => string;
  labelGap?: number;
  ticks?: number[];
}) {
  return (
    <>
      {ticks.map((t) => {
        const y = padTop + innerHeight * (1 - t);
        return (
          <g key={t}>
            <line
              x1={padLeft}
              x2={padLeft + innerWidth}
              y1={y}
              y2={y}
              stroke="var(--border-soft)"
              strokeWidth={1}
            />
            <text
              x={padLeft - labelGap}
              y={y + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-dim)"
              fontFamily="var(--font-mono)"
            >
              {format(max * t)}
            </text>
          </g>
        );
      })}
    </>
  );
}
