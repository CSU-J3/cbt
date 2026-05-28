// /committee/[systemCode] minimal detail (handoff 144). Two sections side
// by side on desktop: members (left, ~40%) sorted majority → minority then
// rank, and recent bills (right, ~60%) filtered to the trailing 30-day
// window and rendered with BillRow + a per-committee activity caption.
import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { CommitteeActivityChart } from "@/components/CommitteeActivityChart";
import { CommitteeTopicDistribution } from "@/components/CommitteeTopicDistribution";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { daysSince } from "@/lib/format";
import {
  type CommitteeMember,
  getCommitteeBills,
  getCommitteeBySystemCode,
  getCommitteeMembers,
  getCommitteeSubcommittees,
  getWatchedBillIds,
} from "@/lib/queries";

const RECENT_LIMIT = 25;
const RECENT_DAYS = 30;

function chamberLabel(chamber: "house" | "senate" | "joint"): string {
  if (chamber === "house") return "HOUSE";
  if (chamber === "senate") return "SENATE";
  return "JOINT";
}

function chamberColor(chamber: "house" | "senate" | "joint"): string {
  if (chamber === "house") return "var(--party-democrat)";
  if (chamber === "senate") return "var(--party-republican)";
  return "var(--accent-amber)";
}

function partyColor(party: "R" | "D" | "I" | null): string {
  if (party === "R") return "var(--party-republican)";
  if (party === "D") return "var(--party-democrat)";
  if (party === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

function roleIsLeadership(role: string | null): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return (
    r.includes("chair") ||
    r.includes("ranking")
  );
}

function MemberItem({ m }: { m: CommitteeMember }) {
  const isLead = roleIsLeadership(m.role);
  const name = m.name ?? m.bioguideId;
  return (
    <li
      className="grid grid-cols-[1fr_auto] items-baseline gap-2 px-3 py-1.5 border-b"
      style={{ borderColor: "var(--border-soft)" }}
    >
      <span className="min-w-0 truncate text-[13px]">
        <Link
          href={`/members/${m.bioguideId}`}
          className="transition hover:text-[var(--accent-amber-bright)]"
          style={{
            color: isLead ? "var(--accent-amber)" : "var(--text-primary)",
          }}
          title={isLead && m.role ? m.role : undefined}
        >
          {name}
        </Link>
        {isLead && m.role ? (
          <span
            className="ml-1.5 text-[11px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-muted)" }}
          >
            · {m.role}
          </span>
        ) : null}
      </span>
      <span
        className="text-right text-[11px] uppercase tracking-[0.5px] tabular-nums"
        style={{ color: "var(--text-muted)" }}
      >
        <span style={{ color: partyColor(m.party) }}>
          {m.party ?? "–"}
        </span>
        {m.state ? ` · ${m.state}` : ""}
      </span>
    </li>
  );
}

function ActivityCaption({
  activityType,
  activityDate,
}: {
  activityType: string | null;
  activityDate: string | null;
}) {
  const verb = activityType ?? "Activity";
  const days = activityDate ? daysSince(activityDate) : null;
  const when = days === null ? "" : days === 0 ? "today" : `${days}d ago`;
  return (
    <li
      className="px-3 pt-2 pb-0 text-[11px] uppercase tracking-[0.5px]"
      style={{ color: "var(--text-muted)" }}
    >
      <span style={{ color: "var(--text-secondary)" }}>{verb}</span>
      {when ? (
        <>
          <span> · </span>
          <span className="tabular-nums">{when}</span>
        </>
      ) : null}
    </li>
  );
}

