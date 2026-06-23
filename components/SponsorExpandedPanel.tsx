import Link from "next/link";
import { CaucusBadge } from "@/components/CaucusBadge";
import { PalestineBadge } from "@/components/PalestineBadge";
import { SponsorPhoto } from "@/components/SponsorPhoto";
import { BILL_TYPE_LABELS, STAGE_LABELS } from "@/lib/enums";
import { formatBillId, formatDateShort } from "@/lib/format";
import { isPalestineGrade } from "@/lib/palestine-config";
import {
  type Chamber,
  type FeedBill,
  type MemberAffiliation,
  type MemberCommitteeRow,
  normalizePartyVariant,
  type SponsorStats,
  type SponsorTopic,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

// HO 198: 3-column member card (matches the HO 191 bill-panel idiom) —
// left rail (photo + identity + stats + stages + topics + caucuses + buttons),
// middle (recent bills, capped), right (committees, capped). Pure rearrange of
// data the panel already receives; the only new prop is `chamber` (for the
// Sen./Rep. identity prefix), already on MemberRanking. Caps are render-only
// slices — no new queries.
const RECENT_BILLS_CAP = 7;
const COMMITTEE_CAP = 8;
// HO 328: the merged /members two-pane browser passes committeeCap={Infinity}
// to uncap the COMMITTEES column (the rail is the committee index now, so the
// expanded card shows a member's full committee set). Members-only component, so
// the prop is the minimal change; defaults to the HO 198 cap of 8 everywhere else.

const STAGE_BADGES: {
  key: keyof SponsorStats;
  glyph: string;
  label: string;
  color: string;
}[] = [
  { key: "introduced", glyph: "▸", label: "INTRO", color: "var(--stage-introduced)" },
  { key: "committee", glyph: "▸", label: "COMM", color: "var(--stage-committee)" },
  { key: "floor", glyph: "▸▸", label: "FLOOR", color: "var(--stage-floor)" },
  { key: "other_chamber", glyph: "▸▸▸", label: "OCHM", color: "var(--stage-other-chamber)" },
  { key: "president", glyph: "▸▸▸▸", label: "PRES", color: "var(--stage-president)" },
  { key: "enacted", glyph: "✓", label: "ENACTED", color: "var(--stage-enacted)" },
];

function partyColorFor(party: string | null): string {
  const key = normalizePartyVariant(party);
  if (key === "R") return "var(--party-republican)";
  if (key === "D") return "var(--party-democrat)";
  if (key === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] uppercase tracking-[0.5px]"
      style={{ color: "var(--text-dim)" }}
    >
      {children}
    </span>
  );
}

