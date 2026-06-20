// HO 287 — tier-3 QUALIFIER micro-tag (chip family). A tiny bordered uppercase
// label qualifying a value's cadence or kind — EOD (end-of-day), MO (monthly).
// --text-dim, 1px --border-strong border, 2px radius, 9px (the smallest rung of
// the size ladder). The shared home for the cadence tags that previously lived
// inline in the markets tape (.markets-tape-eod).
export function MicroTag({
  label,
  title,
}: {
  label: string;
  title?: string;
}) {
  return (
    <span className="micro-tag" title={title}>
      {label}
    </span>
  );
}
