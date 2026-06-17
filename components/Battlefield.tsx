import { getBattlefieldSeats, type BattlefieldSeat } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";

// HO 254 — the D↔R competitive battlefield (replaces the absent competitive
// timeline at the top of the COMPETITIVE tab, above the card grid). Layout +
// styling follow docs/dashboard-2col mock (the mock wins): a single-row lean
// axis where the featured/card races sit as individual labeled dots and the
// rest of the competitive field rolls up into lean-tier aggregate ticks with
// hover popovers. This doc (the handoff) owns the data: the fine-scale Tilt=±0.5
// averaging lives in getBattlefieldSeats. Server component — only state is CSS
// :hover popovers, no motion. Markers carry data-seat for the next handoff's
// card↔marker cross-highlight.

// Competitive band only (Lean / Tilt / Toss). Likely & Solid (|c| > this) drop
// off the axis entirely — matches the mock's "~N competitive seats".
const COMPETITIVE_MAX = 1.5;

// Election Day 2026 is Tuesday Nov 3. force-dynamic page → request-time fresh.
const ELECTION_DAY_MS = Date.UTC(2026, 10, 3);
function daysToElection(): number {
  return Math.max(0, Math.ceil((ELECTION_DAY_MS - Date.now()) / 86_400_000));
}

// Consensus → axis x%. Piecewise-linear through the mock's tier anchors so the
// aggregate tier ticks land at their canonical slots (Lean ±1 → 15/85, Tilt
// ±0.5 → 28/72, Toss 0 → 50) and featured dots interpolate between them.
const ANCHORS: Array<[number, number]> = [
  [-1.5, 8],
  [-1, 15],
  [-0.5, 28],
  [0, 50],
  [0.5, 72],
  [1, 85],
  [1.5, 92],
];
function axisX(c: number): number {
  const cc = Math.max(-1.5, Math.min(1.5, c));
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [c0, x0] = ANCHORS[i]!;
    const [c1, x1] = ANCHORS[i + 1]!;
    if (cc >= c0 && cc <= c1) return x0 + ((cc - c0) / (c1 - c0)) * (x1 - x0);
  }
  return 50;
}

type Tier = {
  key: string;
  label: string; // tick label, UPPER ("LEAN D")
  word: string; // popover rating word, title-case ("Lean D")
  x: number;
  ratingClass: "d" | "r" | "tu";
  test: (c: number) => boolean;
};

// Five lean tiers, mock order/positions. Boundaries bucket the continuous
// consensus to its nearest fine-scale tier (Toss 0 / Tilt ±0.5 / Lean ±1).
const TIERS: Tier[] = [
  { key: "lean-d", label: "LEAN D", word: "Lean D", x: 15, ratingClass: "d", test: (c) => c <= -0.75 && c >= -COMPETITIVE_MAX },
  { key: "tilt-d", label: "TILT D", word: "Tilt D", x: 28, ratingClass: "d", test: (c) => c < -0.25 && c > -0.75 },
  { key: "toss", label: "TOSS UP", word: "Toss Up", x: 50, ratingClass: "tu", test: (c) => Math.abs(c) <= 0.25 },
  { key: "tilt-r", label: "TILT R", word: "Tilt R", x: 72, ratingClass: "r", test: (c) => c > 0.25 && c < 0.75 },
  { key: "lean-r", label: "LEAN R", word: "Lean R", x: 85, ratingClass: "r", test: (c) => c >= 0.75 && c <= COMPETITIVE_MAX },
];

