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

export type PanelData = {
  committees: PanelCommittee[];
  news: PanelNews[];
  meetings: PanelMeeting[];
};
