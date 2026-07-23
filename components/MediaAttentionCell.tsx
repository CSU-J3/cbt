"use client";

import Link from "next/link";

// HO 130: the press chip rendered as a sibling cell of the watch star, not
// inside the row's main Link wrapper (a nested anchor would be invalid HTML
// and break keyboard semantics). HO 151 added the ⚡ glyph prefix so the
// chip reads as a marker, not a bare count. HO 501 pointed the click target at
// /news?bill=<id> — NEWS is its own route now (was /bills?mode=news, which
// still legacy-redirects to /news).
//
// HO 148 added stopPropagation so a click here doesn't bubble up to the
// BillRow div-role-button and toggle the accordion — the user explicitly
// clicked the press chip, they want news, not expand.
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
      <span aria-hidden className="row-media-glyph">
        ⚡
      </span>
      <span className="row-media-count tabular-nums">{count}</span>
    </Link>
  );
}
