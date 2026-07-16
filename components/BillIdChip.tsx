import Link from "next/link";
import type { MouseEventHandler } from "react";
import { formatBillId } from "@/lib/format";
import { BILL_TYPE_LABELS } from "@/lib/enums";

// HO 466 — the shared amber tier-1 bill-id chip (chip-family). The canonical
// treatment lifted from HO 287's .v2f-id: bordered --accent-amber, 11px/600, 2px
// radius. Used on every NON-chamber id surface (dashboard feed, weekly band,
// hearings, sponsor card). The chamber-tinted BillIdRail/.bill-chip are a
// deliberate separate system (HO 125 — chamber-of-origin) and do NOT use this.
//
// `onClick` exists for the one caller (V2FeedList) whose chip sits inside a
// role=button expander row: it stops the click bubbling to the row toggle so the
// id navigates cleanly instead of also expanding + firing a wasted panel fetch.
export function BillIdChip({
  billType,
  billNumber,
  href,
  title,
  className,
  onClick,
}: {
  billType: string;
  billNumber: number;
  href: string;
  title?: string;
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <Link
      href={href}
      className={`bill-id-chip${className ? ` ${className}` : ""}`}
      title={title ?? BILL_TYPE_LABELS[billType]}
      onClick={onClick}
    >
      {formatBillId(billType, billNumber)}
    </Link>
  );
}
