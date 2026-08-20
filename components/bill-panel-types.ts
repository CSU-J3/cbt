import type {
  CosponsorRoster,
  RelatedBillsShape,
} from "@/lib/bill-rosters-view";

// The `/api/bill/[id]/panel` payload shape.
//
// PROVENANCE: these four types were written in `components/BillExpandedPanel.tsx`
// (HO 191, widened HO 299/324) and lived there because that component was the
// only thing that read them. HO 317 made `BillExpandPanel` — no "ed", the shared
// panel — the live renderer, and it kept importing the types back out of the
// older file. HO 666 deleted `BillExpandedPanel.tsx` once its last render site
// went with `BillRowList`'s dead `compact` passthrough, so the types moved here
// VERBATIM rather than folding into `BillExpandPanel.tsx`: a types-only module
// leaves the live shared component untouched and ends the two-components-one-
// letter-apart name collision that the deletion would otherwise have preserved
// in every import line.
//
// Two of the four are imported by name (`PanelData` ×3, `PanelMeeting` ×2); the
// other two are reachable only as `PanelData`'s field types. All four are live.
//
// HO 675 added the roster half. Its two payload types are RE-EXPORTS of the
// shapes `lib/bill-rosters-view.ts` already computes, not new declarations —
// the route runs the transforms and serializes their output verbatim, so a
// second declaration here would be a copy that can drift from the thing that
// produces it.

export type PanelCommittee = {
  systemCode: string;
  name: string;
  chamber: "house" | "senate" | "joint";
  parentName: string | null;
  activityType: string;
  activityDate: string;
};

export type PanelNews = {
  id: number;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
};

// HO 299: meetings (hearings) covering this bill, for the expand's HEARING slot.
// The committee name is resolved in the panel route. HO 324 widened the shape
// (was {eventId, meetingDate, committeeName, committeeSystemCode}) to carry the
// rich detail the always-on HEARING slot renders: type/status/room/video + the
// meeting's agenda bills (pre-formatted id + label).
export type PanelMeeting = {
  eventId: string;
  meetingDate: string;
  committeeName: string | null;
  committeeSystemCode: string | null;
  meetingType: string;
  meetingStatus: string;
  building: string | null;
  room: string | null;
  videoUrl: string | null;
  agenda: { id: string; label: string }[];
};

// HO 675 — the roster half of the payload, both bounded before serialization.
//
// `cosponsors` carries ONLY the drawn faces plus the per-party totals, never
// the roster: `119-hr-842` has 338 active cosponsors and the panel draws six,
// so the apportionment runs in the route and ~50KB of member objects never
// crosses the wire.
//
// `relatedBills` is shaped (promoted / deduped by target / ordered) but NOT
// capped, because the last filter is against the one meeting the HEARING block
// picked, and which meeting that is depends on `showMomentum` — a prop the
// route cannot see. The component finishes the cut.
export type PanelCosponsors = CosponsorRoster;
export type PanelRelatedBills = RelatedBillsShape;

export type PanelData = {
  committees: PanelCommittee[];
  news: PanelNews[];
  meetings: PanelMeeting[];
  cosponsors: PanelCosponsors;
  relatedBills: PanelRelatedBills;
};

// HO 675 — the fetch-failure fallback, ONE definition.
//
// `BillRowList` and `V2FeedList` each hand this to `handleLoaded` when the
// panel fetch rejects, so the panel renders its empty states instead of
// hanging on "loading…". It lives here rather than twice in the two lists
// because widening `PanelData` broke both copies at once — tsc caught it, and
// a shared const means the next widening cannot break them silently.
//
// This makes the module no longer strictly types-only (see PROVENANCE above).
// That is deliberate: the empty VALUE of a payload shape belongs beside the
// shape, and the alternative was a third file or a second copy.
export const EMPTY_PANEL: PanelData = {
  committees: [],
  news: [],
  meetings: [],
  cosponsors: { groups: [], faces: [] },
  relatedBills: { promoted: [], rest: [] },
};
