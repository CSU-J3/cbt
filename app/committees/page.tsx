// /committees index (handoff 144). Flat list of every current committee
// (top-level + subcommittees), filterable by chamber and sortable by recent
// activity / name / member count. Subcommittees show as their own rows; see
// HO 144 notes for the rationale.
import Link from "next/link";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import {
  type CommitteeChamber,
  type CommitteeIndexRow,
  type CommitteeIndexSort,
  getCommitteesIndex,
  sanitizeCommitteeChamber,
  sanitizeCommitteeSort,
} from "@/lib/queries";

type SearchParams = {
  chamber?: string;
  sort?: string;
};

const CHAMBER_FILTERS: ReadonlyArray<{
  value: CommitteeChamber | "";
  label: string;
}> = [
  { value: "", label: "ALL" },
  { value: "house", label: "HOUSE" },
  { value: "senate", label: "SENATE" },
  { value: "joint", label: "JOINT" },
];

const SORT_OPTIONS: ReadonlyArray<{
  value: CommitteeIndexSort;
  label: string;
}> = [
  { value: "activity", label: "ACTIVITY (30D)" },
  { value: "name", label: "NAME" },
  { value: "members", label: "MEMBERS" },
];

function chamberColor(chamber: CommitteeChamber): string {
  if (chamber === "house") return "var(--party-democrat)";
  if (chamber === "senate") return "var(--party-republican)";
  return "var(--accent-amber)";
}

function chamberLabel(chamber: CommitteeChamber): string {
  if (chamber === "house") return "HOUSE";
  if (chamber === "senate") return "SENATE";
  return "JOINT";
}

function sortSubtitle(sort: CommitteeIndexSort): string {
  if (sort === "name") return "sorted alphabetically";
  if (sort === "members") return "sorted by member count";
  return "sorted by recent activity";
}

function buildQs(
  params: Partial<SearchParams>,
  defaults: { sort: CommitteeIndexSort },
): string {
  const sp = new URLSearchParams();
  if (params.chamber) sp.set("chamber", params.chamber);
  if (params.sort && params.sort !== defaults.sort)
    sp.set("sort", params.sort);
  const qs = sp.toString();
  return qs ? `/committees?${qs}` : "/committees";
}

