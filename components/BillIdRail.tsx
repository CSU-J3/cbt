import { BILL_TYPE_LABELS } from "@/lib/enums";

// Vertical type-over-number block (HO 125). Replaces the prior horizontal
// "HR 1234" prefix as the BillRow's identity marker. Color comes from
// chamber-of-origin tokens (--rail-house cyan, --rail-senate purple)
// rather than party or stage palettes — chamber is structural, not
// partisan, and matching one of those palettes would mislead.
//
// `title` attribute moves from the prior bill-id span to the rail itself,
// carrying the HO 123 BILL_TYPE_LABELS full-name tooltip with no change to
// the lookup table.
const SENATE_TYPES = new Set(["s", "sres", "sjres", "sconres"]);

function chamberClass(billType: string): string {
  return SENATE_TYPES.has(billType) ? "bill-rail--senate" : "bill-rail--house";
}

export function BillIdRail({
  billType,
  billNumber,
}: {
  billType: string;
  billNumber: number;
}) {
  const label = BILL_TYPE_LABELS[billType];
  return (
    <span className={`bill-rail ${chamberClass(billType)}`} title={label}>
      <span className="rail-type">{billType.toUpperCase()}</span>
      <span className="rail-number">{billNumber}</span>
    </span>
  );
}
