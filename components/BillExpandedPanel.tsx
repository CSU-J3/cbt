"use client";

// HO 191 — expanded panel redesign. Layout is now:
//   (row header lives in BillRow, above) →
//   full-width STAGE PIPELINE (6 stages, reached/current/unreached) →
//   two columns: LEFT summary + related news, RIGHT metadata (no STAGE row)
//                + action buttons.
// The HO 188 enrichment content (sponsor link, cosponsor count, committee
// links, news) is preserved — rearranged, with the old thin timeline strip
// replaced by the pipeline.
//
// `compact` (dashboard ACTIVITY expand): pipeline + summary only. No right
// column, no news — and since neither committees nor news render, the panel
// skips the /api/bill/[id]/panel fetch entirely (0 queries). Full /bills
// stays at 2 (committees + news). One component, one prop, no fork.
import { useEffect, useState } from "react";
import {
  congressGovUrl,
  formatDateLong,
  formatRelativeAgeLong,
} from "@/lib/format";
import { ALLOWED_STAGES, type Stage } from "@/lib/enums";
import { SponsorHoverName } from "@/components/SponsorHoverName";
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

// Pipeline positions, left→right. Label + the matching --stage-* token so the
// dots/connectors/labels color-match the rest of the app's stage vocabulary.
// `compactLabel` is used only in the narrow dashboard-compact pipeline, where
// "OTHER CHAMBER" wraps to two lines at 9.5px; the full /bills pipeline keeps
// the full label.
const PIPELINE: {
  stage: Stage;
  label: string;
  compactLabel?: string;
  color: string;
}[] = [
  { stage: "introduced", label: "INTRO", color: "var(--stage-introduced)" },
  { stage: "committee", label: "COMMITTEE", color: "var(--stage-committee)" },
  { stage: "floor", label: "FLOOR", color: "var(--stage-floor)" },
  {
    stage: "other_chamber",
    label: "OTHER CHAMBER",
    compactLabel: "OTHER CH.",
    color: "var(--stage-other-chamber)",
  },
  { stage: "president", label: "PRESIDENT", color: "var(--stage-president)" },
  { stage: "enacted", label: "ENACTED", color: "var(--stage-enacted)" },
];

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
  compact = false,
}: {
  bill: FeedBill;
  cached: PanelData | null;
  onLoaded: (data: PanelData) => void;
  compact?: boolean;
}) {
  const [data, setData] = useState<PanelData | null>(cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Compact (dashboard) renders neither committees nor news — skip the
    // fetch entirely so the dashboard expand costs 0 queries.
    if (compact || data) return;
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
  }, [bill.id, data, onLoaded, compact]);

  const cgUrl = congressGovUrl(bill.congress, bill.bill_type, bill.bill_number);

  if (compact) {
    return (
      <div className="bill-expanded-panel bill-expanded-panel--compact">
        <StagePipeline bill={bill} compact />
        {bill.summary ? (
          <p className="bill-expanded-summary">{bill.summary}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="bill-expanded-panel">
      <StagePipeline bill={bill} />

      <div className="bill-expanded-body">
        <div className="bill-expanded-col bill-expanded-col-left">
          {bill.summary ? (
            <p className="bill-expanded-summary">{bill.summary}</p>
          ) : null}
          <NewsSection data={data} error={error} />
        </div>

        <div className="bill-expanded-col bill-expanded-col-right">
          <div className="bill-expanded-meta-grid">
            {bill.sponsor_name ? (
              <MetaRow label="SPONSOR">
                {/* HO 188: link to the member hub when the bill carries a
                    bioguide id (it's nullable for unmatched sponsors).
                    HO 192: the linked name also triggers a hover card
                    (photo + name + party-state). The card rides with the
                    member link — unmatched sponsors (plain text, no photo)
                    get no card. */}
                {bill.sponsor_bioguide_id ? (
                  <SponsorHoverName bill={bill} label={bill.sponsor_name} />
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
                stored; the count links nowhere — congress.gov chip has it. */}
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

            <CommitteeRows data={data} />

            {bill.introduced_date ? (
              <MetaRow label="INTRODUCED">
                <span className="tabular-nums">
                  {formatDateLong(bill.introduced_date)}
                </span>
              </MetaRow>
            ) : null}

            {/* STAGE row removed (HO 191) — the pipeline owns bill position. */}

            {bill.latest_action_date || bill.latest_action_text ? (
              <div className="bill-expanded-meta-row bill-expanded-meta-row--stacked">
                <span className="bill-expanded-meta-label">LAST ACTION</span>
                <span className="bill-expanded-meta-value">
                  {bill.latest_action_date ? (
                    <span className="tabular-nums bill-expanded-meta-sub">
                      {formatDateLong(bill.latest_action_date)} ·{" "}
                    </span>
                  ) : null}
                  <span>{bill.latest_action_text ?? "—"}</span>
                </span>
              </div>
            ) : null}
          </div>

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
              className="bill-expanded-action-chip bill-expanded-action-chip--soft"
              onClick={(e) => e.stopPropagation()}
            >
              congress.gov ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// HO 191 — full-width stage pipeline. Reached stages fill in the stage color,
// the current stage gets a larger bright marker + bold label, unreached stages
// show a dim hollow dot. Connectors are colored up to the current stage, then
// --border-strong. Dates appear under a stage only when one is actually stored:
// INTRO from introduced_date, the current stage from stage_changed_at (only
// ~4% of bills carry it — HO 188). Intermediate reached stages show label only.
//
// Suppressed entirely when stage is NULL (unsummarized) or off-path (`other`):
// an all-unreached strip on an unclassified bill would falsely read as
// "reached nothing." indexOf returns -1 for both, so we bail.
function StagePipeline({
  bill,
  compact = false,
}: {
  bill: FeedBill;
  compact?: boolean;
}) {
  const currentIdx = bill.stage
    ? ALLOWED_STAGES.indexOf(bill.stage as Stage)
    : -1;
  if (currentIdx < 0) return null;

  return (
    <ol className="stage-pipeline" aria-label="Bill stage">
      {PIPELINE.map((p, i) => {
        const reached = i <= currentIdx;
        const current = i === currentIdx;
        const date =
          i === 0
            ? (bill.introduced_date ?? null)
            : current
              ? (bill.stage_changed_at ?? null)
              : null;

        // Connector half-segments meet at each dot's center. A half is
        // colored when the line through it has been reached.
        const leftColored = i > 0 && i <= currentIdx;
        const rightColored = i < currentIdx;

        const nodeClass = [
          "stage-pipeline-node",
          reached ? "is-reached" : "is-unreached",
          current ? "is-current" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <li
            key={p.stage}
            className={nodeClass}
            style={
              {
                "--node-color": p.color,
                "--conn-left": leftColored ? p.color : "var(--border-strong)",
                "--conn-right": rightColored ? p.color : "var(--border-strong)",
              } as React.CSSProperties
            }
          >
            <span className="stage-pipeline-dot" aria-hidden />
            <span className="stage-pipeline-label">
              {compact ? (p.compactLabel ?? p.label) : p.label}
            </span>
            <span className="stage-pipeline-date tabular-nums">
              {date ? formatDateLong(date) : " "}
            </span>
          </li>
        );
      })}
    </ol>
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
    return <p className="bill-expanded-news-empty">Loading related news…</p>;
  }
  // HO 191 follow-up: state the absence rather than hiding the section. Full
  // /bills panel only — the compact dashboard variant never renders this.
  if (data.news.length === 0) {
    return (
      <div className="bill-expanded-news">
        <div className="bill-expanded-news-label">Related news</div>
        <p className="bill-expanded-news-empty">No related news</p>
      </div>
    );
  }
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