function ChamberFilter({
  current,
  sort,
}: {
  current: CommitteeChamber | undefined;
  sort: CommitteeIndexSort;
}) {
  return (
    <div
      className="inline-flex items-center overflow-hidden rounded-sm border"
      style={{ borderColor: "var(--border-strong)" }}
      role="group"
      aria-label="Chamber filter"
    >
      {CHAMBER_FILTERS.map(({ value, label }, i) => {
        const isActive = (current ?? "") === value;
        const href = buildQs(
          { chamber: value || undefined, sort },
          { sort: "activity" },
        );
        return (
          <Link
            key={value || "all"}
            href={href}
            scroll={false}
            className="px-2 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition"
            style={{
              backgroundColor: isActive
                ? "var(--bg-row-hover)"
                : "var(--bg-base)",
              color: isActive
                ? "var(--accent-amber-bright)"
                : "var(--text-muted)",
              borderLeft:
                i === 0 ? undefined : "0.5px solid var(--border-strong)",
            }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function SortFilter({
  current,
  chamber,
}: {
  current: CommitteeIndexSort;
  chamber: CommitteeChamber | undefined;
}) {
  return (
    <div
      className="inline-flex items-center overflow-hidden rounded-sm border"
      style={{ borderColor: "var(--border-strong)" }}
      role="group"
      aria-label="Sort"
    >
      {SORT_OPTIONS.map(({ value, label }, i) => {
        const isActive = current === value;
        const href = buildQs(
          { chamber, sort: value },
          { sort: "activity" },
        );
        return (
          <Link
            key={value}
            href={href}
            scroll={false}
            className="px-2 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition"
            style={{
              backgroundColor: isActive
                ? "var(--bg-row-hover)"
                : "var(--bg-base)",
              color: isActive
                ? "var(--accent-amber-bright)"
                : "var(--text-muted)",
              borderLeft:
                i === 0 ? undefined : "0.5px solid var(--border-strong)",
            }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

// Six-column grid: name | chamber | type | recent | members | sub-tag.
// Column widths chosen to match the dense /races row idiom without
// introducing a new globals.css class — this is the only consumer.
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_72px_180px_88px_88px_60px] items-center gap-3 px-3 py-2";

function CommitteeRow({ row }: { row: CommitteeIndexRow }) {
  const isSub = row.parentSystemCode !== null;
  return (
    <Link
      href={`/committee/${row.systemCode}`}
      className={`${ROW_GRID} border-b transition`}
      style={{
        borderColor: "var(--border-soft)",
        textDecoration: "none",
        backgroundColor: "var(--bg-base)",
      }}
    >
      <span
        className="truncate text-[14px]"
        style={{ color: "var(--text-primary)" }}
        title={row.name}
      >
        {row.name}
      </span>
      <span
        className="text-[11px] uppercase tracking-[0.5px]"
        style={{ color: chamberColor(row.chamber) }}
      >
        {chamberLabel(row.chamber)}
      </span>
      <span
        className="truncate text-[12px]"
        style={{ color: "var(--text-muted)" }}
      >
        {row.committeeType ?? "—"}
      </span>
      <span
        className="text-right text-[13px] tabular-nums"
        style={{
          color:
            row.recentBillCount > 0
              ? "var(--text-secondary)"
              : "var(--text-dim)",
        }}
        title="distinct bills with activity in the last 30 days"
      >
        {row.recentBillCount > 0
          ? row.recentBillCount.toLocaleString()
          : "—"}
      </span>
      <span
        className="text-right text-[13px] tabular-nums"
        style={{
          color:
            row.memberCount > 0
              ? "var(--text-secondary)"
              : "var(--text-dim)",
        }}
      >
        {row.memberCount > 0 ? row.memberCount.toLocaleString() : "—"}
      </span>
      <span
        className="text-right text-[11px] uppercase tracking-[0.5px]"
        style={{ color: isSub ? "var(--text-muted)" : "transparent" }}
        title={isSub ? "subcommittee" : undefined}
      >
        {isSub ? "↳ sub" : ""}
      </span>
    </Link>
  );
}

export default async function CommitteesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const chamber = sanitizeCommitteeChamber(params.chamber);
  const sort = sanitizeCommitteeSort(params.sort);

  const rows = await getCommitteesIndex({ chamber, sort });

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath="/committees"
        pageTitle="COMMITTEES"
        pageCount={rows.length}
        pageCountLabel="committees"
      />
      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="members" active="committees" />

        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Committees
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {rows.length.toLocaleString()} committees · {sortSubtitle(sort)}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-3">
            <ChamberFilter current={chamber} sort={sort} />
            <SortFilter current={sort} chamber={chamber} />
          </span>
        </div>

        <p
          className="mb-4 text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          Standing, select, and joint committees of the 119th Congress, plus
          their subcommittees. Activity counts distinct bills with any
          committee action in the last 30 days. Click a row for members and
          recent bills.
        </p>

        <div className="border" style={{ borderColor: "var(--border-strong)" }}>
          <div
            className={`${ROW_GRID} border-b`}
            style={{
              borderColor: "var(--border-strong)",
              backgroundColor: "var(--bg-panel)",
            }}
          >
            <span
              className="text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              Committee
            </span>
            <span
              className="text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              Chamber
            </span>
            <span
              className="text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              Type
            </span>
            <span
              className="text-right text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              30d
            </span>
            <span
              className="text-right text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              Members
            </span>
            <span />
          </div>
          {rows.length === 0 ? (
            <div
              className="px-4 py-12 text-center text-[13px]"
              style={{ color: "var(--text-dim)" }}
            >
              No committees match this filter.
            </div>
          ) : (
            rows.map((row) => (
              <CommitteeRow key={row.systemCode} row={row} />
            ))
          )}
        </div>
      </main>
    </div>
  );
}
