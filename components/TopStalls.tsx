import Link from "next/link";
import { BILL_TYPE_LABELS } from "@/lib/enums";
import { daysSince, formatBillId } from "@/lib/format";
import { getStaleBills } from "@/lib/queries";

// HO 126 — home-page quadrant answering "what's stuck?" Pairs with
// BREAKING (above) and ACTIVITY (next quadrant) to give a complete WTF
// snapshot. Drives off the same getStaleBills helper /stale uses, with
// limit=5; the rendered leader row should match /stale's top entry.
//
// Format is deliberately *not* the HO 125 compact BillRow — at a 2x2
// quadrant width (~720px at 1440px viewport, narrower at smaller
// breakpoints), the title + stage strip + sponsor strip stack of compact
// BillRow stops being scannable. This is a 3-column one-line row:
//
//   [HR-9011 chip]  truncated bill title…       505d
//
// The chip inherits HO 125's chamber tint (--rail-house cyan /
// --rail-senate purple) so chamber identity carries through the home page
// without introducing a new color vocabulary.

const SENATE_TYPES = new Set(["s", "sres", "sjres", "sconres"]);
const ROW_LIMIT = 5;

// Same threshold table as the /stale daysSinceMode column in BillRow —
// keep them in sync. <180d muted, 180-364d amber, ≥365d red.
function daysColor(days: number): string {
  if (days >= 365) return "var(--party-republican)";
  if (days >= 180) return "var(--accent-amber)";
  return "var(--text-secondary)";
}

function chipChamberClass(billType: string): string {
  return SENATE_TYPES.has(billType) ? "bill-chip--senate" : "bill-chip--house";
}

export async function TopStalls() {
  const bills = await getStaleBills({}, ROW_LIMIT);

  if (bills.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[13px]"
        style={{ color: "var(--text-dim)" }}
      >
        Nothing stuck — every tracked bill has moved recently.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <ul>
        {bills.map((b) => {
          const days = daysSince(b.latest_action_date);
          const label = formatBillId(b.bill_type, b.bill_number);
          return (
            <li key={b.id}>
              <Link href={`/bill/${b.id}`} className="top-stalls-row">
                <span
                  className={`bill-chip ${chipChamberClass(b.bill_type)}`}
                  title={BILL_TYPE_LABELS[b.bill_type]}
                >
                  {label}
                </span>
                <span
                  className="truncate text-[13px]"
                  style={{ color: "var(--text-secondary)" }}
                  title={b.title}
                >
                  {b.title}
                </span>
                <span
                  className="text-right text-[13px] tabular-nums"
                  style={{ color: daysColor(days) }}
                >
                  {days}d
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href="/stale" className="home-expander">
        [ View all stale → ]
      </Link>
    </div>
  );
}
