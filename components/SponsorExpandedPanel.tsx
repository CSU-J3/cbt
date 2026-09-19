import Link from "next/link";
import { CaucusBadge } from "@/components/CaucusBadge";
import { PalestineBadge } from "@/components/PalestineBadge";
import { SponsorPhoto } from "@/components/SponsorPhoto";
import { BILL_TYPE_LABELS, STAGE_LABELS } from "@/lib/enums";
import { formatBillId, formatDateShort } from "@/lib/format";
import { COMPACT_BILLS_CAP, COMPACT_COMMITTEE_CAP } from "@/lib/member-card-caps";
import { isPalestineGrade } from "@/lib/palestine-config";
import {
  type Chamber,
  type FeedBill,
  type MemberAffiliation,
  type MemberCommitteeRow,
  type SponsorStats,
  type SponsorTopic,
} from "@/lib/queries";
import { partyColor as sharedPartyColor } from "@/lib/race-colors";
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

// HO 631 — the COMPACT density's caps live in a leaf (lib/member-card-caps.ts)
// because the band's assembly site slices `recentBills` to the same number before
// the card is ever cached or serialized, and neither layer can safely import the
// other. See that file for why the committees cap is deliberately NOT applied
// upstream.

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

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[length:var(--fs-10)] uppercase tracking-[0.5px]"
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
  committeeCap,
  recentBillsCap,
  density = "full",
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
  recentBillsCap?: number;
  // HO 631 — the compact density, OPT-IN. `/members` passes nothing and takes
  // "full", which is the HO 198/328 card unchanged; the dashboard's Absence Watch
  // band passes "compact" because it opens the card as an overlay over the page
  // rather than inside a pane sized for it. An explicit opt-in is what satisfies
  // the HO 507 shared-component rule here — the full path cannot be reached by a
  // compact-only override leaking, because every compact rule is scoped to a
  // modifier class this branch does not emit.
  density?: "full" | "compact";
}) {
  const partyColor = sharedPartyColor(sponsorParty);
  const enactedPct =
    stats.total > 0 ? Math.round((stats.enacted / stats.total) * 100) : 0;
  const ceremonialSuffix = includeCeremonial ? "&ceremonial=1" : "";
  const openInFeedHref = `/bills?sponsor=${encodeURIComponent(sponsorKey)}${ceremonialSuffix}`;
  const detailHref = bioguideId ? `/members/${bioguideId}` : null;
  const prefix = chamber === "senate" ? "Sen." : "Rep.";

  const compact = density === "compact";
  // Caps default FROM the density, so a compact caller opts in once and gets both
  // ruled caps; an explicit prop still wins (that is how /members keeps its
  // committeeCap={Infinity} uncapping).
  const billsCap = recentBillsCap ?? (compact ? COMPACT_BILLS_CAP : RECENT_BILLS_CAP);
  const cmteCap = committeeCap ?? (compact ? COMPACT_COMMITTEE_CAP : COMMITTEE_CAP);

  const shownBills = recentBills.slice(0, billsCap);
  const shownCommittees = committees.slice(0, cmteCap);
  const moreCommittees = committees.length - shownCommittees.length;

  // HO 631 — THE COUNT SOURCE. The see-all used to gate on `recentBills.length`,
  // which is the length of the array this render was handed. Commit 3 slices that
  // array at the band's assembly site, so gating on it would have silently killed
  // the closer at exactly the moment it became load-bearing: a member with 24
  // bills, sliced to 10, reads `10 > 10 = false` and the "+14 more" never renders.
  //
  // `stats.total` is the count that does not move under a slice. The two are NOT
  // the same predicate — getSponsorRecentBills is `summary IS NOT NULL`-gated and
  // getSponsorStats is not — so this is a real source change, not a rename, and it
  // was measured rather than assumed: at 537 current members on 2026-08-08, ZERO
  // had total != summarized, so the gate is a no-op on /members today and the
  // panel's label (which already printed stats.total) stops disagreeing with the
  // gate that decides whether to show it.
  const moreBills = stats.total - shownBills.length;

  return (
    <div className="sponsor-expanded-panel">
      <div className={compact ? "sponsor-card-grid sponsor-card-grid--compact" : "sponsor-card-grid"}>
        {/* ---- LEFT RAIL ---- */}
        <div className="sponsor-card-rail">
          {/* Compact runs the photo INLINE with the identity block instead of
              stacked above it (the ruled mock): at 56px the photo no longer needs
              a row of its own, and the pair reclaims ~60px of card height — which
              is what the overlay is spending its budget on. */}
          {compact ? (
            <div className="sponsor-card-idline">
              <SponsorPhoto
                bioguideId={bioguideId}
                name={sponsorName}
                partyColor={partyColor}
                width={56}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span
                  className="text-[length:var(--fs-13)] font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {prefix} {sponsorName}
                </span>
                <span
                  className="text-[length:var(--fs-12)] tabular-nums"
                  style={{ color: partyColor }}
                >
                  [{sponsorParty ?? "?"}-{sponsorState ?? "?"}]
                </span>
              </div>
            </div>
          ) : (
            <>
              <SponsorPhoto
                bioguideId={bioguideId}
                name={sponsorName}
                partyColor={partyColor}
                width={96}
              />

              {/* Identity */}
              <div className="flex flex-col gap-0.5">
                <span
                  className="text-[length:var(--fs-13)] font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {prefix} {sponsorName}
                </span>
                <span
                  className="text-[length:var(--fs-12)] tabular-nums"
                  style={{ color: partyColor }}
                >
                  [{sponsorParty ?? "?"}-{sponsorState ?? "?"}]
                </span>
              </div>
            </>
          )}

          {/* Stats */}
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <RailLabel>Total bills</RailLabel>
              <span
                className="text-[length:var(--fs-14)] font-medium tabular-nums"
                style={{ color: "var(--text-primary)" }}
              >
                {stats.total.toLocaleString()}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <RailLabel>Enacted</RailLabel>
              <span className="text-[length:var(--fs-14)] font-medium tabular-nums">
                <span style={{ color: "var(--stage-enacted)" }}>
                  {stats.enacted.toLocaleString()}
                </span>{" "}
                <span className="text-[length:var(--fs-12)]" style={{ color: "var(--text-muted)" }}>
                  ({enactedPct}%)
                </span>
              </span>
            </div>
          </div>

          {/* Stages */}
          <div className="flex flex-col gap-1">
            <RailLabel>Stages</RailLabel>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-11)] uppercase tracking-[0.5px]">
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
              <div className="flex flex-wrap items-center gap-1.5 text-[length:var(--fs-11)] uppercase tracking-[0.5px]">
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
              <div className="flex items-center gap-1.5 text-[length:var(--fs-11)] uppercase tracking-[0.5px]">
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
                className="text-[length:var(--fs-11)] uppercase tracking-[0.5px]"
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
          <p className="text-[length:var(--fs-11)] uppercase tracking-[0.5px]">
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
                    className="font-medium whitespace-nowrap tabular-nums text-[length:var(--fs-14)]"
                    style={{ color: "var(--accent-amber)" }}
                    title={BILL_TYPE_LABELS[b.bill_type]}
                  >
                    {formatBillId(b.bill_type, b.bill_number)}
                  </Link>
                  {/* pr-3 keeps the ellipsis clear of the date; the date has a
                      fixed min-width + text-right so titles truncate against a
                      consistent edge instead of crowding the date. */}
                  <span
                    className="min-w-0 flex-1 truncate pr-3 text-[length:var(--fs-14)]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {b.title}
                  </span>
                  <span
                    className="min-w-[58px] shrink-0 text-right whitespace-nowrap text-[length:var(--fs-12)] tabular-nums"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {formatDateShort(b.latest_action_date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[length:var(--fs-12)]" style={{ color: "var(--text-dim)" }}>
              No summarized bills yet.
            </p>
          )}
          {detailHref && moreBills > 0 ? (
            <Link
              href={detailHref}
              className="mt-1 inline-block text-[length:var(--fs-11)] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              {/* The full branch keeps its ORIGINAL JSX child shape (three
                  children, not one interpolated string). React emits text-segment
                  markers between adjacent children, so collapsing these into a
                  template literal changes the served HTML — visually identical,
                  but no longer byte-identical, which is the gate this commit is
                  held to. The render-diff caught exactly that. */}
              {compact ? (
                `[ + ${moreBills.toLocaleString()} MORE → ]`
              ) : (
                <>See all {stats.total.toLocaleString()} bills →</>
              )}
            </Link>
          ) : null}
        </div>

        {/* ---- RIGHT: COMMITTEES ---- */}
        <div className="sponsor-card-right">
          <p className="text-[length:var(--fs-11)] uppercase tracking-[0.5px]">
            <span style={{ color: "var(--text-muted)" }}>Committees</span>
            {committees.length > 0 ? (
              <span style={{ color: "var(--text-dim)" }}> · {committees.length}</span>
            ) : null}
          </p>
          {shownCommittees.length > 0 ? (
            // Compact drops the flex column for a real BLOCK container, because
            // `column-count` is a multicol property and a flex container ignores
            // it. The li's own `break-inside: avoid` (CSS) is what stops a
            // committee row being split across the column boundary.
            <ul className={compact ? "sponsor-card-cmtes" : "flex flex-col"}>
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
                        className="text-[length:var(--fs-12)]"
                        style={{ color: "var(--text-dim)" }}
                      >
                        ↳
                      </span>
                    ) : null}
                    <Link
                      href={`/committee/${c.systemCode}`}
                      className="min-w-0 flex-1 truncate text-[length:var(--fs-13)] transition hover:text-[var(--accent-amber-bright)]"
                      style={{ color: "var(--text-primary)" }}
                      title={c.role ?? c.name}
                    >
                      {c.name}
                    </Link>
                    {badge ? (
                      <span
                        className="shrink-0 px-1.5 py-[1px] text-[length:var(--fs-10)] uppercase tracking-[0.5px]"
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
                        className="shrink-0 text-[length:var(--fs-10)] uppercase tracking-[0.5px]"
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
            <p className="text-[length:var(--fs-12)]" style={{ color: "var(--text-dim)" }}>
              No committee assignments on file.
            </p>
          )}
          {/* Compact closes BOTH columns with the same house closer, drilling to
              the member page — the full card's closer here is a dim, unlinked
              count, which is fine in a pane the reader can scroll but wrong in an
              overlay whose whole job is to hand off. Committees use the pre-cap
              array length rather than a stats field because, unlike bills, the
              roster is never sliced upstream: what arrived is the whole set. */}
          {moreCommittees > 0 ? (
            compact && detailHref ? (
              <Link
                href={detailHref}
                className="mt-1 inline-block text-[length:var(--fs-11)] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
                style={{ color: "var(--accent-amber)" }}
              >
                [ + {moreCommittees.toLocaleString()} MORE → ]
              </Link>
            ) : (
              <span
                className="mt-1 inline-block text-[length:var(--fs-11)] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-dim)" }}
              >
                +{moreCommittees} more subcommittee{moreCommittees === 1 ? "" : "s"}
              </span>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
