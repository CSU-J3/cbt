"use client";

// HO 164 — TOP STALLS rows become click-to-expand accordions opening the full
// BillExpandedPanel, single-open within the tab. Path B: the collapsed row
// keeps its bespoke [chip] [title] [Xd] layout rather than converting to a
// compact BillRow — the Xd staleness number is the reason TOP STALLS exists.
// Reuses the feed's contract exactly: useSingleOpenPanel for single-open +
// per-bill cache, and BillExpandedPanel's own /api/bill/[id]/panel fetch. The
// panel is a block sibling of the row inside the <li> (the grid lives on the
// row div), so it spans full width without grid-column gymnastics.
//
// HO 249 — generalized so the NEW THIS WEEK tab reuses this exact row (no
// bespoke fork). `daysFrom` picks the right-aligned Xd metric's source:
// "action" = days since latest_action_date with the staleness color thresholds
// (TOP STALLS, the default); "intro" = days since introduced_date in a neutral
// color (NEW THIS WEEK — newness isn't an alarm, so no threshold ramp).
import { BillExpandedPanel } from "@/components/BillExpandedPanel";
import { useSingleOpenPanel } from "@/components/useSingleOpenPanel";
import { BILL_TYPE_LABELS } from "@/lib/enums";
import { daysSince, formatBillId } from "@/lib/format";
import type { FeedBill } from "@/lib/queries";

const SENATE_TYPES = new Set(["s", "sres", "sjres", "sconres"]);

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

export function TopStallsList({
  bills,
  daysFrom = "action",
}: {
  bills: FeedBill[];
  daysFrom?: "action" | "intro";
}) {
  const { expandedId, toggle, panelCache, handleLoaded } = useSingleOpenPanel();

  return (
    <ul>
      {bills.map((b) => {
        const days = daysSince(
          daysFrom === "intro" ? b.introduced_date : b.latest_action_date,
        );
        const dayColor =
          daysFrom === "intro" ? "var(--text-secondary)" : daysColor(days);
        const label = formatBillId(b.bill_type, b.bill_number);
        const isOpen = expandedId === b.id;
        return (
          <li key={b.id}>
            <div
              className={`top-stalls-row top-stalls-row--expandable${
                isOpen ? " is-open" : ""
              }`}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggle(b.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(b.id);
                }
              }}
            >
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
                style={{ color: dayColor }}
              >
                {days}d
              </span>
              <span
                className={`row-chevron${isOpen ? " is-open" : ""}`}
                aria-hidden
              >
                ▸
              </span>
            </div>

            {isOpen ? (
              <BillExpandedPanel
                bill={b}
                cached={panelCache.get(b.id) ?? null}
                onLoaded={(data) => handleLoaded(b.id, data)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
