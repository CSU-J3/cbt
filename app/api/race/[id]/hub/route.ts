// HO 166 — lazy hub data for the dashboard competitive-races drawer. The card
// already carries raceId + ratings + incumbent identity from
// getMostCompetitiveRaces; this route fetches the rest of what the race hub
// shows (full race row, incumbent member, candidates, runoffs) on first
// expand only. The client wrapper caches the result per raceId so re-opening
// a card is free — same contract as /api/bill/[id]/panel.
import { NextResponse } from "next/server";
import {
  getMember,
  getRace,
  getRaceCandidates,
  getRunoffsForRace,
} from "@/lib/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const race = await getRace(id);
  if (!race) {
    return NextResponse.json({ error: "race not found" }, { status: 404 });
  }

  const [candidates, incumbent, runoffs] = await Promise.all([
    getRaceCandidates(race.id),
    race.incumbent_bioguide_id
      ? getMember(race.incumbent_bioguide_id)
      : Promise.resolve(null),
    getRunoffsForRace(race.id),
  ]);

  return NextResponse.json({ race, incumbent, candidates, runoffs });
}
