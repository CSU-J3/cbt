// HO 675 — the pure transforms between the HO 674 roster tables and what the
// expand panel draws. Sibling of `lib/bill-rosters-sync.ts`, which fills those
// tables; this file never touches the database.
//
// It lives outside both the query layer and the component for one reason: the
// panel route runs these before serializing, so the payload is bounded by what
// is DRAWN rather than by what the tables HOLD. `119-hr-842` has 338
// cosponsors and the panel draws six faces; shipping 338 member objects to a
// client that renders six is the shape this module exists to prevent.
//
// The two halves are deliberately asymmetric about WHERE the bound is applied,
// and the reason is stated here rather than discovered later:
//   - COSPONSORS are cut here, in the route. The budget is a fixed 6 and the
//     server knows everything the split needs.
//   - RELATED bills are only SHAPED here (promoted / deduped / ordered) and cut
//     in the component, because the last filter is against the ONE meeting the
//     HEARING block chose, and which meeting that is depends on `showMomentum`
//     — a prop the route cannot see.
import { stateName } from "@/lib/states";

// ---- shared bill-id parsing -------------------------------------------------

const SENATE_TYPES = new Set(["s", "sjres", "sconres", "sres"]);
const BILL_TYPES = new Set([
  "hr",
  "hjres",
  "hconres",
  "hres",
  "s",
  "sjres",
  "sconres",
  "sres",
]);

export type Chamber = "house" | "senate";

// Chamber from a bill id ("119-hr-842" -> house). NULL when the id does not
// split into three segments with a known type — an id that does not parse is
// never promoted (see `shapeRelatedBills`), it stays in the list below.
//
// Measured HO 675 STEP 0: 0 of 3,478 identical rows fail to parse on either
// side, so this is a guard rather than a live path. It is written anyway
// because `bill_related_bills.related_bill_id` carries whatever Congress.gov
// returned and has NO foreign key (HO 447 loose-link rule) — nothing upstream
// of it guarantees the shape.
export function chamberOfBillId(billId: string): Chamber | null {
  const parts = billId.split("-");
  if (parts.length !== 3) return null;
  const type = parts[1];
  if (!type || !BILL_TYPES.has(type)) return null;
  return SENATE_TYPES.has(type) ? "senate" : "house";
}

// "119-s-4885" -> "S 4885". Derived from the ID rather than from the joined
// `bills` row on purpose: 16 of the 82 unresolved related ids sit on rows this
// HO PROMOTES (HO 675 STEP 0), so the label has to survive the target being
// absent from `bills`. Falls back to the raw id when it does not parse.
export function labelFromBillId(billId: string): string {
  const parts = billId.split("-");
  const type = parts[1];
  const num = parts[2];
  if (parts.length !== 3 || !type || !num) return billId;
  return `${type.toUpperCase()} ${num}`;
}

// ---- cosponsor faces --------------------------------------------------------

export const FACE_BUDGET = 6;
// D / R / everything-else, matching the mock's PORDER. `members.party` carries
// exactly these three values across the cosponsor population (HO 675 STEP 0:
// D 9,833 groups · R 9,126 · I 868), so the fold is a guard, not a bucket.
export const PARTY_ORDER = ["D", "R", "I"] as const;
export type PartyKey = (typeof PARTY_ORDER)[number];

export function normalizeParty(party: string | null | undefined): PartyKey {
  const u = (party ?? "").trim().toUpperCase();
  return u === "D" || u === "R" ? u : "I";
}

