// HO 421: DW-NOMINATE ideology readout on the member hub. A compact 1-D
// left/right axis on the TRUE DW-NOMINATE domain (−1..+1) — fixed, not scaled to
// the chamber's min/max, so a marker is comparable across members and chambers.
// Div + CSS in the terminal idiom (mono, tracked uppercase labels, --party-*
// tokens). Server component — no interactivity.
//
// The member's marker is the prominent element; both party medians for the
// member's chamber render as thin reference ticks so the marker reads as
// moderate-vs-extreme within its party and against the other. The marker carries
// a hairline outline + higher z-order so it stays legible when it sits on top of
// a party median (most members sit near their median).
import type { MemberIdeology as MemberIdeologyType } from "@/lib/queries";

// DW-NOMINATE domain is [−1, +1], mapped onto an INSET band of the track
// (2%..98%) rather than the full 0..100% — the 2% end margins keep a marker at
// an extreme (e.g. +0.97) and its below-rail caret from clipping the track edge
// or fusing with an end label. The map stays linear over the fixed domain, so
// positions remain comparable across members. Clamped as a backstop for any
// out-of-domain estimate.
const INSET = 2;
function pos(v: number): number {
  const raw = INSET + ((v + 1) / 2) * (100 - 2 * INSET);
  return Math.max(INSET, Math.min(100 - INSET, raw));
}

const PARTY_COLOR: Record<string, string> = {
  D: "var(--party-democrat)",
  R: "var(--party-republican)",
  I: "var(--party-independent)",
};

export function MemberIdeology({
  ideology,
  party,
}: {
  ideology: MemberIdeologyType | null;
  party: "D" | "R" | "I" | null;
}) {
  // Empty state: no row at all, or a row with too few votes to estimate dim1.
  if (!ideology || ideology.dim1 == null) {
    return (
      <div>
        <div
          className="text-[11px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          Ideology · DW-NOMINATE
        </div>
        <div
          className="mt-1 text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-dim)" }}
        >
          No ideology score yet · too few votes this Congress
        </div>
      </div>
    );
  }

  const { dim1, dim2, conditional, demMedian, repMedian } = ideology;
  const markerColor = PARTY_COLOR[party ?? "I"] ?? "var(--party-independent)";
  const isProvisional = conditional === 1;

  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        Ideology · DW-NOMINATE
      </div>

      {/* The axis is vertically banded so a member sitting ON their own party
          median stays legible (color + x both coincide there). Party medians are
          short ticks STRICTLY ABOVE the rail (with a contrasting core so a
          same-color coinciding tick still reads on top of the member bar); the
          member's identity is the caret STRICTLY BELOW the rail — the two never
          share vertical space. The above-rail member bar is a secondary readout. */}
      <div
        className="ideology-axis"
        role="img"
        aria-label={`DW-NOMINATE first dimension ${dim1.toFixed(3)} on a −1 (liberal) to +1 (conservative) scale`}
      >
        <div className="ideology-axis-track">
          <span className="ideology-axis-rail" aria-hidden />
          <span className="ideology-axis-zero" aria-hidden />
          {demMedian != null ? (
            <span
              className="ideology-axis-median"
              style={{
                left: `${pos(demMedian)}%`,
                backgroundColor: "var(--party-democrat)",
              }}
              title={`Democratic median ${demMedian.toFixed(3)}`}
              aria-hidden
            >
              <span className="ideology-axis-median-core" />
            </span>
          ) : null}
          {repMedian != null ? (
            <span
              className="ideology-axis-median"
              style={{
                left: `${pos(repMedian)}%`,
                backgroundColor: "var(--party-republican)",
              }}
              title={`Republican median ${repMedian.toFixed(3)}`}
              aria-hidden
            >
              <span className="ideology-axis-median-core" />
            </span>
          ) : null}
          {/* member: secondary bar above the rail... */}
          <span
            className="ideology-axis-bar"
            style={{ left: `${pos(dim1)}%`, backgroundColor: markerColor }}
            aria-hidden
          />
          {/* ...and the primary identity caret below it */}
          <span
            className="ideology-axis-caret"
            style={{ left: `${pos(dim1)}%`, borderBottomColor: markerColor }}
            title={`This member ${dim1.toFixed(3)}`}
            aria-hidden
          />
        </div>
        <div className="ideology-axis-ends">
          <span>Liberal −1</span>
          <span>+1 Conservative</span>
        </div>
      </div>

      {/* Numeric readout. dim1 is the headline economic left/right dimension;
          dim2 rides as a low-key secondary numeric (no second axis). */}
      <div
        className="mt-2 text-[12px] uppercase tracking-[0.5px] tabular-nums"
        style={{ color: "var(--text-dim)" }}
      >
        <span style={{ color: "var(--text-muted)" }}>Left/right (dim 1)</span>
        {" · "}
        <span style={{ color: "var(--text-secondary)" }}>
          {dim1 > 0 ? "+" : ""}
          {dim1.toFixed(3)}
        </span>
        {isProvisional ? (
          <span
            className="ml-1.5 rounded-[2px] px-1 py-px text-[10px] font-medium"
            style={{
              color: "var(--accent-amber-bright)",
              border: "1px solid var(--accent-amber)",
            }}
          >
            Provisional
          </span>
        ) : null}
        {dim2 != null ? (
          <>
            {" · "}
            <span style={{ color: "var(--text-muted)" }}>dim 2</span>{" "}
            <span>
              {dim2 > 0 ? "+" : ""}
              {dim2.toFixed(3)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
