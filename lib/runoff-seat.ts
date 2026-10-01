// HO 763 — THE SEAT A RUNOFF ROUND BELONGS TO. One copy of the key, read by the race page's runoff read
// (lib/queries.ts getRunoffsForRace) and by the primaries cron's stray list (lib/primaries-sync.ts
// findRunoffStrays), so what the page draws and what the payload calls a stray cannot drift apart.
//
// A runoff round (`primaries` p, election_round 'runoff') reaches the race (`races` r) of its state,
// chamber and cycle (the year of its date), and for the House its district: primaries.district is
// zero-padded TEXT ("07", the at-large "00") and races.district an INTEGER (the at-large 0), hence the
// CAST; a Senate round and a Senate race both carry a NULL district. `primaries.race_id` is not read: the
// sync never writes it (HO 761), and only the seeded rows carry one, which this key reproduces (HO
// 763's STEP 0: no round's race_id disagreed with its seat). The cycle is in the key because `races`
// holds the 2028 and 2030 Senate seats too, and without it a 2026 runoff would draw on them.
// A Senate special collapses onto its state's one Senate race of the cycle (S-SC-2026), as the
// harvest's seat join does.
export const RUNOFF_SEAT_JOIN = `r.state = p.state AND r.chamber = p.chamber
       AND CAST(r.cycle AS TEXT) = substr(p.primary_date, 1, 4)
       AND ((p.district IS NULL AND r.district IS NULL) OR CAST(p.district AS INTEGER) = r.district)`;
