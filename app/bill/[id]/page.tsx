import Link from "next/link";
import { notFound } from "next/navigation";
import { BillLobbying } from "@/components/BillLobbying";
import { HeaderBar } from "@/components/HeaderBar";
import {
  HearingMeetingsEmbed,
  type HearingEmbedGroup,
} from "@/components/HearingMeetingsEmbed";
import { PartyTag } from "@/components/PartyTag";
import { StageIndicator } from "@/components/StageIndicator";
import { TopicTags } from "@/components/TopicTags";
import { WatchlistToggle } from "@/components/WatchlistToggle";
import { BILL_TYPE_LABELS } from "@/lib/enums";
import {
  congressGovUrl,
  formatBillId,
  formatDateLong,
  formatRelativeAgeLong,
  parseTopics,
} from "@/lib/format";
import {
  type BillCommitteeRow,
  getBillById,
  getBillCommittees,
  getBillLobbying,
  getCommitteesIndex,
  getMeetingsForBill,
  isInWatchlist,
} from "@/lib/queries";

// HO 267 Phase 1: max meetings on a single bill = 5 (p90=2, none >8). Cap at 8
// so today every bill shows in full; the "see all on /hearings" out only arms
// if a future bill blows past it.
const BILL_MEETINGS_CAP = 8;

const labelStyle: React.CSSProperties = {
  color: "var(--text-dim)",
  letterSpacing: "0.5px",
};
const valueStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[124px_1fr] gap-x-4 py-1.5 text-[13px]">
      <dt className="text-[12px] uppercase" style={labelStyle}>
        {label}
      </dt>
      <dd style={valueStyle}>{children}</dd>
    </div>
  );
}

function Divider() {
  return (
    <div
      className="my-4 border-t"
      style={{ borderColor: "var(--border-strong)" }}
    />
  );
}