export default async function CommitteeDetailPage({
  params,
}: {
  params: Promise<{ systemCode: string }>;
}) {
  const { systemCode } = await params;
  const code = systemCode.toLowerCase();

  const committee = await getCommitteeBySystemCode(code);
  if (!committee) {
    return (
      <div className="flex min-h-screen flex-col">
        <HeaderBar basePath="/committees" pageTitle="COMMITTEE NOT FOUND" />
        <main className="w-full flex-1 px-4 py-4">
          <GroupTabs group="members" active="committees" />
          <p
            className="mt-6 text-[13px]"
            style={{ color: "var(--text-dim)" }}
          >
            No committee with system code{" "}
            <span style={{ color: "var(--text-secondary)" }}>{systemCode}</span>
            . <Link href="/committees" style={{ color: "var(--accent-amber)" }}>
              ← Back to committees
            </Link>
          </p>
        </main>
      </div>
    );
  }

  const [parent, subcommittees, members, bills, watchedIds] =
    await Promise.all([
      committee.parentSystemCode
        ? getCommitteeBySystemCode(committee.parentSystemCode)
        : Promise.resolve(null),
      getCommitteeSubcommittees(committee.systemCode),
      getCommitteeMembers(committee.systemCode),
      getCommitteeBills(committee.systemCode, RECENT_LIMIT, RECENT_DAYS),
      getWatchedBillIds(),
    ]);
  const watchedSet = new Set(watchedIds);

  const majorityCount = members.filter(
    (m) => m.partySide === "majority",
  ).length;
  const minorityCount = members.filter(
    (m) => m.partySide === "minority",
  ).length;
  // Stable order: majority then minority, then anything else (NULL party_side
  // from the YAML — rare). Within each block, getCommitteeMembers already
  // returns rank ASC so chair/ranking floats to the top.
  const orderedMembers = [
    ...members.filter((m) => m.partySide === "majority"),
    ...members.filter((m) => m.partySide === "minority"),
    ...members.filter(
      (m) => m.partySide !== "majority" && m.partySide !== "minority",
    ),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/committees" pageTitle={committee.name} />
      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="members" active="committees" />

        <section
          className="mb-4 border p-4"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div className="mb-2 flex flex-wrap items-baseline gap-3">
            <h1
              className="text-[20px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {committee.name}
            </h1>
            <span
              className="text-[11px] uppercase tracking-[0.5px]"
              style={{ color: chamberColor(committee.chamber) }}
            >
              {chamberLabel(committee.chamber)}
            </span>
            {committee.committeeType ? (
              <span
                className="text-[12px]"
                style={{ color: "var(--text-muted)" }}
              >
                {committee.committeeType}
              </span>
            ) : null}
            {!committee.isCurrent ? (
              <span
                className="rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.5px]"
                style={{
                  borderColor: "var(--text-dim)",
                  color: "var(--text-dim)",
                }}
              >
                retired
              </span>
            ) : null}
            {committee.url ? (
              <a
                href={committee.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-[12px] uppercase tracking-[0.5px] transition"
                style={{ color: "var(--text-muted)" }}
              >
                congress.gov ↗
              </a>
            ) : null}
          </div>
          {parent ? (
            <p
              className="text-[12px]"
              style={{ color: "var(--text-muted)" }}
            >
              Subcommittee of{" "}
              <Link
                href={`/committee/${parent.systemCode}`}
                className="transition hover:text-[var(--accent-amber-bright)]"
                style={{ color: "var(--accent-amber)" }}
              >
                {parent.name}
              </Link>
            </p>
          ) : null}
          {subcommittees.length > 0 ? (
            <p
              className="mt-1 text-[12px]"
              style={{ color: "var(--text-muted)" }}
            >
              <span className="uppercase tracking-[0.5px]">
                Subcommittees ({subcommittees.length}):
              </span>{" "}
              {subcommittees.map((s, i) => (
                <span key={s.systemCode}>
                  {i > 0 ? " · " : ""}
                  <Link
                    href={`/committee/${s.systemCode}`}
                    className="transition hover:text-[var(--accent-amber-bright)]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {s.name}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
        </section>

        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-[3fr_2fr]">
          <section
            className="border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <div
              className="border-b px-3 py-2"
              style={{
                backgroundColor: "var(--bg-panel)",
                borderColor: "var(--border-strong)",
              }}
            >
              <span
                className="text-[12px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Activity by month · current Congress
              </span>
            </div>
            <div className="px-3 py-2">
              <CommitteeActivityChart systemCode={committee.systemCode} />
            </div>
          </section>

          <section
            className="border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <div
              className="border-b px-3 py-2"
              style={{
                backgroundColor: "var(--bg-panel)",
                borderColor: "var(--border-strong)",
              }}
            >
              <span
                className="text-[12px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Topic mix · non-ceremonial
              </span>
            </div>
            <CommitteeTopicDistribution systemCode={committee.systemCode} />
          </section>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_3fr]">
          <section
            className="border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <div
              className="border-b px-3 py-2"
              style={{
                backgroundColor: "var(--bg-panel)",
                borderColor: "var(--border-strong)",
              }}
            >
              <span
                className="text-[12px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Members ({members.length})
              </span>
              {members.length > 0 ? (
                <span
                  className="ml-2 text-[11px] uppercase tracking-[0.5px] tabular-nums"
                  style={{ color: "var(--text-muted)" }}
                >
                  {majorityCount} maj · {minorityCount} min
                </span>
              ) : null}
            </div>
            {members.length === 0 ? (
              <p
                className="px-3 py-3 text-[12px]"
                style={{ color: "var(--text-dim)" }}
              >
                No member roster recorded.
              </p>
            ) : (
              <ul>
                {orderedMembers.map((m) => (
                  <MemberItem key={m.bioguideId} m={m} />
                ))}
              </ul>
            )}
          </section>

          <section
            className="border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <div
              className="border-b px-3 py-2"
              style={{
                backgroundColor: "var(--bg-panel)",
                borderColor: "var(--border-strong)",
              }}
            >
              <span
                className="text-[12px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Recent activity (last {RECENT_DAYS} days)
              </span>
              {bills.length > 0 ? (
                <span
                  className="ml-2 text-[11px] uppercase tracking-[0.5px] tabular-nums"
                  style={{ color: "var(--text-muted)" }}
                >
                  {bills.length} bill{bills.length === 1 ? "" : "s"}
                  {bills.length === RECENT_LIMIT ? " (capped)" : ""}
                </span>
              ) : null}
            </div>
            {bills.length === 0 ? (
              <p
                className="px-3 py-3 text-[12px]"
                style={{ color: "var(--text-dim)" }}
              >
                No bills with committee activity in the last {RECENT_DAYS}{" "}
                days.
              </p>
            ) : (
              <ul>
                {bills.map(({ bill, activityType, activityDate }) => (
                  <li key={bill.id}>
                    <ul>
                      <ActivityCaption
                        activityType={activityType}
                        activityDate={activityDate}
                      />
                      <BillRow
                        bill={bill}
                        compact
                        onWatchlist={watchedSet.has(bill.id)}
                      />
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
