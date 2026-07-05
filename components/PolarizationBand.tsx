// HO 424: chamber polarization band — ideology surface 1 of 3, the full-width
// dashboard cousin of the HO 421 member readout. Two rails (HOUSE over SENATE)
// showing each party's DW-NOMINATE dim1 median as a positioned tick on the fixed
// −1..+1 domain, with an amber line spanning the two medians so the gap is
// visible, and the gap magnitude as the per-rail hero figure. Reuses the HO 421
// `pos()` 2%-inset rule and the `--ideology-axis-*` token family at chamber-
// aggregate scale (no per-member marker). Server component — no interactivity.
import Link from "next/link";
import type { PolarizationBand as PolarizationBandType, PolarizationRail } from "@/lib/queries";

// Same fixed-domain map as MemberIdeology (HO 421): DW-NOMINATE [−1,+1] onto a 2%
// inset band so an extreme median doesn't clip the track edge. Linear over the
// fixed domain, so the two rails are comparable.
const INSET = 2;
function pos(v: number): number {
  const raw = INSET + ((v + 1) / 2) * (100 - 2 * INSET);
  return Math.max(INSET, Math.min(100 - INSET, raw));
}

function fmt(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function Rail({ label, rail }: { label: string; rail: PolarizationRail }) {
  const { dem, rep, gap } = rail;
  const complete = dem != null && rep != null;
  return (
    <div className="pol-band-rail">
      <div className="pol-band-rail-label">
        <span className="pol-band-chamber">{label}</span>
        {complete ? (
          <span className="pol-band-nums tabular-nums">
            <span style={{ color: "var(--party-democrat)" }}>D {fmt(dem)}</span>
            {" · "}
            <span style={{ color: "var(--party-republican)" }}>R {fmt(rep)}</span>
          </span>
        ) : null}
      </div>

      <div className="pol-band-track">
        <span className="pol-band-track-rail" aria-hidden />
        <span className="pol-band-track-zero" aria-hidden />
        {complete ? (
          <>
            {/* amber dimension line spanning the two medians — the gap made visible */}
            <span
              className="pol-band-gapline"
              style={{
                left: `${pos(Math.min(dem, rep))}%`,
                width: `${pos(Math.max(dem, rep)) - pos(Math.min(dem, rep))}%`,
              }}
              aria-hidden
            />
            <span
              className="pol-band-tick"
              style={{ left: `${pos(dem)}%`, backgroundColor: "var(--party-democrat)" }}
              title={`Democratic median ${dem.toFixed(3)}`}
              aria-hidden
            />
            <span
              className="pol-band-tick"
              style={{ left: `${pos(rep)}%`, backgroundColor: "var(--party-republican)" }}
              title={`Republican median ${rep.toFixed(3)}`}
              aria-hidden
            />
          </>
        ) : null}
      </div>

      <div className="pol-band-gap">
        {gap != null ? (
          <span className="pol-band-gap-figure tabular-nums">{gap.toFixed(2)}</span>
        ) : (
          <span className="pol-band-gap-empty">—</span>
        )}
        <span className="pol-band-gap-label">GAP</span>
      </div>
    </div>
  );
}

export function PolarizationBand({ band }: { band: PolarizationBandType }) {
  return (
    <section className="pol-band" aria-label="Chamber polarization on DW-NOMINATE first dimension">
      <div className="pol-band-head">
        <span className="pol-band-title">POLARIZATION · 119TH</span>
        <span className="pol-band-desc">party median distance on dim1</span>
      </div>

      <Rail label="HOUSE" rail={band.house} />
      <Rail label="SENATE" rail={band.senate} />

      {/* shared axis, labeled once under both rails */}
      <div className="pol-band-axis">
        <span>LIBERAL −1</span>
        <span>CONSERVATIVE +1</span>
      </div>

      <div className="pol-band-foot">
        <span className="tabular-nums">{band.scored.toLocaleString()}</span> scored ·{" "}
        <span className="tabular-nums">{band.unscored.toLocaleString()}</span> unscored (too few
        votes) · Voteview 119th
        <Link href="/members" className="pol-band-link">
          member ideology →
        </Link>
      </div>
    </section>
  );
}
