"use client";

import Link from "next/link";
import { useState } from "react";
import type { TopicCrosswalkRow } from "@/lib/lda-rollup";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

// HO 444 → v2 (HO 463) — the /lobbying CBT-topic crosswalk section, now a
// click-through: the same corpus the native issue bars show, re-expressed in
// CBT's 24-topic vocabulary, with each topic bar expanding to its constituent
// LDA issue codes. Each code chip links into the EXISTING Section 2 ?issue=
// drill (drill[code] is precomputed for every corpus code) and scrolls it into
// view (#lobby-drill). A PARALLEL lens beside the native general_issue_code bars;
// the mapping's lossiness is disclosed by showing both. Served O(1) from the
// lda_topic_crosswalk blob; the per-topic code lists are derived page-side by
// grouping rollup.issues under the SAME topicForCode the blob keys on.
//
// Multi-code property: a filing naming codes in two topics counts under each, so
// the bars DON'T sum to the corpus — the header says "by issue focus", never
// "share". Bar scales to the max topic (linear), same as IssueBars.
//
// Responsive: the Clients column drops below Tailwind's `sm` (~640px) — Tailwind
// arbitrary grid tracks (no globals.css coupling, the HO 442 rule).
const GRID =
  "grid items-center gap-x-[14px] grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_64px] " +
  "sm:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_64px_64px]";

export function TopicCrosswalk({
  topics,
  topicCodes,
  selected,
}: {
  topics: TopicCrosswalkRow[];
  topicCodes: Record<string, { code: string; display: string; filings: number }[]>;
  selected: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (topics.length === 0) return null;
  const maxFilings = Math.max(1, ...topics.map((t) => t.filings));

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Lobbying by topic · CBT taxonomy
        </h2>
        <span
          className="text-[11px] leading-snug"
          style={{ color: "var(--text-dim)", fontFamily: "var(--sans)" }}
        >
          The same filings mapped to CBT&rsquo;s 24 topics. Tap a topic to see the
          issue codes it covers &mdash; each drills to who&rsquo;s lobbying it. A
          filing can name several issue areas, so it counts under each; the bars
          don&rsquo;t sum to a share.
        </span>
      </div>
      <div className="border" style={{ borderColor: "var(--border-strong)" }}>
        <div
          className={`${GRID} px-[14px] py-[9px] text-[11px] uppercase tracking-[0.5px]`}
          style={{
            backgroundColor: "var(--bg-panel)",
            borderBottom: "0.5px solid var(--border-strong)",
            color: "var(--text-dim)",
          }}
        >
          <span>Topic</span>
          <span aria-hidden />
          <span className="text-right">Filings</span>
          <span className="hidden text-right sm:block">Clients</span>
        </div>
        {/* HO 492: bounded scroll region so 24 topic rows (and any expanded
            code-chip tray) don't stack full-height; header above stays put. */}
        <ul className="lob-sec-scroll">
          {topics.map((t) => {
            const color = topicColor(t.topic);
            const widthPct = (t.filings / maxFilings) * 100;
            const codes = topicCodes[t.topic] ?? [];
            const isOpen = open === t.topic;
            return (
              <li key={t.topic}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : t.topic)}
                  aria-expanded={isOpen}
                  disabled={codes.length === 0}
                  className={`${GRID} w-full cursor-pointer px-[14px] py-[10px] text-left transition hover:bg-[var(--bg-row-hover)] disabled:cursor-default`}
                  style={{
                    borderBottom: "0.5px solid var(--border-soft)",
                    borderLeft: `3px solid ${isOpen ? "var(--accent-amber)" : "transparent"}`,
                    backgroundColor: isOpen ? "var(--bg-row-hover)" : undefined,
                  }}
                >
                  <span className="flex min-w-0 flex-col leading-[1.2]">
                    <span className="flex items-center gap-[6px]">
                      <span
                        className="text-[10px] leading-none"
                        style={{ color: "var(--text-dim)" }}
                        aria-hidden
                      >
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span className="truncate text-[12px]" style={{ color }}>
                        {topicFullLabel(t.topic)}
                      </span>
                    </span>
                    <span
                      className="pl-[16px] text-[10px] uppercase tracking-[0.5px]"
                      style={{ color: "var(--text-dim)" }}
                    >
                      {topicLabel(t.topic)} · {codes.length} code
                      {codes.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span
                    className="block h-[10px] overflow-hidden rounded-[2px]"
                    style={{ backgroundColor: "var(--bg-row-hover)" }}
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-[2px]"
                      style={{ width: `${widthPct}%`, backgroundColor: color, opacity: 0.6 }}
                    />
                  </span>
                  <span
                    className="text-right text-[12px] tabular-nums"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t.filings.toLocaleString()}
                  </span>
                  <span
                    className="hidden text-right text-[12px] tabular-nums sm:block"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t.distinctClients.toLocaleString()}
                  </span>
                </button>
                {isOpen && codes.length > 0 ? (
                  <div
                    className="flex flex-wrap gap-[6px] px-[14px] pb-[11px] pt-[3px]"
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      borderBottom: "0.5px solid var(--border-soft)",
                    }}
                  >
                    {codes.map((c) => {
                      const active = c.code === selected;
                      return (
                        <Link
                          key={c.code}
                          href={`/lobbying?issue=${encodeURIComponent(c.code)}#lobby-drill`}
                          title={c.display}
                          aria-current={active ? "true" : undefined}
                          className="inline-flex items-center gap-[6px] rounded-[2px] border px-[7px] py-[3px] text-[11px] no-underline transition hover:bg-[var(--bg-row-hover)]"
                          style={{
                            borderColor: active
                              ? "var(--accent-amber)"
                              : "var(--border-strong)",
                            color: active
                              ? "var(--accent-amber)"
                              : "var(--text-secondary)",
                          }}
                        >
                          <span className="font-[600] tracking-[0.3px]">{c.code}</span>
                          <span
                            className="max-w-[18ch] truncate"
                            style={{ color: "var(--text-dim)", fontFamily: "var(--sans)" }}
                          >
                            {c.display}
                          </span>
                          <span
                            className="tabular-nums"
                            style={{ color: "var(--text-dim)" }}
                          >
                            {c.filings.toLocaleString()}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
