"use client";

import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";

// HO 509: the shared record box — a tabbed shell that collapses a stack of
// full-width detail sections into one fixed-height box. Mirrors ActivityTabs
// (HO 132/249): a client island that holds ONLY tab state and takes
// pre-rendered ReactNodes as props, so the server page keeps every fetch.
// /bill/[id] is the second consumer (HO 510) — which is why tab ORDER and
// membership are the page's contract, never the component's: keeping ranking
// out of here is what makes it reusable.
export type RecordTab = {
  key: string; // stable — used as the React key + panel id
  label: string; // "Bills"
  count?: number; // shown in the strip; 0 dims the tab. Omit for a countless
  //                 tab (e.g. Scorecard: present-or-absent, never a count).
  outLabel?: string; // "View all 53 bills →" — omit for no out-link
  outHref?: string; // required when outLabel is set
  content: ReactNode; // rendered by the server page
};

export function RecordTabs({
  tabs,
  ariaLabel,
}: {
  tabs: RecordTab[];
  ariaLabel: string;
}) {
  const [active, setActive] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The page decides membership; the component never decides what to show.
  if (tabs.length === 0) return null;

  // Backstop an out-of-range index if the tab set ever shrinks between renders
  // (it doesn't today — membership is stable per request).
  const activeIdx = active < tabs.length ? active : 0;
  const activeTab = tabs[activeIdx];
  if (!activeTab) return null; // unreachable (length checked) — satisfies tsc

  function select(i: number) {
    setActive(i);
    // Reset scroll so a swap into a long list doesn't inherit the prior
    // panel's scroll offset (the fixed-height body keeps a persistent
    // scrollbar). Panels all stay mounted (below), so open row state survives.
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }

  const external = activeTab.outHref?.startsWith("http");

  return (
    <div className="rec">
      <div className="rec-hdr" role="tablist" aria-label={ariaLabel}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`rec-tab-${t.key}`}
            aria-controls={`rec-panel-${t.key}`}
            aria-current={i === activeIdx ? "page" : undefined}
            data-empty={t.count === 0 ? "true" : undefined}
            className="rec-tab"
            onClick={() => select(i)}
          >
            {t.label}
            {t.count != null ? (
              <span className="count">({t.count.toLocaleString()})</span>
            ) : null}
          </button>
        ))}
        {/* Out-link swaps with the active tab; nothing here when it has none.
            Internal hrefs go through next/link (client nav + prefetch — the two
            internal out-links are /bills?sponsor= and /trades?member=); a plain
            <a> is external-only, so it keeps target/rel. */}
        {activeTab.outLabel && activeTab.outHref ? (
          external ? (
            <a
              className="rec-out"
              href={activeTab.outHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {activeTab.outLabel}
            </a>
          ) : (
            <Link className="rec-out" href={activeTab.outHref}>
              {activeTab.outLabel}
            </Link>
          )
        ) : null}
      </div>

      {/* All panels mount; inactive ones carry `hidden`. NOT conditional
          mounting — the row lists are client components with their own expand
          state, and unmounting would drop an open row on every tab swap. */}
      <div className="rec-body" ref={bodyRef}>
        {tabs.map((t, i) => (
          <div
            key={t.key}
            id={`rec-panel-${t.key}`}
            role="tabpanel"
            aria-labelledby={`rec-tab-${t.key}`}
            className="rec-panel"
            hidden={i !== activeIdx}
          >
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}
