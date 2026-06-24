import type { Metadata } from "next";
import { BreakingTicker } from "@/components/BreakingTicker";
import { LandingCTAs } from "@/components/LandingCTAs";
import { formatRelativeAge } from "@/lib/format";
import {
  type FeedBill,
  type MarketTick,
  getCorpusStats,
  getLatestMarketTicks,
  getStageChanges,
  getStageChangesCount,
  getStageDistribution,
  normalizePartyVariant,
} from "@/lib/queries";
import { topicColor, topicLabel } from "@/lib/topic-colors";
import styles from "./landing.module.css";

// HO 361 (B1, last piece of the multi-user arc) — the split-layout landing.
// Built from the signed-off mock docs/design/landing.html. The LIVE panel is
// real: MOVERS rows + readout stats + markets tape all read the same cached
// Turso queries the `/` dashboard serves (reuse, don't recompute). Only the
// BREAKING strip is invented — a rotating evergreen flavor ticker (the deadpan
// red tag is the joke). Rows use the mock's compact markup (no star/expand/media
// column), NOT the live BillRow. force-dynamic so the cached reads stay fresh
// (revalidated by the sync cron's tags), same as the dashboard.
export const dynamic = "force-dynamic";

const SUBLINE =
  "A live feed of the current Congress: every bill summarized and staged, every member tracked, every competitive race rated.";

export const metadata: Metadata = {
  title: "Congressional Terminal",
  description: SUBLINE,
  openGraph: {
    title: "Congressional Terminal",
    description: SUBLINE,
    url: "/welcome",
    type: "website",
  },
};

// Real stages span all six; the mock had only cmte/floor/enacted. Labels are the
// mock's compact form; colors are the existing --stage-* tokens (no new var),
// driven into the module's generalized .metric .st via inline --st-color.
const STAGE_META: Record<string, { label: string; color: string }> = {
  introduced: { label: "INTRO", color: "var(--stage-introduced)" },
  committee: { label: "CMTE", color: "var(--stage-committee)" },
  floor: { label: "FLOOR", color: "var(--stage-floor)" },
  other_chamber: { label: "OTHER", color: "var(--stage-other-chamber)" },
  president: { label: "PRES", color: "var(--stage-president)" },
  enacted: { label: "ENACTED", color: "var(--stage-enacted)" },
};

// The mock's 8 tape symbols, mapped to live internal market symbols. Keep the
// mock's short labels; pull values live, omit a symbol whose tick is missing.
const TAPE_SLOTS = [
  { label: "S&P 500", sym: "SPX" },
  { label: "NASDAQ", sym: "NDQ" },
  { label: "10Y", sym: "TNX" },
  { label: "CPI", sym: "CPI" },
  { label: "UNEMP", sym: "UNEMP" },
  { label: "SHUTDOWN", sym: "SHUTDOWN" },
  { label: "FED CUT", sym: "FEDCUT" },
  { label: "WTI", sym: "WTI" },
];

function sponsorSurname(b: FeedBill): string {
  if (b.sponsor_last_name) return b.sponsor_last_name.toUpperCase();
  const n = b.sponsor_name ?? "";
  const last = n.split(",")[0]?.trim();
  return (last || n).toUpperCase();
}

function billTopics(b: FeedBill): string[] {
  if (!b.topics) return [];
  try {
    const arr = JSON.parse(b.topics) as unknown;
    return Array.isArray(arr) ? (arr as string[]).slice(0, 2) : [];
  } catch {
    return [];
  }
}

