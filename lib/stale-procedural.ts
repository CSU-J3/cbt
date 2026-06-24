// HO 350 — procedural housekeeping filter for /stale. The stage-led /stale view
// surfaces past-committee stalls "furthest first," which would otherwise be
// dominated by one-time opening-week organizational resolutions (oldest action
// dates = Jan 2025). These aren't "stalled bills" — they did their job and
// nothing more was meant to happen. Filtered from the default, NOT deleted: the
// INCLUDE PROCEDURAL toggle brings them back (and is the escape hatch if this
// curation ever grabs a real bill).
//
// TWO matchers + a blocklist (per the handoff):
//  1. STALE_PROCEDURAL_IDS — a FROZEN id list for the one-time opening-week set
//     (electoral-vote count, elect/notify officers, fix meeting hour,
//     quorum/assemble, pro-tem election). Both sessions of the 119th.
//  2. STALE_PROCEDURAL_TITLE_PATTERN — a LIVE SQL LIKE for the recurring
//     "Electing Members to … committees" family, which recurs all year (an id
//     list alone would miss new ones).
//  3. STALE_PROCEDURAL_BLOCKLIST — title-pattern false positives that must
//     survive (honoring/thanks resolutions that mention "President pro tempore").
//
// Validated against the HO 345 diagnostic on the live corpus (see
// scripts/diagnostic/stale-procedural-350.ts). Signed off by Corey before the
// default filter shipped.

// Full bills.id form ("119-hres-1"). Lowercase title match is case-insensitive.
export const STALE_PROCEDURAL_IDS: readonly string[] = [
  "119-sconres-2", // counting the Jan 6, 2025 electoral votes
  "119-hres-1", // electing officers of the House
  "119-hres-4", // inform the President of the election of the Speaker and Clerk
  "119-hres-6", // fixing the daily hour of meeting (1st session, House)
  "119-hres-976", // providing for the hour of meeting of the House (2nd session)
  "119-sres-7", // fixing the hour of daily meeting of the Senate
  "119-sres-1", // committee to inform the President a quorum has assembled
  "119-sres-3", // electing the Senate President pro tempore (Grassley)
  "119-sres-4", // notifying the President of the pro-tempore election
  "119-sres-5", // notifying the House of the pro-tempore election
  // HO 350 sign-off: joint-session resolutions are done-not-stalled like the
  // rest. Frozen IDs, NOT a live pattern — they recur ~1/year with no fixed
  // title family to match, and INCLUDE PROCEDURAL reveals them in one click.
  "119-hconres-11", // joint session to receive a message from the President
  "119-hconres-16", // joint session of Congress in Philadelphia (July 2026)
  "119-hconres-74", // joint session to receive a message from the President
];

// Recurring "Electing Members to certain standing committees…" family. Anchored
// at the start so it can't catch a substantive bill that merely contains the
// words. Matched via lower(title) LIKE STALE_PROCEDURAL_TITLE_PATTERN.
export const STALE_PROCEDURAL_TITLE_PATTERN = "electing members%";

// False positives the pattern (or a broadened future one) must never remove —
// honoring/thanks resolutions that mention "President pro tempore."
export const STALE_PROCEDURAL_BLOCKLIST: readonly string[] = [
  "119-hres-966", // honoring Senate President pro tempore Monique Limón
  "119-sres-6", // thanking Patty Murray for her service as President pro tempore
];
