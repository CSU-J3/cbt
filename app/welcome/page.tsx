import type { Metadata } from "next";
import { BreakingTicker } from "@/components/BreakingTicker";
import { LandingCTAs } from "@/components/LandingCTAs";
import { WelcomeClock } from "@/components/WelcomeClock";
import { isMarketOpen } from "@/lib/market-hours";
import { MARKET_SYMBOLS } from "@/lib/markets";
import {
  type MarketTick,
  getCorpusStats,
  getLatestMarketTicks,
  getStageChangesCount,
  getStageDistribution,
} from "@/lib/queries";
import { Panel, loadBoard } from "./panels";
import styles from "./landing.module.css";

// HO 670 — /welcome rebuilt as the BOARD: top rail (brand · IN BETA · clock) ·
// BREAKING · banner (headline + lead + CTA grid) · MARKETS tape · ODDS tape ·
// three cycling demo panels · bottom rail. Supersedes the HO 361 split layout
// built from docs/design/landing.html; the board is format 1 of
// docs/design/welcome-formats-mock.html, ruled by Corey 2026-08-17. Where the
// mock and the handoff spec disagreed, the spec won.
//
// STILL A SERVER COMPONENT. The page gains exactly ONE client island — the
// ticking clock (components/WelcomeClock.tsx) — because a clock cannot be
// server-rendered without lying by the next second. Its zone is PINNED to MT,
// matching the two AS OF stamps and LAST SYNC below: the shared useZoneCycle
// rotation is right for a stamp of a FIXED moment and wrong for a running clock,
// whose hour would jump every 4s while its seconds ran on. Everything else that moves
// (both marquees, the panels' vertical scroll, the 45s crossfade, the IN BETA
// pulse, the cursor blink) is CSS, and every one of them is pinned under
// prefers-reduced-motion. LandingCTAs + BreakingTicker were already islands.
//
// force-dynamic so the cached reads stay fresh (revalidated by the sync cron's
// tags), same as the dashboard — and so the market-hours CLOSED/OPEN derivation
// below is computed per render rather than frozen into a cached page.
export const dynamic = "force-dynamic";

const LEAD =
  "Ever wanted to know the ROI on your Congress Critter? Are they working hard, or hardly working? Here, I've centralized it for ya.";

export const metadata: Metadata = {
  title: "Congressional Terminal",
  description: LEAD,
  openGraph: {
    title: "Congressional Terminal",
    description: LEAD,
    url: "/welcome",
    type: "website",
  },
};

// HO 670 — the tape rosters are DERIVED FROM lib/markets CONFIG, which is what
// retires the eight hardcoded label→symbol pairs the old page carried (HO 669
// pinned that divergence on the record). MARKETS is every FMP/FRED symbol —
// verified set-identical to DashboardV2Header's MARKETS_TAPE — and ODDS is every
// Kalshi symbol. Labels, formats and cadences all come from the config now, so a
// symbol renamed there renames here for free.
//
// What is still local: render ORDER and the K↔P pairing. Deriving the pairing
// from polyKind/polyMonth would be an inference about two independent fields, so
// the four pairs are written out. `lib/markets.ts` is NOT edited by this HO, and
// the full unification with components/MarketsTape (which owns the shared live
// island and its hover portal on `/`) is filed in the backlog, not taken here.
const MARKETS_ROSTER = MARKET_SYMBOLS.filter(
  (s) => s.source === "fmp" || s.source === "fred",
);
const ODDS_PAIRS: { primary: string; secondary: string }[] = [
  { primary: "SHUTDOWN", secondary: "POLY-SHUTDOWN" },
  // HO 681: one Fed-cut horizon. A September-pinned pair sat here from HO 670
  // until the roller reached September and the two resolved one event. Note this
  // strip labels from `MARKET_SYMBOLS[].label` and does NOT use `showMonth`, so
  // it read "FED CUT ODDS" / "FED CUT ODDS (SEP)" — visually distinct while
  // carrying identical numbers, which is the harder duplication to notice.
  { primary: "FEDCUT", secondary: "POLY-FEDCUT" },
  { primary: "RECESSION", secondary: "POLY-RECESSION" },
];