// HO 145: per-committee referral row on the bill detail page. Subcommittees
// carry their parent name inline (matching the member-hub pattern) so the
// hierarchy reads without a tree UI.
function BillCommitteeItem({ row }: { row: BillCommitteeRow }) {
  const isSub = row.parentSystemCode !== null;
  const chamberLabel =
    row.chamber === "house"
      ? "HOUSE"
      : row.chamber === "senate"
        ? "SENATE"
        : "JOINT";
  return (
    <li
      className="py-1.5 text-[13px]"
      style={{ color: "var(--text-secondary)" }}
    >
      {isSub ? (
        <span
          className="mr-1.5 text-[12px]"
          style={{ color: "var(--text-dim)" }}
          aria-hidden
        >
          ↳
        </span>
      ) : null}
      <Link
        href={`/committee/${row.systemCode}`}
        className="transition hover:text-[var(--accent-amber-bright)]"
        style={{ color: "var(--text-primary)" }}
      >
        {row.name}
      </Link>
      <span
        className="ml-2 text-[11px] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        {chamberLabel}
        {isSub && row.parentName ? ` · ${row.parentName}` : ""}
      </span>
      <span
        className="ml-2 text-[12px]"
        style={{ color: "var(--text-muted)" }}
      >
        · {row.activityType} ·{" "}
        <span className="tabular-nums">
          {formatRelativeAgeLong(row.activityDate)} ago
        </span>
      </span>
    </li>
  );
}

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bill = await getBillById(id);
  if (!bill) notFound();

  const [onWatchlist, committees, meetings, committeeIndex, lobbying] =
    await Promise.all([
      isInWatchlist(bill.id),
      getBillCommittees(bill.id),
      getMeetingsForBill(bill.id),
      getCommitteesIndex(),
      getBillLobbying(bill.id),
    ]);
  // systemCode → name so each hearing row shows its committee (the meetings
  // span different committees on the bill cut, unlike the committee page).
  const committeeNames: Record<string, string> = {};
  for (const c of committeeIndex) committeeNames[c.systemCode] = c.name;
  const nowMs = Date.now();
  const shownMeetings = meetings.slice(0, BILL_MEETINGS_CAP);
  const meetingOverflow = meetings.length - shownMeetings.length;
  const meetingGroups: HearingEmbedGroup[] = [
    { key: "all", meetings: shownMeetings },
  ];
  const url = congressGovUrl(bill.congress, bill.bill_type, bill.bill_number);
  const topics = parseTopics(bill.topics);
  let formattedRaw = bill.raw_json;
  try {
    formattedRaw = JSON.stringify(JSON.parse(bill.raw_json), null, 2);
  } catch {
    // leave raw on parse failure
  }

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath={`/bill/${bill.id}`}
        detail={formatBillId(bill.bill_type, bill.bill_number)}
      />

      <main className="w-full flex-1 px-4 py-4">
        <div
          className="border p-5"
          style={{
            backgroundColor: "var(--bg-row-hover)",
            borderColor: "var(--border-strong)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-3">
                <span
                  className="text-[16px] font-medium"
                  style={{ color: "var(--accent-amber)" }}
                  title={BILL_TYPE_LABELS[bill.bill_type]}
                >
                  {formatBillId(bill.bill_type, bill.bill_number)}
                </span>
                <h1
                  className="text-[15px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {bill.title}
                </h1>
              </div>
            </div>
            <WatchlistToggle billId={bill.id} initial={onWatchlist} />
          </div>

          <div className="mt-4">
            {bill.sponsor_name ? (
              <Field label="Sponsor">
                <span style={{ color: "var(--text-secondary)" }}>
                  {bill.sponsor_name}
                </span>{" "}
                <PartyTag
                  party={bill.sponsor_party}
                  state={bill.sponsor_state}
                />
              </Field>
            ) : null}
            {bill.introduced_date ? (
              <Field label="Introduced">
                {formatDateLong(bill.introduced_date)}
              </Field>
            ) : null}
            {bill.latest_action_date ? (
              <Field label="Last action">
                {formatDateLong(bill.latest_action_date)}
              </Field>
            ) : null}
            {bill.stage ? (
              <Field label="Stage">
                <StageIndicator stage={bill.stage} />
              </Field>
            ) : null}
            {topics.length > 0 ? (
              <Field label="Topics">
                <TopicTags topics={topics} />
              </Field>
            ) : null}
          </div>

          {committees.length > 0 ? (
            <>
              <Divider />
              <div
                className="mb-2 text-[12px] uppercase tracking-[0.5px]"
                style={labelStyle}
              >
                Committees ({committees.length})
              </div>
              <ul>
                {committees.map((row, i) => (
                  <BillCommitteeItem
                    key={`${row.systemCode}-${row.activityType}-${row.activityDate}-${i}`}
                    row={row}
                  />
                ))}
              </ul>
            </>
          ) : null}

          {meetings.length > 0 ? (
            <>
              <Divider />
              <div
                className="mb-2 text-[12px] uppercase tracking-[0.5px]"
                style={labelStyle}
              >
                Hearings covering this bill ({meetings.length})
              </div>
              <div
                className="border"
                style={{ borderColor: "var(--border-strong)" }}
              >
                <HearingMeetingsEmbed
                  groups={meetingGroups}
                  committeeNames={committeeNames}
                  nowMs={nowMs}
                  hideBills
                />
                {meetingOverflow > 0 ? (
                  <div className="hearings-embed-foot">
                    {meetingOverflow} more ·{" "}
                    <Link href="/hearings" className="hearings-embed-link">
                      see all on /hearings →
                    </Link>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {lobbying ? (
            <>
              <Divider />
              <div
                className="mb-2 text-[12px] uppercase tracking-[0.5px]"
                style={labelStyle}
              >
                Lobbying ({lobbying.distinctFilings.toLocaleString()} filings)
              </div>
              <BillLobbying drill={lobbying} />
            </>
          ) : null}

          {bill.summary ? (
            <>
              <Divider />
              <div
                className="mb-2 text-[12px] uppercase tracking-[0.5px]"
                style={labelStyle}
              >
                Summary
              </div>
              <p
                className="max-w-[80ch] text-[14px] leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {bill.summary}
              </p>
            </>
          ) : null}

          {bill.latest_action_text ? (
            <>
              <Divider />
              <div
                className="mb-2 text-[12px] uppercase tracking-[0.5px]"
                style={labelStyle}
              >
                Latest action
              </div>
              <p
                className="max-w-[80ch] text-[14px] leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                {bill.latest_action_text}
              </p>
            </>
          ) : null}

          <Divider />

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="border px-2.5 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
              style={{
                color: "var(--text-dim)",
                borderColor: "var(--border-strong)",
              }}
            >
              Congress.gov ↗
            </a>
            <a
              href="/bills"
              className="border px-2.5 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
              style={{
                color: "var(--text-dim)",
                borderColor: "var(--border-strong)",
              }}
            >
              ← Back to feed
            </a>
          </div>

          <details
            className="mt-4 border"
            style={{
              backgroundColor: "var(--bg-base)",
              borderColor: "var(--border-strong)",
            }}
          >
            <summary
              className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              ▾ Raw JSON
            </summary>
            <pre
              className="overflow-auto border-t px-3 py-2 text-[12px] leading-snug"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--text-muted)",
              }}
            >
              {formattedRaw}
            </pre>
          </details>

          {bill.summary_model ? (
            <p
              className="mt-3 text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              Summary by {bill.summary_model}
              {bill.summary_updated_at
                ? ` · ${formatDateLong(bill.summary_updated_at)}`
                : null}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