// THE APPORTIONMENT RULE, ported verbatim from the `allocate()` in
// docs/design/mock-673-sponsor-cosponsor.html — the committed ruling record.
//
// Equal split among the parties PRESENT, floored; a party that cannot fill its
// share (fewer members than slots) gives the remainder back and the loop runs
// again over the parties that still have room. Tie-break, when the remainder is
// smaller than the number of open groups: largest party count first.
//
// Worked (HO 675 STEP 0, and these are the cases the ruling asked for):
//   R only x4        -> R4        (capped by the count, not the budget)
//   R only x40       -> R6
//   D6/R2/I1         -> D3/R2/I1  (I fills 1 of its 2, D takes the remainder)
//   D1/R1            -> D1/R1
//   D3/R3            -> D3/R3     (a party at exactly half)
//   D21/R1           -> D5/R1     (redistribution)
//   D218/R184        -> D3/R3
//   zero cosponsors  -> {}        (the row does not render)
//
// RULED HO 675 against a PROPORTIONAL reading of the same ruling, which the
// handoff's prose implied. Proportional allocates a PRESENT party ZERO faces on
// 718 bills (`119-hconres-31` D1/R11 -> D0/R6, erasing the lone Democrat); this
// rule does that on 0. The two disagree on 1,944 bills (13.85%). And the thing
// the prose was trying to forbid, this rule already does not do: it lands on a
// flat 3/3 on only 35.2% of two-party rosters.
export function allocateFaces(
  counts: Partial<Record<PartyKey, number>>,
): Record<string, number> {
  const groups = PARTY_ORDER.filter((p) => (counts[p] ?? 0) > 0);
  const out: Record<string, number> = {};
  for (const p of groups) out[p] = 0;
  let left = Math.min(
    FACE_BUDGET,
    groups.reduce((sum, p) => sum + (counts[p] ?? 0), 0),
  );
  while (left > 0) {
    const open = groups.filter((p) => (out[p] ?? 0) < (counts[p] ?? 0));
    if (open.length === 0) break;
    const share = Math.floor(left / open.length);
    if (share === 0) {
      // Fewer slots left than open groups: hand them out largest-first.
      const ranked = open
        .slice()
        .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
      for (let i = 0; i < left && i < ranked.length; i++) {
        const p = ranked[i]!;
        out[p] = (out[p] ?? 0) + 1;
      }
      break;
    }
    for (const p of open) {
      const take = Math.min(share, (counts[p] ?? 0) - (out[p] ?? 0));
      out[p] = (out[p] ?? 0) + take;
      left -= take;
    }
  }
  return out;
}

// One cosponsor as the panel draws them. The display strings are built HERE
// rather than in the component so the payload carries four short strings
// instead of six columns, and so the 32x38 face and the 80x94 sponsor portrait
// beside it cannot drift apart in a later edit of only one of them.
//
// The party bracket is a FOURTH implementation of that string — the others are
// `BillExpandPanel.tsx` (SponsorMeta), `SponsorHoverName.tsx` and
// `V2FeedList.tsx`. Unifying them is NOT this HO: the sponsor block's output is
// asserted byte-identical against a before-capture, and rewriting how it
// computes the same string is risk with no gain here. Filed in docs/backlog.md.
export type CosponsorFace = {
  bioguideId: string;
  // "Rep. Monica De La Cruz" — the real member columns, not the noisy
  // "Last, First [bracket]" of bills.sponsor_name.
  name: string;
  party: PartyKey;
  // "[R-TX-15]" / "[D-AZ]" / "[R-WY-AL]".
  bracket: string;
  // "Texas · House" — the hover tip's second line.
  meta: string;
  depictionUrl: string | null;
};

export type CosponsorRosterRow = {
  bioguideId: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  party: string | null;
  state: string | null;
  district: number | null;
  chamber: string | null;
  depictionUrl: string | null;
};

export type CosponsorRoster = {
  // Present parties only, in D / R / I order, with the roster's OWN count.
  //
  // NOT reconciled against `bills.cosponsor_count`, deliberately: that column
  // is stale-low on 1,919 of 13,926 bills (13.78%, median +1, max +50) and
  // HO 675 is explicitly forbidden from repairing it. The panel therefore shows
  // the stale total above group headers sourced from the roster, and on ~1 bill
  // in 7 they disagree. Ruled visible rather than papered over, and filed
  // against HO 674's drift entry as its UI-visible consequence.
  groups: { party: PartyKey; count: number }[];
  // Exactly the faces drawn, already apportioned and ordered.
  faces: CosponsorFace[];
};

// Build the drawn roster from the query's rows. Rows arrive already filtered to
// the ACTIVE set (withdrawn excluded in SQL) and ordered earliest-first, which
// is the mock's OPEN-1 default and the order that decides WHICH faces you get
// once a group is over budget.
export function buildCosponsorRoster(
  rows: CosponsorRosterRow[],
): CosponsorRoster {
  const counts: Partial<Record<PartyKey, number>> = {};
  const byParty = new Map<PartyKey, CosponsorRosterRow[]>();
  for (const row of rows) {
    const p = normalizeParty(row.party);
    counts[p] = (counts[p] ?? 0) + 1;
    if (!byParty.has(p)) byParty.set(p, []);
    byParty.get(p)!.push(row);
  }

  const alloc = allocateFaces(counts);
  const groups: { party: PartyKey; count: number }[] = [];
  const faces: CosponsorFace[] = [];
  for (const p of PARTY_ORDER) {
    const n = counts[p] ?? 0;
    if (n === 0) continue;
    groups.push({ party: p, count: n });
    const take = alloc[p] ?? 0;
    for (const row of (byParty.get(p) ?? []).slice(0, take)) {
      faces.push(toFace(row, p));
    }
  }
  return { groups, faces };
}

