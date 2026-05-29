import { Tooltip } from "@/components/Tooltip";
import { BILL_TYPE_LABELS } from "@/lib/enums";

// Vertical type-over-number block (HO 125). Replaces the prior horizontal
// "HR 1234" prefix as the BillRow's identity marker. Color comes from
// chamber-of-origin tokens (--rail-house cyan, --rail-senate purple)
// rather than party or stage palettes — chamber is structural, not
// partisan, and matching one of those palettes would mislead.
//
// HO 154.6 split: when the caller does NOT pass a `tooltip` override,
// the rail is showing a bill-type acronym (HR, HJRES, SCONRES, …) —
// that's a coded surface and graduates to the HO 147 Tooltip term
// variant, hover panel surfacing BILL_TYPE_LABELS' full name. When the
// caller DOES pass `tooltip` (every BillRow does — it's the bill's
// title), it's a descriptive label and stays on the native title
// attribute per the cleanup rule. The Tooltip's dotted-underline is
// suppressed via .bill-rail .tooltip-term in globals.css because the
// underline doesn't read well on a vertical block; the hover panel
// still surfaces the bill-type name on focus or hover.
const SENATE_TYPES = new Set(["s", "sres", "sjres", "sconres"]);

function chamberClass(billType: string): string {
  return SENATE_TYPES.has(billType) ? "bill-rail--senate" : "bill-rail--house";
}

export function BillIdRail({
  billType,
  billNumber,
  tooltip,
}: {
  billType: string;
  billNumber: number;
  /** Override the default chamber-label tooltip with a bill-specific
   * descriptive string (e.g. the bill's full title on a feed row).
   * When set, native `title` is used and the HO 147 Tooltip primitive
   * is bypassed — bill titles are prose, not codes. */
  tooltip?: string;
}) {
  const inner = (
    <>
      <span className="rail-type">{billType.toUpperCase()}</span>
      <span className="rail-number">{billNumber}</span>
    </>
  );

  if (tooltip) {
    return (
      <span
        className={`bill-rail ${chamberClass(billType)}`}
        title={tooltip}
      >
        {inner}
      </span>
    );
  }

  const billTypeName = BILL_TYPE_LABELS[billType];
  if (!billTypeName) {
    return (
      <span className={`bill-rail ${chamberClass(billType)}`}>{inner}</span>
    );
  }
  return (
    <span className={`bill-rail ${chamberClass(billType)}`}>
      <Tooltip
        variant="term"
        ariaLabel={`${billType.toUpperCase()} — ${billTypeName}`}
        content={{
          kind: "text",
          label: billType.toUpperCase(),
          body: billTypeName,
        }}
      >
        {inner}
      </Tooltip>
    </span>
  );
}
