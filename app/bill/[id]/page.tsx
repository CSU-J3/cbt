import Link from "next/link";
import { notFound } from "next/navigation";
import { BillAmendments } from "@/components/BillAmendments";
import { BillLobbying } from "@/components/BillLobbying";
import { BillStageBar } from "@/components/BillExpandPanel";
import { BillVoteRow } from "@/components/BillVoteRow";
import { HeaderBar } from "@/components/HeaderBar";
import {
  HearingMeetingsEmbed,
  type HearingEmbedGroup,
} from "@/components/HearingMeetingsEmbed";
import { PartyTag } from "@/components/PartyTag";
import { RecordTabs, type RecordTab } from "@/components/RecordTabs";
import { TopicChips } from "@/components/TopicChips";
import { WatchlistToggle } from "@/components/WatchlistToggle";
import { BILL_TYPE_LABELS } from "@/lib/enums";
import {
  congressGovUrl,
  formatBillId,
  formatDateLong,
  formatRelativeAge,
  formatRelativeAgeLong,
  parseTopics,
} from "@/lib/format";
import {
  type BillCommitteeRow,
  getBillAmendments,
  getBillAmendmentVotes,
  getBillById,
  getBillCommittees,
  getBillLobbying,
  getCommitteesIndex,
  getMeetingsForBill,
  getNewsForBill,
  getVotesByBill,
  isInWatchlist,
} from "@/lib/queries";

// HO 267 Phase 1: max meetings on a single bill = 5 (p90=2, none >8). Cap at 8
// so today every bill shows in full; the "see all on /hearings" out only arms
// if a future bill blows past it.
const BILL_MEETINGS_CAP = 8;

// HO 371 cosponsor support bar — 5 segments span 1–50 (segment width 10), the
// >50 tail caps at full. Re-inlined here (the metabox is a new consumer; lifting
// the panel's one-line private helper would only widen its export surface).
function cosponsorSegments(count: number): number {
  return Math.min(5, Math.ceil(count / 10));
}

// HO 507 — sponsor_name embeds a trailing "[D-CT]" / "[R-TX-19]" party-state
// bracket; the metabox renders its own party-COLORED PartyTag bracket, so strip
// the embedded one here (display-only — the query keeps sponsor_name's embedded
// form, which other consumers depend on). Mirrors BillAmendments' Sponsor, which
// leans on the same embedded bracket rather than double-printing it.
function sponsorDisplayName(name: string): string {
  return name.replace(/\s*\[[^\]]*\]\s*$/, "").trim() || name;
}

