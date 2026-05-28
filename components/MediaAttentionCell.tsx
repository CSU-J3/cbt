"use client";

import Link from "next/link";

// HO 130: the press chip rendered as a sibling cell of the watch star, not
// inside the row's main Link wrapper (a nested anchor would be invalid HTML
// and break keyboard semantics). Just the number in --accent-amber when
// count > 0; blank cell otherwise. Tooltip carries the window context.
//
// Click target is /news?bill=<id>. HO 148 added stopPropagation so a click
// here doesn't bubble up to the BillRow div-role-button and toggle the
// accordion — the user explicitly clicked the press chip, they want news,
// not expand.
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
      onClick={(e) => e.stopPropagation()}
    >
      <span className="row-media-count tabular-nums">{count}</span>
    </Link>
  );
}
