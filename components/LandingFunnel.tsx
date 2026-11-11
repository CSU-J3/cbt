import styles from "@/app/welcome/landing.module.css";
import type { Stage } from "@/lib/enums";
import { funnelWidthPct } from "@/lib/stage-funnel-geometry";

// HO 813 — /welcome's stage funnel card, drawn beside the headline (ruled on
// mock-813-landing-scroll.html: BESIDE funnel). A server component: it takes the
// page's reads and renders static rows, and it carries no hover or filter,
// which stay the dashboard's (components/StageFunnel.tsx).
//
// THE TITLE AND THE BARS ARE ONE SCOPE. The title is getCorpusStats(true).total
// and the bars are getStageDistribution(undefined, true): both summarized and
// non-ceremonial, and every such bill sits on one of the six stages, so the six
// counts sum to the title (HO 813 STEP 0's claim 4 read them equal, and smoke
// asserts it on every run). The bar widths are the dashboard's, read from
// lib/stage-funnel-geometry.ts, so the two funnels can't drift.
//
// The labels are sentence case where the dashboard's are caps, and the last row
// is amber (--accent-amber-bright, the mock's one other amber besides the
// primary button) in its label, bar and count.
type Bar = { stage: Stage; count: number };

const ROWS: { stage: Stage; label: string; color: string }[] = [
  { stage: "introduced", label: "Introduced", color: "var(--stage-introduced)" },
  { stage: "committee", label: "In committee", color: "var(--stage-committee)" },
  { stage: "floor", label: "On the floor", color: "var(--stage-floor)" },
  { stage: "other_chamber", label: "Passed one chamber", color: "var(--stage-other-chamber)" },
  { stage: "president", label: "On the President's desk", color: "var(--stage-president)" },
  { stage: "enacted", label: "Became law", color: "var(--accent-amber-bright)" },
];

export function LandingFunnel({
  bars,
  total,
  enacted,
  lawRatio,
  congressLabel,
}: {
  bars: Bar[];
  total: number;
  enacted: number;
  lawRatio: number;
  congressLabel: string;
}) {
  const byStage = new Map(bars.map((b) => [b.stage, b.count]));
  const maxCount = bars.reduce((m, b) => Math.max(m, b.count), 0);
  const last = ROWS.length - 1;
  return (
    <div className={styles.card} data-landing-funnel="">
      <h2 className={styles.cardTitle}>{total.toLocaleString("en-US")} bills, by stage</h2>
      <p className={styles.sub}>
        Every bill in the {congressLabel}, by its current stage from introduction to enactment.
      </p>
      <div className={styles.funnel}>
        {ROWS.map((r, i) => {
          const count = byStage.get(r.stage) ?? 0;
          const law = i === last;
          return (
            <div key={r.stage} className={styles.frow} data-funnel-row="">
              <span className={`${styles.lab}${law ? ` ${styles.law}` : ""}`}>{r.label}</span>
              <span className={styles.trk}>
                <span
                  className={styles.bar}
                  style={{ width: `${funnelWidthPct(count, maxCount).toFixed(1)}%`, background: r.color }}
                  aria-hidden
                />
              </span>
              <span className={`${styles.ct} ${styles.num}${law ? ` ${styles.law}` : ""}`}>
                {count.toLocaleString("en-US")}
              </span>
            </div>
          );
        })}
      </div>
      <p className={styles.foot}>
        <b>{enacted.toLocaleString("en-US")} became law</b>, {lawRatio.toFixed(1)} percent. Ceremonial
        bills, like namings and awareness designations, are set aside from these counts.
      </p>
    </div>
  );
}