export function SponsorExpandedPanel({
  sponsorKey,
  sponsorName,
  sponsorParty,
  sponsorState,
  bioguideId,
  chamber,
  stats,
  topics,
  recentBills,
  committees = [],
  affiliations = [],
  palestineGrade = null,
  palestineRank = null,
  palestineScore = null,
  includeCeremonial = false,
  committeeCap = COMMITTEE_CAP,
}: {
  sponsorKey: string;
  sponsorName: string;
  sponsorParty: string | null;
  sponsorState: string | null;
  bioguideId: string | null;
  chamber: Chamber;
  stats: SponsorStats;
  topics: SponsorTopic[];
  recentBills: FeedBill[];
  committees?: MemberCommitteeRow[];
  affiliations?: MemberAffiliation[];
  // HO 200: USCPR scorecard grade + rank + total score, threaded from the
  // MemberRanking row (same source the list badge uses). Skip-on-empty.
  palestineGrade?: string | null;
  palestineRank?: number | null;
  palestineScore?: string | null;
  includeCeremonial?: boolean;
  committeeCap?: number;
}) {
  const partyColor = partyColorFor(sponsorParty);
  const enactedPct =
    stats.total > 0 ? Math.round((stats.enacted / stats.total) * 100) : 0;
  const ceremonialSuffix = includeCeremonial ? "&ceremonial=1" : "";
  const openInFeedHref = `/bills?sponsor=${encodeURIComponent(sponsorKey)}${ceremonialSuffix}`;
  const detailHref = bioguideId ? `/members/${bioguideId}` : null;
  const prefix = chamber === "senate" ? "Sen." : "Rep.";

  const shownBills = recentBills.slice(0, RECENT_BILLS_CAP);
  const shownCommittees = committees.slice(0, committeeCap);
  const moreCommittees = committees.length - shownCommittees.length;

  return (
    <div className="sponsor-expanded-panel">
      <div className="sponsor-card-grid">
        {/* ---- LEFT RAIL ---- */}
        <div className="sponsor-card-rail">
          <SponsorPhoto
            bioguideId={bioguideId}
            name={sponsorName}
            partyColor={partyColor}
            width={96}
          />

          {/* Identity */}
          <div className="flex flex-col gap-0.5">
            <span
              className="text-[13px] font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              {prefix} {sponsorName}
            </span>
            <span className="text-[12px] tabular-nums" style={{ color: partyColor }}>
              [{sponsorParty ?? "?"}-{sponsorState ?? "?"}]
            </span>
          </div>

          {/* Stats */}
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <RailLabel>Total bills</RailLabel>
              <span
                className="text-[14px] font-medium tabular-nums"
                style={{ color: "var(--text-primary)" }}
              >
                {stats.total.toLocaleString()}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <RailLabel>Enacted</RailLabel>
              <span className="text-[14px] font-medium tabular-nums">
                <span style={{ color: "var(--stage-enacted)" }}>
                  {stats.enacted.toLocaleString()}
                </span>{" "}
                <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                  ({enactedPct}%)
                </span>
              </span>
            </div>
          </div>

          {/* Stages */}
          <div className="flex flex-col gap-1">
            <RailLabel>Stages</RailLabel>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.5px]">
              {STAGE_BADGES.filter((b) => (stats[b.key] as number) > 0).map((b) => (
                <span
                  key={b.key}
                  style={{ color: b.color }}
                  title={STAGE_LABELS[b.key as keyof typeof STAGE_LABELS]}
                >
                  {b.glyph} {b.label} {String(stats[b.key])}
                </span>
              ))}
            </div>
          </div>

          {/* Topics */}
          {topics.length > 0 ? (
            <div className="flex flex-col gap-1">
              <RailLabel>Topics</RailLabel>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-[0.5px]">
                {topics.map((t) => (
                  <Link
                    key={t.topic}
                    href={`/bills?sponsor=${encodeURIComponent(sponsorKey)}&topics=${t.topic}${ceremonialSuffix}`}
                    title={topicFullLabel(t.topic)}
                    className="inline-flex items-center gap-1 px-1.5 py-[1px]"
                    style={{
                      color: topicColor(t.topic),
                      border: `1px solid ${topicColor(t.topic)}`,
                      borderRadius: "2px",
                    }}
                  >
                    {topicLabel(t.topic)}
                    <span style={{ color: "var(--text-muted)" }}>{t.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {/* Caucuses — HO 152 feature folded into the rail under TOPICS
              (HO 198); skip-on-empty so non-affiliated members show nothing. */}
          {affiliations.length > 0 ? (
            <div className="flex flex-col gap-1">
              <RailLabel>Caucuses</RailLabel>
              <div className="flex flex-wrap gap-1.5">
                {affiliations.map((a) => (
                  <CaucusBadge key={a.org} org={a.org} />
                ))}
              </div>
            </div>
          ) : null}

          {/* USCPR scorecard — HO 200. Same source as the list badge
              (MemberRanking.palestine*); grade chip + total score + rank, with
              attribution mirrored (label + the badge's tooltip). ALWAYS shown:
              scored members get their real grade; everyone else gets an explicit
              "Not scored" (the honest gap — no fabricated/default grade), same
              idiom as the bill panel's "No related news" empty state. */}
          <div className="flex flex-col gap-1">
            <RailLabel>USCPR Scorecard</RailLabel>
            {palestineGrade && isPalestineGrade(palestineGrade) ? (
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.5px]">
                <PalestineBadge grade={palestineGrade} rank={palestineRank} />
                {palestineScore ? (
                  <span
                    className="tabular-nums"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {palestineScore}
                  </span>
                ) : null}
                {palestineRank ? (
                  <span className="tabular-nums" style={{ color: "var(--text-dim)" }}>
                    · #{palestineRank} of 47
                  </span>
                ) : null}
              </div>
            ) : (
              <span
                className="text-[11px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-dim)" }}
                title="USCPR Palestine scorecard: not scored"
              >
                Not scored
              </span>
            )}
          </div>

          {/* Buttons (stacked) */}
          <div className="mt-auto flex flex-col gap-2 pt-1">
            {detailHref ? (
              <Link
                href={detailHref}
                className="sponsor-card-btn sponsor-card-btn--amber"
              >
                View detail →
              </Link>
            ) : null}
            <Link
              href={openInFeedHref}
              className="sponsor-card-btn sponsor-card-btn--soft"
            >
              Open in feed →
            </Link>
          </div>
        </div>

        {/* ---- MIDDLE: RECENT BILLS ---- */}
        <div className="sponsor-card-mid">
          <p className="text-[11px] uppercase tracking-[0.5px]">
            <span style={{ color: "var(--text-muted)" }}>Recent bills</span>
            <span style={{ color: "var(--text-dim)" }}>
              {" "}
              · {stats.total.toLocaleString()} total
            </span>
          </p>
          {shownBills.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {shownBills.map((b) => (
                <li key={b.id} className="flex items-baseline gap-3">
                  <Link
                    href={`/bill/${b.id}`}
                    className="font-medium whitespace-nowrap tabular-nums text-[14px]"
                    style={{ color: "var(--accent-amber)" }}
                    title={BILL_TYPE_LABELS[b.bill_type]}
                  >
                    {formatBillId(b.bill_type, b.bill_number)}
                  </Link>
                  {/* pr-3 keeps the ellipsis clear of the date; the date has a
                      fixed min-width + text-right so titles truncate against a
                      consistent edge instead of crowding the date. */}
                  <span
                    className="min-w-0 flex-1 truncate pr-3 text-[14px]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {b.title}
                  </span>
                  <span
                    className="min-w-[58px] shrink-0 text-right whitespace-nowrap text-[12px] tabular-nums"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {formatDateShort(b.latest_action_date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px]" style={{ color: "var(--text-dim)" }}>
              No summarized bills yet.
            </p>
          )}
          {detailHref && recentBills.length > RECENT_BILLS_CAP ? (
            <Link
              href={detailHref}
              className="mt-1 inline-block text-[11px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              See all {stats.total.toLocaleString()} bills →
            </Link>
          ) : null}
        </div>

        {/* ---- RIGHT: COMMITTEES ---- */}
        <div className="sponsor-card-right">
          <p className="text-[11px] uppercase tracking-[0.5px]">
            <span style={{ color: "var(--text-muted)" }}>Committees</span>
            {committees.length > 0 ? (
              <span style={{ color: "var(--text-dim)" }}> · {committees.length}</span>
            ) : null}
          </p>
          {shownCommittees.length > 0 ? (
            <ul className="flex flex-col">
              {shownCommittees.map((c) => {
                const role = c.role?.toLowerCase() ?? "";
                const isSub = c.parentSystemCode !== null;
                const badge = role.includes("ranking")
                  ? { label: "RANKING", color: "var(--text-muted)" }
                  : role.includes("chair")
                    ? { label: "CHAIR", color: "var(--accent-amber)" }
                    : null;
                return (
                  <li key={c.systemCode} className="flex items-baseline gap-1.5 py-1">
                    {isSub ? (
                      <span
                        aria-hidden
                        className="text-[12px]"
                        style={{ color: "var(--text-dim)" }}
                      >
                        ↳
                      </span>
                    ) : null}
                    <Link
                      href={`/committee/${c.systemCode}`}
                      className="min-w-0 flex-1 truncate text-[13px] transition hover:text-[var(--accent-amber-bright)]"
                      style={{ color: "var(--text-primary)" }}
                      title={c.role ?? c.name}
                    >
                      {c.name}
                    </Link>
                    {badge ? (
                      <span
                        className="shrink-0 px-1.5 py-[1px] text-[10px] uppercase tracking-[0.5px]"
                        style={{
                          color: badge.color,
                          border: `1px solid ${badge.color}`,
                          borderRadius: "2px",
                        }}
                        title={c.role ?? undefined}
                      >
                        {badge.label}
                      </span>
                    ) : (
                      <span
                        className="shrink-0 text-[10px] uppercase tracking-[0.5px]"
                        style={{ color: "var(--text-dim)" }}
                      >
                        {c.chamber === "house"
                          ? "HOUSE"
                          : c.chamber === "senate"
                            ? "SENATE"
                            : "JOINT"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[12px]" style={{ color: "var(--text-dim)" }}>
              No committee assignments on file.
            </p>
          )}
          {moreCommittees > 0 ? (
            <span
              className="mt-1 inline-block text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              +{moreCommittees} more subcommittee{moreCommittees === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
