import type { TopicCrosswalkRow } from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

// HO 444 — the /lobbying CBT-topic crosswalk section. The same corpus the native
// issue bars show, re-expressed in CBT's 24-topic vocabulary — the first time
// "what's lobbied" reads in the same units as the dashboard's bill-topic mix. A
// PARALLEL lens, not a replacement: it sits right after the native `general_issue_code`
// bars, and the lossiness of the mapping is disclosed by showing both.
//
// Ranked bars mirroring IssueBars, but topic-COLORED + topic-LABELED (this is the
// topic lens, so it uses CBT's per-topic color + abbrev system). Non-interactive
// in v1 — there's no topic-keyed drill (the per-code drill is issue-code-keyed). A
// click-through (topic → its constituent issue codes → their existing drills) is a
// clean v2. Server component; served O(1) from the lda_topic_crosswalk blob.
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

export function TopicCrosswalk({ topics }: { topics: TopicCrosswalkRow[] }) {
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
          The same filings mapped to CBT&rsquo;s 24 topics. A filing can name
          several issue areas, so it counts under each — the bars don&rsquo;t sum
          to a share.
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
        <ul>
          {topics.map((t) => {
            const color = topicColor(t.topic);
            const widthPct = (t.filings / maxFilings) * 100;
            return (
              <li key={t.topic}>
                <div
                  className={`${GRID} px-[14px] py-[10px]`}
                  style={{ borderBottom: "0.5px solid var(--border-soft)" }}
                >
                  <span className="flex min-w-0 flex-col leading-[1.2]">
                    <span className="truncate text-[12px]" style={{ color }}>
                      {topicFullLabel(t.topic)}
                    </span>
                    <span
                      className="text-[10px] uppercase tracking-[0.5px]"
                      style={{ color: "var(--text-dim)" }}
                    >
                      {topicLabel(t.topic)}
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
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