export async function Battlefield({
  cycle = 2026,
  featuredIds = [],
}: {
  cycle?: number;
  // The card races (top Senate + House) get individual dots on the axis —
  // keeps the dot set in lockstep with the cards below (the next handoff wires
  // the cross-highlight off the shared data-seat).
  featuredIds?: string[];
}) {
  const seats = await getBattlefieldSeats(cycle);
  if (seats.length === 0) return null;

  const competitive = seats.filter(
    (s) => Math.abs(s.consensus) <= COMPETITIVE_MAX,
  );
  const featuredSet = new Set(featuredIds);
  // Featured dots sit at their true lean x, but the card races cluster near
  // toss-up center, so labels collide. Nudge adjacent dots to a minimum gap
  // (left→right, then clamp the right edge back) — a label-readability dodge,
  // the lean zone is preserved.
  const FEATURED_MIN_GAP = 9;
  const featured = seats
    .filter((s) => featuredSet.has(s.raceId))
    .map((s) => ({ seat: s, x: axisX(s.consensus) }))
    .sort((a, b) => a.x - b.x);
  for (let i = 1; i < featured.length; i++) {
    const prev = featured[i - 1]!;
    if (featured[i]!.x - prev.x < FEATURED_MIN_GAP) {
      featured[i]!.x = prev.x + FEATURED_MIN_GAP;
    }
  }
  for (let i = featured.length - 1; i >= 0; i--) {
    if (featured[i]!.x > 95) featured[i]!.x = 95;
    if (i > 0 && featured[i]!.x - featured[i - 1]!.x < FEATURED_MIN_GAP) {
      featured[i - 1]!.x = featured[i]!.x - FEATURED_MIN_GAP;
    }
  }

  // Tier rollups over the whole competitive field (featured included — the dot
  // is a highlight layer over the count, as in the mock).
  const tiers = TIERS.map((t) => ({
    ...t,
    seats: competitive
      .filter((s) => t.test(s.consensus))
      .sort((a, b) => a.consensus - b.consensus),
  })).filter((t) => t.seats.length > 0);

  return (
    <section className="battlefield" aria-label="Competitive battlefield">
      <div className="ctl-head">
        <div className="ctl-legend">
          TOSS-UPS <span className="ctl-sw" /> SEN{" "}
          <span className="ctl-sw ctl-sw-sq" /> HOUSE ·{" "}
          <span className="ctl-sw ctl-sw-tick" /> field by lean
        </div>
        <div className="ctl-eday">
          <span className="ctl-eday-t">ELECTION DAY</span> · NOV 3 ·{" "}
          <span className="ctl-eday-cd">{daysToElection()} DAYS</span> · ~
          {competitive.length} competitive seats
        </div>
      </div>

      <div className="ctl">
        <div className="ctl-track" />

        {/* Aggregate lean-tier ticks (field rollup) */}
        {tiers.map((t) => (
          <div
            key={t.key}
            className="cm cm-agg"
            style={{ left: `${t.x}%` }}
          >
            <span className="cm-tick" />
            <span className="cm-cnt">{t.seats.length} RACES</span>
            <div className="cm-pop" role="tooltip">
              <div className="cm-pop-h">
                {t.label} · {t.seats.length} SEATS
              </div>
              {t.seats.map((s) => (
                <div key={s.raceId} className="cm-pop-r" data-seat={s.raceId}>
                  <span
                    className="cm-pd"
                    data-chamber={s.chamber}
                    style={{ background: partyColor(s.incumbentParty) }}
                  />
                  <span className="cm-pop-seat">{s.label}</span>
                  <span className={`cm-pop-rt cm-pop-rt-${t.ratingClass}`}>
                    {t.word}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Featured (card) races — individual dots, label above */}
        {featured.map(({ seat: s, x }) => (
          <div
            key={s.raceId}
            className="cm cm-dot-wrap"
            data-seat={s.raceId}
            data-chamber={s.chamber}
            style={{ left: `${x}%` }}
          >
            <span
              className="cm-lbl"
              style={{ color: partyColor(s.incumbentParty) }}
            >
              {s.label}
            </span>
            <span
              className="cm-dot"
              style={{ background: partyColor(s.incumbentParty) }}
            />
          </div>
        ))}

        <div className="ctl-axis">
          <span style={{ left: 0, color: "var(--party-democrat)" }}>LEAN D</span>
          <span style={{ left: "50%", transform: "translateX(-50%)" }}>
            TOSS UP
          </span>
          <span style={{ right: 0, color: "var(--party-republican)" }}>
            LEAN R
          </span>
        </div>
      </div>
    </section>
  );
}