// HO 145: per-committee referral row on the bill detail page. Subcommittees
// carry their parent name inline (matching the member-hub pattern) so the
// hierarchy reads without a tree UI.
function BillCommitteeItem({
  row,
  nowMs,
}: {
  row: BillCommitteeRow;
  nowMs: number;
}) {
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
          {formatRelativeAgeLong(row.activityDate, nowMs)} ago
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

  const [
    onWatchlist,
    committees,
    meetings,
    committeeIndex,
    amendments,
    amendmentVotes,
    lobbying,
    news,
    billVotes,
  ] = await Promise.all([
    isInWatchlist(bill.id),
    getBillCommittees(bill.id),
    getMeetingsForBill(bill.id),
    getCommitteesIndex(),
    getBillAmendments(bill.id),
    // HO 530: Senate amendment vote outcomes (tally + party split), joined free via
    // votes.question. Empty map when none — the section renders unchanged.
    getBillAmendmentVotes(bill.id),
    getBillLobbying(bill.id),
    // HO 507: the exact bounded, unstable_cache'd read /api/bill/[id]/panel
    // already runs on every feed expand — feeds the hero's RELATED NEWS.
    getNewsForBill(bill.id, 5),
    // HO 542: every vote carrying this bill's bill_id — the orphaned query wired at
    // last. Includes House amendment votes (they carry bill_id); the VOTES tab shows
    // the bill's OWN votes, so those are excluded below.
    getVotesByBill(bill.id),
  ]);

  // HO 542: the bill's OWN passage/procedural roll calls = getVotesByBill MINUS the
  // amendment votes already shown in the Amendments tab. The exclusion set is the
  // House-link voteIds already in scope from amendmentVotes (STEP 0 measured ZERO
  // Senate-pattern leak into getVotesByBill — Senate amendment votes don't carry
  // bill_id — so the House-link set is provably sufficient; no question re-parse).
  const amendmentVoteIds = new Set<string>();
  for (const list of Object.values(amendmentVotes)) {
    for (const av of list) amendmentVoteIds.add(av.voteId);
  }
  const ownVotes = billVotes.filter((v) => !amendmentVoteIds.has(v.id));
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

  // ── the record box tabs (HO 510) ── a tab exists ONLY when its section
  // renders today (the deliberate opposite of the member hub — most bills have
  // no committees / hearings / amendments / lobbying, so a wall of dimmed tabs
  // would be noise). Fixed legislative-process order: referral → hearings →
  // floor amendments → outside money. When nothing qualifies `tabs` is empty
  // and RecordTabs renders null → no box, exactly today's section-omission.
  const tabs: RecordTab[] = [];

  if (committees.length > 0) {
    tabs.push({
      key: "committees",
      label: "Committees",
      count: committees.length,
      content: (
        <ul className="px-4 py-2">
          {committees.map((row, i) => (
            <BillCommitteeItem
              key={`${row.systemCode}-${row.activityType}-${row.activityDate}-${i}`}
              row={row}
              nowMs={nowMs}
            />
          ))}
        </ul>
      ),
    });
  }

  if (meetings.length > 0) {
    tabs.push({
      key: "hearings",
      label: "Hearings",
      count: meetings.length,
      outLabel: "/hearings →",
      outHref: "/hearings",
      content: (
        <div>
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
      ),
    });
  }

  if (amendments && amendments.length > 0) {
    // The .rec-note carries the HO 507 agreed/failed tallies now that the strip
    // shows only label + count — the amStat clauses minus the leading (count).
    const amAgreed = amendments.filter((r) => r.disposition === "agreed").length;
    const amFailed = amendments.filter((r) => r.disposition === "failed").length;
    const amNoteParts: string[] = [];
    if (amAgreed > 0) amNoteParts.push(`${amAgreed} agreed`);
    if (amFailed > 0) amNoteParts.push(`${amFailed} failed`);
    const amNote = amNoteParts.join(" · ");
    tabs.push({
      key: "amendments",
      label: "Amendments",
      count: amendments.length,
      outLabel: "/amendments →",
      outHref: `/amendments?bill=${bill.id}`,
      content: (
        <>
          {amNote ? <div className="rec-note">{amNote}</div> : null}
          <BillAmendments rows={amendments} votes={amendmentVotes} />
        </>
      ),
    });
  }

  // HO 542: the bill's OWN passage/procedural votes, between amendments (act on
  // parts) and lobbying (outside money, orthogonal-last) — passage is the
  // culminating floor action on the whole bill. Omit-at-zero like every other tab;
  // each row's #{rollCall} links to the /vote/[id] entity page (HO 540).
  if (ownVotes.length > 0) {
    tabs.push({
      key: "votes",
      label: "Votes",
      count: ownVotes.length,
      content: (
        <div className="px-4 py-2">
          {ownVotes.map((v) => (
            <BillVoteRow key={v.id} vote={v} />
          ))}
        </div>
      ),
    });
  }

  if (lobbying) {
    tabs.push({
      key: "lobbying",
      label: "Lobbying",
      count: lobbying.distinctFilings,
      content: (
        <>
          <div className="rec-note">
            {lobbying.distinctFilings.toLocaleString()} filings ·{" "}
            {lobbying.distinctClients.toLocaleString()} clients
          </div>
          <BillLobbying drill={lobbying} />
        </>
      ),
    });
  }

  // initialKey = highest count among present tabs; strict > with fixed-order
  // iteration breaks ties toward the earlier tab. So 119-s-4784 opens on
  // Amendments (872) and a one-referral bill opens on Committees, strip stable.
  let initialTabKey: string | undefined;
  let maxTabCount = -1;
  for (const t of tabs) {
    const c = t.count ?? 0;
    if (c > maxTabCount) {
      maxTabCount = c;
      initialTabKey = t.key;
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath={`/bill/${bill.id}`}
        detail={formatBillId(bill.bill_type, bill.bill_number)}
      />

      <main className="bdp w-full flex-1 px-4 py-4">
        {/* ═══ HERO — the expand panel's big sibling ═══ */}
        <div
          className="border p-5"
          style={{
            backgroundColor: "var(--bg-row-hover)",
            borderColor: "var(--border-strong)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-baseline gap-3">
              <span
                className="whitespace-nowrap text-[16px] font-medium"
                style={{ color: "var(--accent-amber)" }}
                title={BILL_TYPE_LABELS[bill.bill_type]}
              >
                {formatBillId(bill.bill_type, bill.bill_number)}
              </span>
              <h1
                className="min-w-0 text-[15px]"
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "var(--sans)",
                  lineHeight: 1.4,
                }}
              >
                {bill.title}
              </h1>
            </div>
            <WatchlistToggle billId={bill.id} initial={onWatchlist} />
          </div>

          {/* Shared stage bar (HO 317). Returns null on null/off-path stage. */}
          <BillStageBar bill={bill} nowMs={nowMs} />

          <div className="bxp-body">
            {/* LEFT — SUMMARY + RELATED NEWS */}
            <div className="bxp-left">
              {bill.summary ? (
                <>
                  <div className="bxp-relhdr">Summary</div>
                  <p className="bxp-summary">{bill.summary}</p>
                </>
              ) : null}

              <div className="bxp-relblock">
                <div className="bxp-relhdr">Related News</div>
                {news.length > 0 ? (
                  <>
                    {news.map((n) => (
                      <a
                        key={n.id}
                        className="bxp-relnews"
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="bxp-relnews-title">{n.title}</span>
                        <span className="bxp-relnews-meta">
                          {" · "}
                          {n.source.toUpperCase()} ·{" "}
                          {formatRelativeAge(n.publishedAt, nowMs)}
                        </span>
                      </a>
                    ))}
                    <div className="bdp-relfoot">
                      <Link href={`/news?bill=${bill.id}`}>
                        all coverage → /news?bill={bill.id}
                      </Link>
                    </div>
                  </>
                ) : (
                  <div className="bxp-relempty">NO RELATED NEWS</div>
                )}
              </div>
            </div>

            {/* RIGHT — boxed meta card */}
            <div className="bxp-metabox">
              {bill.sponsor_name ? (
                <div className="bxp-mrow">
                  <div className="bxp-mlabel">Sponsor</div>
                  <div className="bxp-mval">
                    {bill.sponsor_bioguide_id ? (
                      <Link
                        href={`/members/${bill.sponsor_bioguide_id}`}
                        className="bdp-sponsorlnk"
                      >
                        {sponsorDisplayName(bill.sponsor_name)}
                      </Link>
                    ) : (
                      <span>{sponsorDisplayName(bill.sponsor_name)}</span>
                    )}{" "}
                    <PartyTag
                      party={bill.sponsor_party}
                      state={bill.sponsor_state}
                      className="bdp-ptag"
                    />
                  </div>
                </div>
              ) : null}

              {bill.cosponsor_count != null ? (
                <div className="bxp-mrow">
                  <div className="bxp-mlabel">Cosponsors</div>
                  <div className="bxp-mval bxp-cosrow">
                    <span className="bxp-cosval tabular-nums">
                      {bill.cosponsor_count.toLocaleString()}
                    </span>
                    <span className="bxp-cosbar" aria-hidden>
                      {Array.from({ length: 5 }, (_, i) => (
                        <span
                          key={i}
                          className={`bxp-cosseg${
                            i < cosponsorSegments(bill.cosponsor_count!)
                              ? " bxp-cosseg--on"
                              : ""
                          }`}
                        />
                      ))}
                    </span>
                  </div>
                </div>
              ) : null}

              {topics.length > 0 ? (
                <div className="bxp-mrow">
                  <div className="bxp-mlabel">Topics</div>
                  <div className="bxp-mval">
                    <TopicChips topics={topics} />
                  </div>
                </div>
              ) : null}

              {bill.introduced_date ? (
                <div className="bxp-mrow">
                  <div className="bxp-mlabel">Introduced</div>
                  <div className="bxp-mval tabular-nums">
                    {formatDateLong(bill.introduced_date)}
                  </div>
                </div>
              ) : null}

              {bill.latest_action_date ? (
                <div className="bxp-mrow">
                  <div className="bxp-mlabel">Last action</div>
                  <div className="bxp-mval tabular-nums">
                    {formatDateLong(bill.latest_action_date)} ·{" "}
                    {formatRelativeAge(bill.latest_action_date, nowMs)} ago
                  </div>
                  {bill.latest_action_text ? (
                    <div className="bdp-latext" title={bill.latest_action_text}>
                      {bill.latest_action_text}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="bxp-mrow">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="bdp-mlink"
                >
                  Congress.gov ↗
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ THE RECORD BOX (HO 510) — Committees · Hearings · Amendments ·
            Lobbying; a tab per section that renders today, no box when none ═══ */}
        <RecordTabs
          key={bill.id}
          ariaLabel="Bill record"
          tabs={tabs}
          initialKey={initialTabKey}
        />

        {/* ═══ FOOTER — one row; Raw JSON opens full-width below (no-JS) ═══ */}
        <details className="bdp-foot mt-4">
          <summary className="bdp-footrow">
            <Link href="/bills" className="bdp-footbtn">
              ← Back to feed
            </Link>
            <span className="bdp-footbtn bdp-rawcue">Raw JSON</span>
            {bill.summary_model ? (
              <span className="bdp-attrib">
                Summary by {bill.summary_model}
                {bill.summary_updated_at
                  ? ` · ${formatDateLong(bill.summary_updated_at)}`
                  : null}
              </span>
            ) : null}
          </summary>
          <pre className="bdp-rawpre">{formattedRaw}</pre>
        </details>
      </main>
    </div>
  );
}
