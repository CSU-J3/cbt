import Link from "next/link";
import { CaucusBadge } from "@/components/CaucusBadge";
import { SponsorPhoto } from "@/components/SponsorPhoto";
import { StateFlag } from "@/components/StateFlag";
import { BILL_TYPE_LABELS, STAGE_LABELS } from "@/lib/enums";
import { formatBillId, formatDateShort } from "@/lib/format";
import {
  type FeedBill,
  type MemberAffiliation,
  type MemberCommitteeRow,
  normalizePartyVariant,
  type SponsorStats,
  type SponsorTopic,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

const STAGE_BADGES: { key: keyof SponsorStats; glyph: string; label: string; color: string }[] = [
  { key: "introduced", glyph: "▸", label: "INTRO", color: "var(--stage-introduced)" },
  { key: "committee", glyph: "▸", label: "COMMITTEE", color: "var(--stage-committee)" },
  { key: "floor", glyph: "▸▸", label: "FLOOR", color: "var(--stage-floor)" },
  { key: "other_chamber", glyph: "▸▸▸", label: "OTHER CHAMBER", color: "var(--stage-other-chamber)" },
  { key: "president", glyph: "▸▸▸▸", label: "PRESIDENT", color: "var(--stage-president)" },
  { key: "enacted", glyph: "✓", label: "ENACTED", color: "var(--stage-enacted)" },
];

function partyColorFor(party: string | null): string {
  const key = normalizePartyVariant(party);
  if (key === "R") return "var(--party-republican)";
  if (key === "D") return "var(--party-democrat)";
  if (key === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

const labelClass = "uppercase tracking-[0.5px] text-[14px]";
const labelStyle = { color: "var(--text-muted)" };
const valueClass = "font-medium tabular-nums text-[16px]";
const valueStyle = { color: "var(--text-primary)" };

export function SponsorExpandedPanel({
  sponsorKey,
  sponsorName,
  sponsorParty,
  sponsorState,
  bioguideId,
  stats,
  topics,
  recentBills,
  committees = [],
  affiliations = [],
  includeCeremonial = false,
}: {
  sponsorKey: string;
  sponsorName: string;
  sponsorParty: string | null;
  sponsorState: string | null;
  bioguideId: string | null;
  stats: SponsorStats;
  topics: SponsorTopic[];
  recentBills: FeedBill[];
  // HO 152: COMMITTEES + CAUCUS BADGES sections, both skip-on-empty so an
  // unaffiliated freshman doesn't get an empty "no caucuses on file" row.
  committees?: MemberCommitteeRow[];
  affiliations?: MemberAffiliation[];
  includeCeremonial?: boolean;
}) {
  const partyColor = partyColorFor(sponsorParty);
  const enactedPct =
    stats.total > 0 ? Math.round((stats.enacted / stats.total) * 100) : 0;
  const ceremonialSuffix = includeCeremonial ? "&ceremonial=1" : "";
  const openInFeedHref = `/feed?sponsor=${encodeURIComponent(sponsorKey)}${ceremonialSuffix}`;

  return (
    <div className="sponsor-expanded-panel">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <SponsorPhoto
            bioguideId={bioguideId}
            name={sponsorName}
            partyColor={partyColor}
          />
          {sponsorState ? (
            <div className="flex flex-col items-center gap-1 self-center">
              <StateFlag state={sponsorState} />
              <span
                className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
              >
                {sponsorState}
              </span>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <dl className="grid grid-cols-[140px_1fr] gap-x-6 gap-y-3">
            <dt className={labelClass} style={labelStyle}>
              Total bills
            </dt>
            <dd className={valueClass} style={valueStyle}>
              {stats.total.toLocaleString()}
            </dd>

            <dt className={labelClass} style={labelStyle}>
              Enacted
            </dt>
            <dd className={valueClass} style={valueStyle}>
              {stats.enacted.toLocaleString()}{" "}
              <span
                className="text-[14px]"
                style={{ color: "var(--text-muted)" }}
              >
                ({enactedPct}%)
              </span>
            </dd>

            <dt className={labelClass} style={labelStyle}>
              Stages
            </dt>
            <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] uppercase tracking-[0.5px]">
              {STAGE_BADGES.filter((b) => (stats[b.key] as number) > 0).map(
                (b, i, arr) => (
                  <span key={b.key} className="flex items-center">
                    <span
                      style={{ color: b.color }}
                      title={STAGE_LABELS[b.key as keyof typeof STAGE_LABELS]}
                    >
                      {b.glyph} {b.label} {String(stats[b.key])}
                    </span>
                    {i < arr.length - 1 ? (
                      <span
                        className="ml-2"
                        style={{ color: "var(--text-dim)" }}
                      >
                        ·
                      </span>
                    ) : null}
                  </span>
                ),
              )}
            </dd>

            {topics.length > 0 ? (
              <>
                <dt className={labelClass} style={labelStyle}>
                  Topics
                </dt>
                <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] uppercase tracking-[0.5px]">
                  {topics.map((t, i) => (
                    <span key={t.topic} className="flex items-center">
                      <Link
                        href={`/feed?sponsor=${encodeURIComponent(sponsorKey)}&topics=${t.topic}${ceremonialSuffix}`}
                        title={topicFullLabel(t.topic)}
                        style={{ color: topicColor(t.topic) }}
                      >
                        {topicLabel(t.topic)}{" "}
                        <span style={{ color: "var(--text-muted)" }}>
                          ({t.count})
                        </span>
                      </Link>
                      {i < topics.length - 1 ? (
                        <span
                          className="ml-2"
                          style={{ color: "var(--text-dim)" }}
                        >
                          ·
                        </span>
                      ) : null}
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>

          {recentBills.length > 0 ? (
            <div className="mt-5">
              <p
                className="mb-2 text-[14px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-muted)" }}
              >
                Bills ({recentBills.length})
              </p>
              <div className="max-h-80 overflow-y-auto pr-2">
                <ul className="space-y-1.5">
                  {recentBills.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-baseline gap-3"
                    >
                      <Link
                        href={`/bill/${b.id}`}
                        className="font-medium whitespace-nowrap tabular-nums text-[16px]"
                        style={{ color: "var(--accent-amber)" }}
                        title={BILL_TYPE_LABELS[b.bill_type]}
                      >
                        {formatBillId(b.bill_type, b.bill_number)}
                      </Link>
                      <span
                        className="min-w-0 flex-1 truncate text-[16px]"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {b.title}
                      </span>
                      <span
                        className="whitespace-nowrap text-[13px] tabular-nums"
                        style={{ color: "var(--text-dim)" }}
                      >
                        {formatDateShort(b.latest_action_date)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {committees.length > 0 ? (
            <div className="mt-5">
              <p
                className="mb-2 text-[14px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-muted)" }}
              >
                Committees ({committees.length})
              </p>
              <ul className="flex flex-col">
                {committees.map((c) => {
                  const role = c.role?.toLowerCase() ?? "";
                  const isSub = c.parentSystemCode !== null;
                  const badge = role.includes("ranking")
                    ? { label: "RANKING", color: "var(--text-muted)" }
                    : role.includes("chair")
                      ? { label: "CHAIR", color: "var(--accent-amber)" }
                      : null;
                  return (
                    <li
                      key={c.systemCode}
                      className="flex items-baseline gap-2 py-1"
                    >
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
                        className="text-[14px] transition hover:text-[var(--accent-amber-bright)]"
                        style={{ color: "var(--text-primary)" }}
                        title={c.role ?? undefined}
                      >
                        {c.name}
                      </Link>
                      <span
                        className="text-[11px] uppercase tracking-[0.5px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {c.chamber === "house"
                          ? "HOUSE"
                          : c.chamber === "senate"
                            ? "SENATE"
                            : "JOINT"}
                        {isSub && c.parentName ? ` · ${c.parentName}` : ""}
                      </span>
                      {badge ? (
                        <span
                          className="ml-auto inline-block px-1.5 py-[1px] text-[11px] uppercase tracking-[0.5px]"
                          style={{
                            color: badge.color,
                            border: `1px solid ${badge.color}`,
                            borderRadius: "2px",
                          }}
                          title={c.role ?? undefined}
                        >
                          {badge.label}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {affiliations.length > 0 ? (
            <div className="mt-5">
              <p
                className="mb-2 text-[14px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-muted)" }}
              >
                Caucuses ({affiliations.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {affiliations.map((a) => (
                  <CaucusBadge key={a.org} org={a.org} />
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            {bioguideId ? (
              <Link
                href={`/members/${bioguideId}`}
                className="inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
                style={{ color: "var(--accent-amber)" }}
              >
                [View detail →]
              </Link>
            ) : null}
            <Link
              href={openInFeedHref}
              className="inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              [Open in feed →]
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
