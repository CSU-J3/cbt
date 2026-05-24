import Link from "next/link";

// HO 130: the press chip rendered as a sibling cell of the watch star, not
// inside the row's main Link wrapper (a nested anchor would be invalid HTML
// and break keyboard semantics). Just the number in --accent-amber when
// count > 0; blank cell otherwise. Tooltip carries the window context.
//
// Click target is /news?bill=<id>. /bill/[id] doesn't have a news section
// today (HO 130 Phase 1); a future anchor-jump could replace this without
// touching callers.
export function MediaAttentionCell({
  billId,
  count,
}: {
  billId: string;
  count: number;
}) {
  if (count <= 0) {
    return <span className="row-media" aria-hidden />;
  }
  const label = `${count} news mention${count === 1 ? "" : "s"}, last 7 days`;
  return (
    <Link
      href={`/news?bill=${encodeURIComponent(billId)}`}
      className="row-media"
      title={label}
      aria-label={label}
    >
      <span className="row-media-count tabular-nums">{count}</span>
    </Link>
  );
}