function toFace(row: CosponsorRosterRow, party: PartyKey): CosponsorFace {
  const isSenate = (row.chamber ?? "").toLowerCase().startsWith("s");
  const honorific = isSenate ? "Sen." : "Rep.";
  const haveParts = row.firstName && row.lastName;
  const name = haveParts
    ? `${honorific} ${row.firstName} ${row.lastName}`
    : (row.name ?? row.bioguideId);
  // House with no stored district renders AL (at-large), matching SponsorMeta.
  const districtSeg =
    row.district != null ? `-${row.district}` : isSenate ? "" : "-AL";
  const bracket = `[${row.party ?? "?"}-${row.state ?? "?"}${districtSeg}]`;
  const meta = row.state
    ? `${stateName(row.state)} · ${isSenate ? "Senate" : "House"}`
    : isSenate
      ? "Senate"
      : "House";
  return {
    bioguideId: row.bioguideId,
    name,
    party,
    bracket,
    meta,
    depictionUrl: row.depictionUrl,
  };
}

// ---- related bills ----------------------------------------------------------

// THE `identical` PREDICATE. Case-insensitive CONTAINMENT, never equality.
//
// The corpus carries SIX relationship_type values and TWO of them are
// identical-flavoured: `Identical bill` (3,454 rows) and
// `Identical Bill (Became Law)` (24 rows, capital B and an appended clause).
// `= 'Identical bill'` silently drops those 24 — and they are the most
// interesting rows in the set, because the twin became law and this bill did
// not. Controls run at HO 675 STEP 0: 6,562 `Related bill` /
// `Procedurally related` rows exist and this predicate matches 0 of them.
export function isIdenticalRelationship(relationshipType: string): boolean {
  return relationshipType.toLowerCase().includes("identical");
}

function isBecameLaw(relationshipType: string): boolean {
  return relationshipType.toLowerCase().includes("became law");
}

// Short display labels for the six known values. An unknown value falls through
// to the raw string rather than to a blank, so a seventh value appearing
// upstream shows up on screen instead of vanishing.
const RELATIONSHIP_LABEL: Record<string, string> = {
  "identical bill": "Identical",
  "identical bill (became law)": "Identical · law",
  "related bill": "Related",
  "procedurally related": "Procedural",
  "public law contains the text": "In public law",
  "contained in public law": "In public law",
};

// Which type wins when one target arrives under several. 484 of 9,736
// (bill, target) pairs carry more than one type (HO 675 STEP 0), so this fires
// on ~5% of rows and is not a theoretical branch.
const RELATIONSHIP_RANK = [
  "identical",
  "public law",
  "procedurally",
  "related",
];

function rankOf(relationshipType: string): number {
  const lower = relationshipType.toLowerCase();
  const i = RELATIONSHIP_RANK.findIndex((k) => lower.includes(k));
  return i === -1 ? RELATIONSHIP_RANK.length : i;
}

export type RelatedBillRosterRow = {
  relatedBillId: string;
  relationshipType: string;
  // NULL when the target is not in `bills` — 82 of 10,254 rows corpus-wide.
  title: string | null;
  introducedDate: string | null;
  stage: string | null;
  // Carried EXPLICITLY from the LEFT JOIN rather than inferred from `title`
  // being null: `bills.title` is nullable in principle, so inferring would
  // conflate "target absent" with "target present but untitled" — two states
  // that render differently (no link vs link).
  resolved: boolean;
};

export type RelatedBillView = {
  id: string;
  // Always present: parsed from the id, so an unresolved target still names
  // itself.
  label: string;
  title: string | null;
  // The short display label for the winning relationship type.
  relationship: string;
  introducedDate: string | null;
  stage: string | null;
  // FALSE when the target is absent from `bills`. The component renders these
  // with no title and NO LINK — `app/bill/[id]/page.tsx` calls notFound(), so a
  // link would 404. 16 of the 82 sit on rows this HO promotes.
  resolved: boolean;
};

