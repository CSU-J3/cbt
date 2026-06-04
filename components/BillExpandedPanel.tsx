"use client";

// HO 148 — expanded panel rendered below a BillRow when the row is the
// single-open row in BillRowList. Summary + meta grid render instantly
// from FeedBill (already on the feed query); committees + news lazy-load
// on first open via /api/bill/[id]/panel. Result is cached one level up
// in BillRowList, so re-expanding the same row is free.
import { useEffect, useState } from "react";
import { Tooltip } from "@/components/Tooltip";
import {
  congressGovUrl,
  formatDateLong,
  formatRelativeAgeLong,
} from "@/lib/format";
import { STAGE_LABELS } from "@/lib/enums";
import type { FeedBill } from "@/lib/queries";

export type PanelCommittee = {
  systemCode: string;
  name: string;
  chamber: "house" | "senate" | "joint";
  parentName: string | null;
  activityType: string;
  activityDate: string;
};

export type PanelNews = {
  id: number;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
};

export type PanelData = {
  committees: PanelCommittee[];
  news: PanelNews[];
};

function shortStageLabel(stage: string): string {
  const map: Record<string, string> = {
    introduced: "INTRO",
    committee: "COMMITTEE",
    floor: "FLOOR",
    other_chamber: "OTHER CHAMBER",
    president: "PRESIDENT",
    enacted: "ENACTED",
  };
  return map[stage] ?? stage.toUpperCase();
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bill-expanded-meta-row">
      <span className="bill-expanded-meta-label">{label}</span>
      <span className="bill-expanded-meta-value">{children}</span>
    </div>
  );
}