function formatTapeValue(t: MarketTick): string {
  if (t.format === "index" || t.format === "price") {
    return t.price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (t.format === "yield") return `${t.price.toFixed(2)}%`;
  // percent — kalshi odds round to whole %, monthly econ keeps a decimal.
  if (t.cadence === "kalshi") return `${Math.round(t.price)}%`;
  return `${t.price.toFixed(1)}%`;
}

// HO 274 parity: suppress an implausible daily move (FRED DCOILWTICO lags
// multi-day, so a fresh value diffed against a week-stale row reads as a huge
// jump). The dashboard tape applies this at render too — match it so a symbol's
// change agrees across both surfaces; render the price with no arrow/change.
const MAX_PLAUSIBLE_DAILY_MOVE_PCT = 8;

function TapeItem({ label, tick }: { label: string; tick: MarketTick }) {
  const value = formatTapeValue(tick);
  const isOdds = tick.cadence === "kalshi";
  const isMonthly = tick.cadence === "monthly";
  const rawPct = tick.changePct;
  const implausible =
    tick.cadence === "daily" &&
    rawPct !== null &&
    Math.abs(rawPct) > MAX_PLAUSIBLE_DAILY_MOVE_PCT;
  const pct = implausible ? null : rawPct;
  const dir = pct == null ? null : pct >= 0 ? "up" : "dn";
  return (
    <span className={styles.ti}>
      <span className={styles.tl}>{label}</span>
      {isOdds ? (
        <span className={styles.odds}>{value}</span>
      ) : (
        <>
          <span className={styles.tv}>{value}</span>
          {isMonthly ? (
            <span className={styles.badge}>MO</span>
          ) : dir ? (
            <span className={styles[dir] ?? ""}>
              {dir === "up" ? "▲" : "▼"}
              {Math.abs(pct as number).toFixed(2)}%
            </span>
          ) : null}
        </>
      )}
    </span>
  );
}

export default async function WelcomePage() {
  const [movers, moversCount, corpus, stageDist, ticks] = await Promise.all([
    getStageChanges({}, 7, 7),
    getStageChangesCount({}, 7),
    getCorpusStats(true),
    getStageDistribution(undefined, true),
    // The tape must never block or error the landing render — a cached read
    // already serves last-known values on cron lag, and any failure degrades to
    // an empty tape rather than a 500.
    getLatestMarketTicks().catch(() => [] as MarketTick[]),
  ]);

  const introduced = corpus.total;
  const enacted = stageDist.bars.find((b) => b.stage === "enacted")?.count ?? 0;
  const lawRatio = introduced > 0 ? (enacted / introduced) * 100 : 0;
  const moved7d = moversCount.total;

  const tickBySym = new Map(ticks.map((t) => [t.symbol, t]));
  const liveSlots = TAPE_SLOTS.flatMap((s) => {
    const tick = tickBySym.get(s.sym);
    return tick ? [{ label: s.label, tick }] : [];
  });

  return (
    <div className={styles.split}>
      <section className={styles.pitch}>
        <div className={styles.prompt}>
          Congressional Terminal<b>:\&gt;</b>
        </div>
        <h1 className={styles.q}>
          WTF is going on in Congress?<span className={styles.cur}>_</span>
        </h1>
        <p className={styles.sub}>{SUBLINE}</p>
        <div className={styles.readout}>
          <div className={styles.stat}>
            <div className={styles.num}>{introduced.toLocaleString()}</div>
            <div className={styles.lbl}>Introduced</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.num}>{enacted.toLocaleString()}</div>
            <div className={styles.lbl}>
              Became law <span className={styles.pct}>{lawRatio.toFixed(1)}%</span>
            </div>
          </div>
          <div className={styles.stat}>
            <div className={styles.num}>{moved7d.toLocaleString()}</div>
            <div className={styles.lbl}>Moved / 7d</div>
          </div>
        </div>
        <nav className={styles.cta}>
          <LandingCTAs
            primaryClassName={`${styles.btn} ${styles.primary}`}
            secondaryClassName={`${styles.btn} ${styles.secondary}`}
            arrowClassName={styles.arr ?? ""}
          />
          <span className={styles.reassure}>
            <span className={styles.b}>No account needed</span> to look around.
            Full read access.
          </span>
          <span className={styles.savenote}>unlocks saving · watchlist</span>
        </nav>
      </section>

      <aside className={styles.live}>
        <div className={styles.winbar}>
          <div className={styles.wl}>
            <span className={styles.livedot} />
            119TH CONGRESS · LIVE FEED
          </div>
          <div className={styles.wr}>
            <span className={styles.n}>{moved7d.toLocaleString()}</span> MOVED ·
            7D
          </div>
        </div>
        <div className={styles.breaking}>
          <span className={styles.tag}>BREAKING</span>
          <BreakingTicker
            txtClassName={styles.txt ?? ""}
            lineClassName={styles.flavorLine ?? ""}
          />
        </div>
        <div className={styles.tape}>
          {liveSlots.length > 0 ? (
            <div className={styles.ttrack}>
              {[0, 1].map((run) => (
                <span key={run}>
                  {liveSlots.map((s, i) => (
                    <span key={`${run}-${i}`}>
                      <TapeItem label={s.label} tick={s.tick} />
                      <span className={styles.tsep}>·</span>
                    </span>
                  ))}
                </span>
              ))}
            </div>
          ) : (
            <div className={styles.ti}>
              <span className={styles.tl}>MARKET DATA UNAVAILABLE</span>
            </div>
          )}
        </div>
        <div className={styles.feedhead}>
          <span className={`${styles.tab} ${styles.active}`}>
            MOVERS<span className={styles.ct}>({moversCount.total})</span>
          </span>
          {/* The other two tabs are decorative + non-interactive on the landing;
              they carry no fabricated count (only MOVERS is wired). */}
          <span className={styles.tab}>TOP STALLS</span>
          <span className={styles.tab}>NEW</span>
        </div>
        <div className={styles.feed}>
          {movers.map((b) => {
            const stage = b.stage ? STAGE_META[b.stage] : undefined;
            const party = normalizePartyVariant(b.sponsor_party);
            const topics = billTopics(b);
            return (
              <div className={styles.row} key={b.id}>
                <span className={styles.idchip}>
                  {b.bill_type.toUpperCase()} {b.bill_number}
                </span>
                <div className={styles.main}>
                  <div className={styles.title}>{b.title}</div>
                  <div className={styles.subline}>
                    <span className={styles.sponsor}>{sponsorSurname(b)}</span>
                    {party ? (
                      <span
                        className={`${styles.party} ${styles[party.toLowerCase()] ?? ""}`}
                      >
                        [{party}
                        {b.sponsor_state ? `-${b.sponsor_state}` : ""}]
                      </span>
                    ) : null}
                    {topics.length > 0 ? (
                      <span className={styles.sep}>·</span>
                    ) : null}
                    {topics.map((t) => (
                      <span
                        key={t}
                        className={styles.chip}
                        style={{ ["--tc" as string]: topicColor(t) }}
                      >
                        {topicLabel(t)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className={styles.metric}>
                  {stage ? (
                    <span
                      className={styles.st}
                      style={{ ["--st-color" as string]: stage.color }}
                    >
                      {stage.label}
                    </span>
                  ) : null}
                  <span className={styles.age}>
                    {" "}
                    · {formatRelativeAge(b.stage_changed_at ?? b.latest_action_date)}
                  </span>
                </div>
                <span className={styles.caret}>▾</span>
              </div>
            );
          })}
          <div className={styles.fade} />
        </div>
      </aside>
    </div>
  );
}