export type PromotedRelatedBill = RelatedBillView & {
  // "Senate" / "House" — the TARGET's chamber, which is what makes it a
  // companion. Drives the "Senate companion · identical" label.
  chamber: Chamber;
  // True when any of the target's relationship types is a Became-Law variant.
  becameLaw: boolean;
};

export type RelatedBillsShape = {
  // Cross-chamber identicals, DEDUPED BY TARGET.
  //
  // The dedupe is forced, not chosen: 22 (bill, target) pairs carry more than
  // one identical-matching type — `119-hjres-124 -> 119-sjres-80` arrives as
  // `Identical bill`, `Identical Bill (Became Law)` AND `Contained in public
  // law` — so a row-wise promotion draws the same twin two or three times.
  //
  // Counted by DISTINCT TARGET, only 25 of 3,060 bills (0.82%) promote more
  // than one, so this block is a single row 99.2% of the time. Counted by ROW
  // it looks like 47, and HO 674's "$.relatedBills.count counts relationship
  // entries, not bills" trap is exactly what the difference is. The rule that
  // survives both: count what the UI draws, not what the table holds.
  promoted: PromotedRelatedBill[];
  // Everything else, deduped by target, ordered. NOT capped here — the
  // component cuts it, after removing anything the HEARING block is already
  // printing off its chosen meeting's agenda.
  rest: RelatedBillView[];
};

export function shapeRelatedBills(
  billId: string,
  rows: RelatedBillRosterRow[],
): RelatedBillsShape {
  const sourceChamber = chamberOfBillId(billId);
  // Fold to one entry per target, keeping the highest-ranked type and a flag
  // for whether ANY of the target's types is identical / became-law.
  type Folded = RelatedBillRosterRow & {
    identical: boolean;
    becameLaw: boolean;
  };
  const byTarget = new Map<string, Folded>();
  for (const row of rows) {
    const prev = byTarget.get(row.relatedBillId);
    const identical = isIdenticalRelationship(row.relationshipType);
    const becameLaw = isBecameLaw(row.relationshipType);
    if (!prev) {
      byTarget.set(row.relatedBillId, { ...row, identical, becameLaw });
      continue;
    }
    prev.identical = prev.identical || identical;
    prev.becameLaw = prev.becameLaw || becameLaw;
    if (rankOf(row.relationshipType) < rankOf(prev.relationshipType)) {
      prev.relationshipType = row.relationshipType;
    }
    // The joined columns are per-TARGET, so they are identical across the
    // duplicate rows; nothing to merge.
  }

  const promoted: PromotedRelatedBill[] = [];
  const rest: RelatedBillView[] = [];
  for (const f of byTarget.values()) {
    const view = toRelatedView(f);
    const targetChamber = chamberOfBillId(f.relatedBillId);
    const crossChamber =
      f.identical &&
      sourceChamber != null &&
      targetChamber != null &&
      sourceChamber !== targetChamber;
    if (crossChamber) {
      promoted.push({ ...view, chamber: targetChamber!, becameLaw: f.becameLaw });
    } else {
      // SAME-CHAMBER identicals land here, and that is the ruling rather than
      // an oversight: a companion is the OTHER chamber's twin. A same-chamber
      // identical is a duplicate filing or a reintroduction — a different and
      // less interesting fact — so it stays in the list below rather than being
      // promoted OR dropped. 217 bills carry one.
      rest.push(view);
    }
  }

  // Resolved before unresolved, then newest introduction first, then by id so
  // the order is total and a render is reproducible.
  const byDate = (a: RelatedBillView, b: RelatedBillView) => {
    if (a.resolved !== b.resolved) return a.resolved ? -1 : 1;
    const ad = a.introducedDate ?? "";
    const bd = b.introducedDate ?? "";
    if (ad !== bd) return bd.localeCompare(ad);
    return a.id.localeCompare(b.id);
  };
  promoted.sort(byDate);
  rest.sort(byDate);
  return { promoted, rest };
}

function toRelatedView(row: RelatedBillRosterRow): RelatedBillView {
  const key = row.relationshipType.toLowerCase();
  return {
    id: row.relatedBillId,
    label: labelFromBillId(row.relatedBillId),
    title: row.title,
    relationship: RELATIONSHIP_LABEL[key] ?? row.relationshipType,
    introducedDate: row.introducedDate,
    stage: row.stage,
    resolved: row.resolved,
  };
}
