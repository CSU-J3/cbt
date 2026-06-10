# HO 183 — Cycle the LAST SYNC + tape AS OF timestamps through US time zones

## Why

Both dashboard timestamps currently show a single fixed zone:
- **Masthead subhead:** `· LAST SYNC 3:34 AM MT · N BILLS TRACKED` (MT)
- **Tape AS OF:** `AS OF 8:23 PM UTC` (UTC; on the bottom/commodities tape only, per HO 179.1)

Make both **cycle through ET → CT → MT → PT → UTC** on a timer (rotating which zone the fixed timestamp is displayed in). Bloomberg-terminal flavor — a world-clock feel.

## Key framing (so this is built right)

- **It's the same fixed past time, re-rendered in different zones** — NOT a live ticking clock. LAST SYNC is when the data last synced; AS OF is the tape's data timestamp. The underlying moment is fixed; only the displayed zone rotates. Don't turn it into a live clock.
- **Each displayed time MUST carry its zone label** (`4:23 PM ET`, `2:23 PM MT`, `8:23 PM UTC`) — because the display rotates, a glance can land on any zone, so the label is mandatory or the time becomes unreadable/misleading.
- **DST-correct conversion required.** Use real IANA timezone conversion (`Intl.DateTimeFormat` with `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`, `UTC`), NOT hardcoded UTC offsets — offsets shift with daylight saving and would be an hour wrong half the year. The label abbreviation should also reflect DST where it differs (EDT vs EST, etc.) OR use the generic ET/CT/MT/PT — Phase 1 to recommend (generic ET/CT/MT/PT is likely cleaner and is what the user asked for).
- **This is a THIRD named motion exception** (alongside the cursor blink and the tapes, per HO 157/178). It must respect `prefers-reduced-motion`: reduced-motion users get a STATIC single zone (recommend the user's local MT) with no cycling. Document it as a named exception.

## Phase 1 — Diagnostic (HALT after)

1. **Find both timestamp renders.** The masthead LAST SYNC (the subhead, `formatLastUpdated`-ish, currently MT) and the tape AS OF (`MarketsTapeClient` meta, currently UTC). Report how each currently formats its time and where the source timestamp comes from (the sync time / the tick `as-of` date). Confirm both have a real underlying Date/timestamp to re-format per zone (not a pre-formatted string we'd have to parse back).
2. **Cycle mechanism.** Propose a shared approach — a small hook/util that holds the current zone index and advances it on an interval, formatting a given timestamp into the active zone with `Intl.DateTimeFormat`. Both surfaces consume it so they cycle in sync (ideally showing the SAME zone at the same time — confirm that's desirable; one shared ticker driving both reads cleaner than two independent ones drifting). Report the cleanest shared implementation.
3. **Cycle speed.** Recommend an interval — ~3–4s per zone (readable, full 5-zone loop ~15–20s). Too fast = unreadable flicker; too slow = long wait for your zone. Propose a value.
4. **Zone labels.** Confirm the label format: generic `ET / CT / MT / PT / UTC` (recommended, matches the ask) vs. DST-aware `EDT/EST…`. Report.
5. **Reduced-motion + the existing rules.** Confirm `prefers-reduced-motion` gives a static single zone (MT) on both. Confirm this doesn't conflict with the `<700` rules (the tape hides `<700`, so its AS OF cycling is moot there; the masthead subhead persists `<700` — does it still cycle, or go static? Recommend: masthead can still cycle `<700` since it's text, not the tape). Confirm it composes with the tape's existing poll/measurement (the cycling is display-only, must NOT trigger a tape re-measure or restart the marquee — it only changes the meta text, like a value poll).
6. **Width stability (tape).** The AS OF meta width changes slightly per zone ("ET" vs "UTC", AM/PM). Confirm this doesn't reflow the tape track / reintroduce the jump — the meta is a fixed right-anchored element (HO 179) outside the scrolling track, so it should be safe, but confirm the meta's container width is stable or independent of the track.

**HALT. Report: both timestamp sources, the shared cycle mechanism, the speed, the label format, the reduced-motion/`<700` behavior, and the tape-width-stability confirm. Wait for sign-off.**

## Phase 2 — Implementation (after sign-off)
- Shared cycle hook/util (Intl-based, DST-correct, one ticker driving both surfaces in sync).
- Both timestamps cycle ET→CT→MT→PT→UTC with zone labels, at the agreed interval.
- Reduced-motion → static MT on both; document the third named motion exception.
- Display-only: no live clock, no tape re-measure, no marquee restart.

## Verification
- Both LAST SYNC and AS OF cycle through the 5 zones with correct, DST-accurate times + clear zone labels.
- They cycle in sync (same zone shown at once) if Phase 1 confirms that's the design.
- The underlying time is fixed (cycling zones of one moment, not a ticking clock) — verify the displayed times are consistent across zones (e.g. ET and MT differ by exactly the right offset for the same instant).
- Reduced-motion → static MT, no cycling.
- Tape: AS OF cycling doesn't reflow the track or restart the marquee (watch a poll cycle).
- Type check passes.
- Run on a branch; Corey eyeballs (the cycling is visual).

## Out of scope
- No live/ticking clock — it's a fixed timestamp re-rendered per zone.
- No change to when sync actually happens or the tape poll.
- No new zones beyond ET/CT/MT/PT/UTC.
