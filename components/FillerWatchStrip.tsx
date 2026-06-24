"use client";

import { useState } from "react";
import type { FillerWatchData } from "@/lib/queries";

// HO 348 — collapsible CEREMONIAL · NON-BINDING strip on /patterns, between the
// meta line and the blurb. Click-to-toggle (instant, no animation, matching the
// app's expand rows). Distinct component from the dashboard weekly bar — different
// data, different layout, not shared. All-mono, no new tokens. Framing is
// "non-binding," not "stalled," so the figure survives a poke at the denominator:
// the non-binding count of the four genuinely cannot become law by nature.
export function FillerWatchStrip({ data }: { data: FillerWatchData }) {
  const [open, setOpen] = useState(false);
  const { filed, pastCommittee, enacted, nonBinding, d, r, i } = data;

  const died = Math.max(0, filed - pastCommittee - enacted);
  const pastPct = filed ? ((pastCommittee / filed) * 100).toFixed(1) : "0.0";
  const diedPct = filed ? ((died / filed) * 100).toFixed(1) : "0.0";
  const partisan = d + r;
  const pctD = partisan ? Math.round((d / partisan) * 100) : 0;
  const pctR = partisan ? Math.round((r / partisan) * 100) : 0;
  const enactedNote = enacted === 1 ? "a post office" : `${enacted} laws`;

  return (
    <section className={`filler-watch${open ? " open" : ""}`}>
      <button
        type="button"
        className="filler-watch-row"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="filler-watch-label">Ceremonial · non-binding</span>
        <span className="filler-watch-summary">
          <span className="fw-punch">{filed.toLocaleString()} filed</span>
          {" · "}
          <span className="fw-punch">
            {enacted} enacted ({enactedNote})
          </span>
          {" · "}
          <span className="fw-texture">
            {pastCommittee} past committee · {pastPct}% · sponsors {pctD}% D /{" "}
            {pctR}% R
          </span>
        </span>
        <span className="filler-watch-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="filler-watch-body">
          <div className="fw-attrition">
            {filed.toLocaleString()} filed → {pastCommittee.toLocaleString()} past
            committee ({pastPct}%) → {enacted} enacted ({enactedNote})
          </div>
          <p className="fw-register">
            Sense-of-Congress, awareness designations, and honoring resolutions
            are non-binding by nature, {nonBinding.toLocaleString()} of the{" "}
            {filed.toLocaleString()}. Only facility namings can become law, and{" "}
            {enacted === 1 ? "one did" : `${enacted.toLocaleString()} did`}. The
            other ~{Math.round(Number(diedPct))}% never clear committee.
          </p>
          <div className="fw-footer">
            <span>
              Sponsors {d.toLocaleString()} D · {r.toLocaleString()} R ·{" "}
              {i.toLocaleString()} IND
            </span>
            <span>
              Split {pctD}% D / {pctR}% R
            </span>
            <span>
              Died in committee {died.toLocaleString()} · {diedPct}%
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