// The AS OF / LAST SYNC stamps render server-side in MT, the same zone the rail
// clock is pinned to — every time on this page is in one zone, and none of them
// rotate. Cycling a stamp is right where the moment is fixed (the live tape, the
// masthead LAST SYNC); it is wrong beside a running clock.
//
// `formatInZone` is NOT imported here even though it emits exactly this string:
// `lib/zone-cycle.ts` also exports the `useZoneCycle` HOOK, which makes the whole
// module client-only ("You're importing a component that needs useState"), so a
// server component cannot reach the pure formatter sitting beside it. The clock
// island reuses the hook; this stamp reproduces the format. Splitting the pure
// half out of that module would be a lib edit, which this HO does not take.
const MT_TZ = "America/Denver";
let mtFormatter: Intl.DateTimeFormat | undefined;
function formatMt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  mtFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: MT_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${mtFormatter.format(d)} MT`;
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

function MarketsItem({ tick }: { tick: MarketTick }) {
  const raw = tick.changePct;
  const implausible =
    tick.cadence === "daily" &&
    raw !== null &&
    Math.abs(raw) > MAX_PLAUSIBLE_DAILY_MOVE_PCT;
  const pct = implausible ? null : raw;
  return (
    <span className={styles.tapeitem}>
      <span className={styles.sym}>{tick.label.toUpperCase()}</span>{" "}
      <span className={styles.val}>{formatTapeValue(tick)}</span>
      {pct !== null ? (
        <>
          {" "}
          <span className={pct >= 0 ? styles.up : styles.down}>
            {pct >= 0 ? "▲ +" : "▼ -"}
            {Math.abs(pct).toFixed(2)}%
          </span>
        </>
      ) : null}
      {tick.eod ? <span className={styles.badge}>EOD</span> : null}
      {tick.cadence === "monthly" ? (
        <span className={styles.cad}> MO</span>
      ) : null}
    </span>
  );
}

// The two halves are INDEPENDENT readings, never blended into one number: K is
// Kalshi, P is Polymarket, and a missing half renders N/A rather than hiding the
// pair (which would silently imply the question isn't being priced at all).
function OddsItem({
  label,
  kalshi,
  poly,
}: {
  label: string;
  kalshi: MarketTick | undefined;
  poly: MarketTick | undefined;
}) {
  return (
    <span className={styles.tapeitem}>
      <span className={styles.sym}>{label}</span>{" "}
      <span className={styles.srcK}>K</span>{" "}
      {kalshi ? (
        <span className={styles.val}>{kalshi.price.toFixed(1)}%</span>
      ) : (
        <span className={styles.na}>N/A</span>
      )}{" "}
      <span className={styles.srcP}>P</span>{" "}
      {poly ? (
        <span className={styles.val}>{poly.price.toFixed(1)}%</span>
      ) : (
        <span className={styles.na}>N/A</span>
      )}
    </span>
  );
}

// A CSS-only marquee loops by translating the track -50%, which is seamless ONLY
// while each half is at least as wide as the strip. MARKETS carries 11 symbols and
// clears that on its own; ODDS carries 4 pairs (~900px), so a single copy per half
// leaves a visible dead gap on a wide screen. The live client tape solves this by
// MEASURING and setting a repeat count in JS; a server-rendered strip cannot
// measure, so it overshoots — three copies per half, ~2,700px, past any desktop.
const ODDS_COPIES_PER_HALF = 3;

function latestTickedAt(ticks: MarketTick[]): string | null {
  let best: string | null = null;
  let max = 0;
  for (const t of ticks) {
    const ms = Date.parse(t.tickedAt);
    if (Number.isFinite(ms) && ms > max) {
      max = ms;
      best = t.tickedAt;
    }
  }
  return best;
}

export default async function WelcomePage() {
  const [moversCount, corpus, stageDist, ticks] = await Promise.all([
    getStageChangesCount({}, 7),
    getCorpusStats(true),
    getStageDistribution(undefined, true),
    // The tape must never block or error the landing render — a cached read
    // already serves last-known values on cron lag, and any failure degrades to
    // an empty tape rather than a 500.
    getLatestMarketTicks().catch(() => [] as MarketTick[]),
  ]);
  // HO 490: page-computed clock for every relative age below (#418).
  const nowMs = Date.now();
  const moved7d = moversCount.total;
  const board = await loadBoard(nowMs, moved7d);

  const introduced = corpus.total;
  const enacted = stageDist.bars.find((b) => b.stage === "enacted")?.count ?? 0;
  const lawRatio = introduced > 0 ? (enacted / introduced) * 100 : 0;

  const bySymbol = new Map(ticks.map((t) => [t.symbol, t]));
  const marketTicks = MARKETS_ROSTER.flatMap((s) => {
    const t = bySymbol.get(s.internal);
    return t ? [t] : [];
  });
  const oddsItems = ODDS_PAIRS.flatMap((p) => {
    const kalshi = bySymbol.get(p.primary);
    const poly = bySymbol.get(p.secondary);
    if (!kalshi && !poly) return [];
    const label = (
      MARKET_SYMBOLS.find((s) => s.internal === p.primary)?.label ?? p.primary
    ).toUpperCase();
    return [{ key: p.primary, label, kalshi, poly }];
  });

  // Market state comes from the DATA + the shared NYSE calendar (lib/market-hours,
  // the same helper the live tape's wash reads), never from a constant. ODDS is a
  // prediction/24-7 strip, so it is always LIVE — the same rule the live tape
  // applies to a "signals" strip.
  const marketsOpen = isMarketOpen(new Date(nowMs));
  const marketsAsOf = formatMt(latestTickedAt(marketTicks));
  const oddsAsOf = formatMt(
    latestTickedAt(
      oddsItems.flatMap(
        (o) => [o.kalshi, o.poly].filter(Boolean) as MarketTick[],
      ),
    ),
  );

  return (
    <div className={styles.page}>
      <div className={styles.rail}>
        <span className={styles.brand}>
          Congressional Terminal<b className={styles.prompt}>:\&gt;</b>
        </span>
        <span className={styles.beta}>IN BETA</span>
        <span className={styles.spacer} />
        <WelcomeClock
          className={styles.clock ?? ""}
          timeClassName={styles.clockTime ?? ""}
          zoneClassName={styles.clockZone ?? ""}
        />
      </div>

      <div className={styles.breaking}>
        <span className={styles.tag}>BREAKING</span>
        <BreakingTicker
          txtClassName={styles.txt ?? ""}
          lineClassName={styles.flavorLine ?? ""}
        />
      </div>

      <div className={styles.banner}>
        <div className={styles.headwrap}>
          <h1 className={styles.h1}>
            WTF is going on in Congress?
            <span className={styles.cursor} aria-hidden="true" />
          </h1>
        </div>
        <div className={styles.leadwrap}>
          <p className={styles.lead}>{LEAD}</p>
        </div>

        <div className={styles.right}>
          <div className={styles.ctagrid}>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <div className={styles.v}>{introduced.toLocaleString()}</div>
                <div className={styles.l}>Introduced</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.v}>{enacted.toLocaleString()}</div>
                <div className={styles.l}>
                  Became law <em>{lawRatio.toFixed(1)}%</em>
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.v}>{moved7d.toLocaleString()}</div>
                <div className={styles.l}>Moved / 7d</div>
              </div>
            </div>

            {/* Mathematical Bold Script (U+1D4D0 block) + U+0361 combining marks:
                neither Plex face covers them, so the fallback stack is DECLARED
                rather than left to whatever the browser picks. Decorative — the
                microcopy under the button carries the meaning — hence aria-hidden
                rather than a screen reader spelling it out codepoint by codepoint. */}
            <span className={styles.flourish} aria-hidden="true">
              (☞ ͡° ͜ʖ ͡°)☞ 𝓖𝓸 𝓯𝓲𝓷𝓭 &apos;𝓮𝓶! ♥♥
            </span>

            <LandingCTAs
              primaryClassName={`${styles.btn} ${styles.btnPrimary}`}
              secondaryClassName={`${styles.btn} ${styles.btnSecondary}`}
              arrowClassName={styles.arr ?? ""}
            />

            <span className={styles.micro1}>
              <b>No account needed</b> to poke around.
            </span>
            <span className={styles.micro2}>
              <span className={styles.arrow}>↑</span> Want your own watchlist?
            </span>
          </div>
        </div>
      </div>

      <div className={styles.tapes}>
        <div className={styles.taperow}>
          <span className={styles.tapelabel}>MARKETS</span>
          <span className={styles.tapemask}>
            {marketTicks.length > 0 ? (
              <span
                className={styles.tapetrack}
                style={{ ["--tdur" as string]: "64s" }}
              >
                {/* Duplicated EXACTLY twice — the -50% loop depends on it. */}
                {[0, 1].map((run) => (
                  <span key={run} className={styles.taperun}>
                    {marketTicks.map((t) => (
                      <MarketsItem key={`${run}-${t.symbol}`} tick={t} />
                    ))}
                  </span>
                ))}
              </span>
            ) : (
              <span className={styles.tapeitem}>
                <span className={styles.sym}>MARKET DATA UNAVAILABLE</span>
              </span>
            )}
          </span>
          <span className={styles.asof}>
            AS OF {marketsAsOf} ·{" "}
            {marketsOpen ? (
              <>
                <span className={styles.livedot} />
                <span className={styles.live}>OPEN</span>
              </>
            ) : (
              <span className={styles.closed}>CLOSED</span>
            )}
          </span>
        </div>

        {/* HO 692 site 2 — the global `odds-only` class rides ALONGSIDE the CSS
            module class; the two live in different namespaces and do not collide.
            /welcome carries no masthead and so no toggle of its own, but a reader
            who set the preference elsewhere gets it honoured here too — "propagate
            throughout the application" is literal. Unlike the dashboard tape this
            row is NOT hidden below 700px (it is a module `taperow`, not
            `.markets-tape`), so 430 is a real test of this site. */}
        <div className={`${styles.taperow} odds-only`} data-market="signals">
          <span className={styles.tapelabel}>ODDS</span>
          <span className={styles.tapemask}>
            {oddsItems.length > 0 ? (
              <span
                className={`${styles.tapetrack} ${styles.rtl}`}
                style={{ ["--tdur" as string]: "52s" }}
              >
                {[0, 1].map((half) => (
                  <span key={half} className={styles.taperun}>
                    {Array.from({ length: ODDS_COPIES_PER_HALF }, (_, copy) =>
                      oddsItems.map((o) => (
                        <OddsItem
                          key={`${half}-${copy}-${o.key}`}
                          label={o.label}
                          kalshi={o.kalshi}
                          poly={o.poly}
                        />
                      )),
                    )}
                  </span>
                ))}
              </span>
            ) : (
              <span className={styles.tapeitem}>
                <span className={styles.sym}>ODDS UNAVAILABLE</span>
              </span>
            )}
          </span>
          <span className={styles.asof}>
            AS OF {oddsAsOf} · <span className={styles.livedot} />
            <span className={styles.live}>LIVE</span>
          </span>
        </div>
      </div>

      <div className={styles.board}>
        {board.panels.map((p) => (
          <Panel key={p.key} panel={p} />
        ))}
      </div>

      <div className={styles.bottom}>
        <span className={styles.foot}>
          119th Congress <span className={styles.sep}>·</span> congress.gov{" "}
          <span className={styles.sep}>·</span> FRED{" "}
          <span className={styles.sep}>·</span> Kalshi{" "}
          <span className={styles.sep}>·</span> Polymarket{" "}
          <span className={styles.sep}>·</span> FEC{" "}
          <span className={styles.sep}>·</span> synced 4× daily
        </span>
        <span className={styles.spacer} />
        <span className={styles.foot}>
          LAST SYNC <span className={styles.footK}>{formatMt(corpus.lastSync)}</span>
        </span>
      </div>
    </div>
  );
}
