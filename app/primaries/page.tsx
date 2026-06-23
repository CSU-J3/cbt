// /primaries index (handoff 91). The 2026 state congressional primary
// calendar — all 50 states — grouped by date, today first, past collapsed.
// Voted primaries (HO 206 `vote_pct`) render a result share bar (HO 207);
// upcoming ones show the candidate field as a "not yet voted" fallback.
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { PrimariesMap } from "@/components/PrimariesMap";
import { PrimaryExpandProvider, PrimaryRow } from "@/components/PrimaryRow";
import { buildPrimariesCartogram } from "@/lib/cartogram-data";
import { daysUntil, formatDateLong } from "@/lib/format";
import { getUsMapGeometry } from "@/lib/us-map-geo";
import {
  getPastPrimaries,
  getUpcomingPrimaries,
  type PrimaryWithCandidates,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

function relativeLabel(date: string): string {
  const d = daysUntil(date);
  if (d === 0) return "TODAY";
  if (d > 0) return `in ${d} ${d === 1 ? "day" : "days"}`;
  const ago = -d;
  return `${ago} ${ago === 1 ? "day" : "days"} ago`;
}

// Rows arrive already date-sorted; collapse runs of equal primary_date.
function groupByDate(
  rows: PrimaryWithCandidates[],
): { date: string; rows: PrimaryWithCandidates[] }[] {
  const groups: { date: string; rows: PrimaryWithCandidates[] }[] = [];
  for (const r of rows) {
    const date = r.primary_date ?? "";
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.rows.push(r);
    else groups.push({ date, rows: [r] });
  }
  return groups;
}

function DateGroup({
  date,
  rows,
}: {
  date: string;
  rows: PrimaryWithCandidates[];
}) {
  const isToday = daysUntil(date) === 0;
  return (
    <section
      className="mb-3 border"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <div
        className="flex items-baseline justify-between px-3 py-2"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderBottom: "0.5px solid var(--border-strong)",
        }}
      >
        <span
          className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
          style={{
            color: isToday
              ? "var(--accent-amber-bright)"
              : "var(--text-secondary)",
          }}
        >
          {formatDateLong(date)} · {relativeLabel(date)}
        </span>
        <span
          className="text-[11px] uppercase tracking-[0.5px] tabular-nums"
          style={{ color: "var(--text-dim)" }}
        >
          {rows.length} contest{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div>
        {rows.map((p) => (
          <PrimaryRow key={p.id} p={p} />
        ))}
      </div>
    </section>
  );
}

export default async function PrimariesPage() {
  // HO 207: lift the 300 cap to cover the full 2026 cycle (~457 past / ~447
  // upcoming). The old cap dropped the earliest-voted primaries — now that each
  // voted row carries a result share bar, that hid ~157 results (incl. the
  // March 3 TX-Sen Paxton/Cornyn runoff).
  const [upcoming, past] = await Promise.all([
    getUpcomingPrimaries(600),
    getPastPrimaries(600),
  ]);

  // HO 208 guard: in the voted block, hide past contests with no roster AND no
  // result (the empty "roster pending" rows). This is a DISPLAY guard over two
  // distinct underlying problems — neither fixed here, both a data follow-up:
  //   • FALSE CONTESTS — senate primaries for states with no 2026 Senate seat
  //     (IN / PA / CA Senate). The primaries sync seeds senate-{ST}-2026-{D,R,
  //     open} for all 50 states regardless of whether a seat is up; these rows
  //     should be suppressed at the SOURCE (sync fix), not merely hidden.
  //   • REAL BUT UNROSTERED — genuine 2026 contests whose roster scrape is
  //     missing (SD/WV Senate, ~25 House). These should be BACKFILLED, not
  //     suppressed — the guard hiding them must not become their resting state.
  const votedRows = past.filter(
    (p) =>
      p.candidates.length > 0 || p.candidates.some((c) => c.vote_pct != null),
  );
  const upcomingGroups = groupByDate(upcoming);
  const pastGroups = groupByDate(votedRows);

  // HO 210: cartogram bands — VOTED (vote_pct present) / SOON (next-4 rolling
  // window) / LATER. Built from the full unfiltered set (not the votedRows
  // display guard) so band classification sees every contest.
  const todayISO = new Date().toISOString().slice(0, 10);
  const cartogram = buildPrimariesCartogram(upcoming, past, todayISO);
  const geometry = getUsMapGeometry();

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/primaries" />
      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="races" active="primaries" />
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            2026 primaries
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {past.length} past · {upcoming.length} upcoming · 2026 cycle
          </span>
        </div>

        <p
          className="mb-4 text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          State congressional primary calendar, all 50 states. Voted contests
          show candidate result shares; upcoming show the field. Sources:
          270toWin (calendar) · Ballotpedia (rosters + results).
        </p>

        {/* HO 210: map-first cartogram above the existing list. The full
            date-sorted list (HO 208) is one MAP/LIST toggle away, unchanged,
            passed in as listSlot. */}
        <PrimariesMap
          cells={cartogram.cells}
          summary={cartogram.summary}
          geometry={geometry}
          listSlot={
            <PrimaryExpandProvider>
          {pastGroups.map((g) => (
            <DateGroup key={`past-${g.date}`} date={g.date} rows={g.rows} />
          ))}

          {upcomingGroups.length > 0 && pastGroups.length > 0 ? (
            <div className="mt-6 mb-3 flex items-center gap-3">
              <span
                className="shrink-0 text-[11px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-dim)" }}
              >
                Upcoming · not yet voted
              </span>
              <span
                className="h-px flex-1"
                style={{ backgroundColor: "var(--border-strong)" }}
              />
            </div>
          ) : null}

          {upcomingGroups.map((g) => (
            <DateGroup key={`up-${g.date}`} date={g.date} rows={g.rows} />
          ))}

          {pastGroups.length === 0 && upcomingGroups.length === 0 ? (
            <div
              className="px-4 py-12 text-center text-[13px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              No primaries
            </div>
          ) : null}
            </PrimaryExpandProvider>
          }
        />
      </main>
    </div>
  );
}