export function BillExpandedPanel({
  bill,
  cached,
  onLoaded,
}: {
  bill: FeedBill;
  cached: PanelData | null;
  onLoaded: (data: PanelData) => void;
}) {
  const [data, setData] = useState<PanelData | null>(cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    fetch(`/api/bill/${encodeURIComponent(bill.id)}/panel`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PanelData>;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        onLoaded(json);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [bill.id, data, onLoaded]);

  const cgUrl = congressGovUrl(bill.congress, bill.bill_type, bill.bill_number);

  // Cosponsor count comes off bill.raw_json via bills.cosponsor_count — but
  // FeedBill omits that column today. Until the feed query carries it,
  // omit the row rather than fake it. (Tracked as part of the future
  // cosponsor-detail handoff.)

  return (
    <div className="bill-expanded-panel">
      {bill.summary ? (
        <p className="bill-expanded-summary">{bill.summary}</p>
      ) : null}

      <div className="bill-expanded-meta-grid">
        {bill.sponsor_name ? (
          <MetaRow label="SPONSOR">
            {/* HO 188: link to the member hub when the bill carries a
                bioguide id (it's nullable for unmatched sponsors). */}
            {bill.sponsor_bioguide_id ? (
              <a
                href={`/members/${bill.sponsor_bioguide_id}`}
                className="bill-expanded-link"
                onClick={(e) => e.stopPropagation()}
              >
                {bill.sponsor_name}
              </a>
            ) : (
              <span>{bill.sponsor_name}</span>
            )}
            {bill.sponsor_party || bill.sponsor_state ? (
              <span className="bill-expanded-meta-sub">
                {" "}
                ·{" "}
                {[bill.sponsor_party, bill.sponsor_state]
                  .filter(Boolean)
                  .join("-")}
              </span>
            ) : null}
          </MetaRow>
        ) : null}

        {/* HO 188: cosponsor count (bills.cosponsor_count). The list isn't
            stored; the count links nowhere — congress.gov chip below has it. */}
        {typeof bill.cosponsor_count === "number" ? (
          <MetaRow label="COSPONSORS">
            <span className="tabular-nums">
              {bill.cosponsor_count.toLocaleString()}
            </span>
            <span className="bill-expanded-meta-sub">
              {" "}
              cosponsor{bill.cosponsor_count === 1 ? "" : "s"}
            </span>
          </MetaRow>
        ) : null}

        {bill.stage ? (
          <MetaRow label="STAGE">
            <Tooltip
              variant="term"
              ariaLabel={`${shortStageLabel(bill.stage)} — ${
                STAGE_LABELS[bill.stage as keyof typeof STAGE_LABELS] ?? ""
              }`}
              content={{
                kind: "text",
                label: shortStageLabel(bill.stage),
                body:
                  STAGE_LABELS[bill.stage as keyof typeof STAGE_LABELS] ??
                  bill.stage,
              }}
            >
              <span>{shortStageLabel(bill.stage)}</span>
            </Tooltip>
          </MetaRow>
        ) : null}

        {bill.introduced_date ? (
          <MetaRow label="INTRODUCED">
            <span className="tabular-nums">
              {formatDateLong(bill.introduced_date)}
            </span>
          </MetaRow>
        ) : null}

        {bill.latest_action_date || bill.latest_action_text ? (
          <MetaRow label="LAST ACTION">
            {bill.latest_action_date ? (
              <span className="tabular-nums bill-expanded-meta-sub">
                {formatDateLong(bill.latest_action_date)} ·{" "}
              </span>
            ) : null}
            <span>{bill.latest_action_text ?? "—"}</span>
          </MetaRow>
        ) : null}

        <CommitteeRows data={data} />
      </div>

      <MilestoneStrip bill={bill} />

      <NewsSection data={data} error={error} />

      <div className="bill-expanded-actions">
        <a
          href={`/bill/${bill.id}`}
          className="bill-expanded-action-chip"
          onClick={(e) => e.stopPropagation()}
        >
          full bill page →
        </a>
        <a
          href={cgUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bill-expanded-action-chip"
          onClick={(e) => e.stopPropagation()}
        >
          congress.gov ↗
        </a>
      </div>
    </div>
  );
}

// HO 188: thin milestone strip from fields already on FeedBill (0 new
// queries): Introduced → the most recent stage change → Last action. Not the
// full action history (that needs a /actions sync — deferred); votes could be
// added later as a +1-query milestone if this reads well.
function MilestoneStrip({ bill }: { bill: FeedBill }) {
  const items: { key: string; label: string; date: string | null; detail?: string }[] =
    [];
  if (bill.introduced_date) {
    items.push({ key: "intro", label: "Introduced", date: bill.introduced_date });
  }
  // Skip when stage is still "introduced" — the Introduced milestone above
  // already covers it (avoids a redundant "Reached intro" line).
  if (bill.stage && bill.stage !== "introduced" && bill.stage_changed_at) {
    items.push({
      key: "stage",
      label: `Reached ${shortStageLabel(bill.stage).toLowerCase()}`,
      date: bill.stage_changed_at,
    });
  }
  if (bill.latest_action_date || bill.latest_action_text) {
    items.push({
      key: "last",
      label: "Last action",
      date: bill.latest_action_date,
      detail: bill.latest_action_text ?? undefined,
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="bill-expanded-timeline">
      <div className="bill-expanded-timeline-label">Timeline</div>
      <ol className="bill-expanded-timeline-list">
        {items.map((it) => (
          <li key={it.key} className="bill-expanded-timeline-item">
            <span className="bill-expanded-timeline-marker" aria-hidden>
              ▸
            </span>{" "}
            <span className="bill-expanded-timeline-name">{it.label}</span>
            {it.date ? (
              <>
                <span className="bill-expanded-meta-sub"> · </span>
                <span className="bill-expanded-timeline-date tabular-nums">
                  {formatDateLong(it.date)}
                </span>
              </>
            ) : null}
            {it.detail ? (
              <>
                <span className="bill-expanded-meta-sub"> · </span>
                <span className="bill-expanded-timeline-detail">
                  {it.detail}
                </span>
              </>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CommitteeRows({ data }: { data: PanelData | null }) {
  if (!data) {
    return (
      <MetaRow label="COMMITTEE">
        <span className="bill-expanded-meta-sub">loading…</span>
      </MetaRow>
    );
  }
  if (data.committees.length === 0) return null;
  // Dedupe by systemCode so a referred-then-reported pair on the same
  // committee renders once. The newest activity wins (rows arrive
  // activity_date DESC from the helper).
  const seen = new Set<string>();
  const unique = data.committees.filter((c) => {
    if (seen.has(c.systemCode)) return false;
    seen.add(c.systemCode);
    return true;
  });
  return (
    <MetaRow label="COMMITTEE">
      <span className="bill-expanded-committee-list">
        {unique.map((c, i) => (
          <span key={c.systemCode}>
            {i > 0 ? <span className="bill-expanded-meta-sub"> · </span> : null}
            <a
              href={`/committee/${c.systemCode}`}
              className="bill-expanded-committee-link"
              onClick={(e) => e.stopPropagation()}
              title={
                c.parentName
                  ? `Subcommittee of ${c.parentName}`
                  : `${c.chamber} committee`
              }
            >
              {c.name}
            </a>
            <span className="bill-expanded-meta-sub">
              {" "}
              · {c.activityType} · {formatRelativeAgeLong(c.activityDate)}
            </span>
          </span>
        ))}
      </span>
    </MetaRow>
  );
}

function NewsSection({
  data,
  error,
}: {
  data: PanelData | null;
  error: string | null;
}) {
  if (error) {
    return (
      <p className="bill-expanded-news-empty">
        Could not load related news ({error}).
      </p>
    );
  }
  if (!data) {
    return (
      <p className="bill-expanded-news-empty">Loading related news…</p>
    );
  }
  if (data.news.length === 0) return null;
  return (
    <div className="bill-expanded-news">
      <div className="bill-expanded-news-label">
        Related news ({data.news.length})
      </div>
      <ul className="bill-expanded-news-list">
        {data.news.map((n) => (
          <li key={n.id} className="bill-expanded-news-row">
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bill-expanded-news-headline"
              onClick={(e) => e.stopPropagation()}
            >
              {n.title}
            </a>
            <span className="bill-expanded-news-meta tabular-nums">
              {n.source} · {formatRelativeAgeLong(n.publishedAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
