import Link from "next/link";
import { ExpandedPanel } from "@/components/ExpandedPanel";
import { PartyTag } from "@/components/PartyTag";
import { StageIndicator } from "@/components/StageIndicator";
import { TopicTags } from "@/components/TopicTags";
import { BILL_TYPE_LABELS } from "@/lib/enums";
import {
  daysSince,
  formatBillId,
  formatDateShort,
  parseTopics,
} from "@/lib/format";
import type { FeedBill } from "@/lib/queries";

type DaysSinceMode = "staleness" | "desk-time";

function daysSinceColor(days: number, mode: DaysSinceMode): string {
  if (mode === "desk-time") {
    if (days >= 10) return "var(--party-republican)";
    if (days >= 5) return "var(--accent-amber)";
    return "var(--text-secondary)";
  }
  if (days >= 365) return "var(--party-republican)";
  if (days >= 180) return "var(--accent-amber)";
  return "var(--text-secondary)";
}

export type BillRowFilters = {
  topics: string[];
  stage: string | undefined;
  q?: string;
  sponsor?: string;
  sort?: string;
  page?: number;
  chamber?: string;
  ceremonial?: boolean;
  cluster?: string;
};

function shortSponsor(name: string | null): string {
  if (!name) return "";
  // "Rep. Barr, Andy [R-KY-6]" → "Barr"
  const noPrefix = name.replace(/^(Rep\.|Sen\.|Del\.|Res\.)\s*/i, "").trim();
  const lastName = noPrefix.split(",")[0]?.trim();
  return lastName ?? noPrefix;
}

export function BillRow({
  bill,
  filters,
  basePath = "/feed",
  expandedId,
  onWatchlist,
  introducedDate,
  daysSinceMode,
  showStageTransition = false,
}: {
  bill: FeedBill;
  filters: BillRowFilters;
  basePath?: string;
  expandedId: string | undefined;
  onWatchlist: boolean;
  introducedDate: string | null;
  daysSinceMode?: DaysSinceMode;
  showStageTransition?: boolean;
}) {
  const isExpanded = expandedId === bill.id;
  const topics = parseTopics(bill.topics);

  const params = new URLSearchParams();
  if (filters.topics.length > 0) params.set("topics", filters.topics.join(","));
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.q) params.set("q", filters.q);
  if (filters.sponsor) params.set("sponsor", filters.sponsor);
  if (filters.sort && filters.sort !== "action")
    params.set("sort", filters.sort);
  if (filters.chamber) params.set("chamber", filters.chamber);
  if (filters.ceremonial) params.set("ceremonial", "1");
  if (filters.cluster) params.set("cluster", filters.cluster);
  if (filters.page && filters.page > 1)
    params.set("page", String(filters.page));
  if (!isExpanded) params.set("expanded", bill.id);
  const qs = params.toString();
  const href = qs ? `${basePath}?${qs}` : basePath;

  return (
    <li>
      <Link
        href={href}
        replace
        scroll={false}
        prefetch={false}
        className={`feed-row ${isExpanded ? "is-expanded" : ""}`}
      >
        <span
          aria-hidden
          style={{
            color: isExpanded
              ? "var(--accent-amber)"
              : "var(--text-dim)",
          }}
        >
          {isExpanded ? "▾" : "▸"}
        </span>
        <span
          className="text-[16px] font-medium"
          style={{ color: "var(--accent-amber)" }}
          title={BILL_TYPE_LABELS[bill.bill_type]}
        >
          {formatBillId(bill.bill_type, bill.bill_number)}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span
            className="truncate text-[16px]"
            style={{ color: "var(--text-primary)" }}
          >
            {bill.title}
          </span>
          {bill.sponsor_name ? (
            <span className="flex min-w-0 items-baseline text-[14px]">
              <span
                className="truncate"
                style={{ color: "var(--text-muted)" }}
              >
                {shortSponsor(bill.sponsor_name)}
              </span>
              {bill.sponsor_party || bill.sponsor_state ? (
                <span className="ml-1.5 shrink-0">
                  <PartyTag
                    party={bill.sponsor_party}
                    state={bill.sponsor_state}
                  />
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span>
          {showStageTransition && bill.previous_stage ? (
            <span className="inline-flex items-center gap-1.5">
              <StageIndicator stage={bill.previous_stage} responsive muted />
              <span aria-hidden style={{ color: "var(--text-dim)" }}>
                →
              </span>
              <StageIndicator stage={bill.stage} responsive />
            </span>
          ) : (
            <StageIndicator stage={bill.stage} responsive />
          )}
        </span>
        {showStageTransition ? (
          <span
            className="col-date text-right text-[15px] tabular-nums"
            style={{ color: "var(--text-secondary)" }}
          >
            {bill.stage_changed_at
              ? `${daysSince(bill.stage_changed_at)}d ago`
              : "—"}
          </span>
        ) : daysSinceMode ? (
          <span
            className="col-date text-right text-[15px] tabular-nums"
            style={{
              color: daysSinceColor(
                daysSince(bill.latest_action_date),
                daysSinceMode,
              ),
            }}
          >
            {bill.latest_action_date
              ? `${daysSince(bill.latest_action_date)}d`
              : "—"}
          </span>
        ) : (
          <span
            className="col-date text-[15px]"
            style={{ color: "var(--text-dim)" }}
          >
            {formatDateShort(bill.latest_action_date)}
          </span>
        )}
        <span>
          <TopicTags topics={topics} responsive />
        </span>
      </Link>
      {isExpanded ? (
        <ExpandedPanel
          bill={bill}
          onWatchlist={onWatchlist}
          introducedDate={introducedDate}
        />
      ) : null}
    </li>
  );
}
