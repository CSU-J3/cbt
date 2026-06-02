// /primaries index (handoff 91). The 2026 state congressional primary
// calendar — all 50 states — grouped by date, today first, past collapsed.
// Candidate rosters (Step 3) land in a follow-up sync; rows show a count.
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { TerminalPrompt } from "@/components/TerminalPrompt";
import { daysUntil, formatDateLong, formatDateShort } from "@/lib/format";
import {
  getPastPrimaries,
  getUpcomingPrimaries,
  type PrimaryWithCandidates,
} from "@/lib/queries";
import { stateName } from "@/lib/states";

export const dynamic = "force-dynamic";

function partyChip(party: string): { label: string; color: string } {
  if (party === "D") return { label: "DEM", color: "var(--party-democrat)" };
  if (party === "R") return { label: "REP", color: "var(--party-republican)" };
  return { label: "OPEN", color: "var(--accent-amber)" };
}

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

function PrimaryRow({ p }: { p: PrimaryWithCandidates }) {
  const chip = partyChip(p.party);
  const special =
    p.primary_type && p.primary_type !== "open" && p.primary_type !== "closed"
      ? p.primary_type.replace(/_/g, " ")
      : null;
  return (
    <div
      className="flex items-baseline justify-between gap-3 px-3 py-1.5"
      style={{ borderBottom: "0.5px solid var(--border-soft)" }}
    >
      <span className="flex items-baseline gap-2">
        <span
          className="inline-block text-[11px] uppercase tracking-[0.5px]"
          style={{ color: chip.color, width: "38px" }}
        >
          {chip.label}
        </span>
        <span className="text-[13px]" style={{ color: "var(--text-primary)" }}>
          {stateName(p.state)}
        </span>
        {special ? (
          <span
            className="text-[11px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            {special}
          </span>
        ) : null}
      </span>
      <span
        className="flex items-baseline gap-3 text-[12px] tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        {p.runoff_date ? (
          <span style={{ color: "var(--text-dim)" }}>
            runoff {formatDateShort(p.runoff_date)}
          </span>
        ) : null}
        <span>
          {p.candidates.length} candidate{p.candidates.length === 1 ? "" : "s"}
        </span>
      </span>
    </div>
  );
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
  const [upcoming, past] = await Promise.all([
    getUpcomingPrimaries(300),
    getPastPrimaries(300),
  ]);
  const upcomingGroups = groupByDate(upcoming);
  const pastGroups = groupByDate(past);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/primaries" />
      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="races" active="primaries" />
        <div className="page-masthead">
          <TerminalPrompt name="Primaries" />
        </div>
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Upcoming primaries
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {upcoming.length} upcoming · {past.length} past · 2026 cycle
          </span>
        </div>

        <p
          className="mb-4 text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          State congressional primary calendar, all 50 states. Source: 270toWin.
          Candidate rosters land in a follow-up sync (handoff 91 Step 3).
        </p>

        {upcomingGroups.length === 0 ? (
          <div
            className="px-4 py-12 text-center text-[13px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            No upcoming primaries
          </div>
        ) : (
          upcomingGroups.map((g) => (
            <DateGroup key={g.date} date={g.date} rows={g.rows} />
          ))
        )}

        {pastGroups.length > 0 ? (
          <details className="mt-6">
            <summary
              className="cursor-pointer text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              Past primaries · {past.length} contests
            </summary>
            <div className="mt-3">
              {pastGroups.map((g) => (
                <DateGroup key={g.date} date={g.date} rows={g.rows} />
              ))}
            </div>
          </details>
        ) : null}
      </main>
    </div>
  );
}
