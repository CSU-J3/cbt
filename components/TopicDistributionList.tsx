"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type MouseEvent } from "react";
import type { TopicDatum } from "@/components/DashboardTopicTreemap";

// HO 627 — BY TOPIC as a RANKED BAR LIST, per the committed mock
// (docs/design/dashboard-layout-target.html:304-313: `.dsub` "BY TOPIC" over a
// run of `.dist-row` label · bar · count rows, the same shape as BY STAGE above
// it). The mock wins over the shipped treemap, which is the standing precedent.
//
// WHY A LIST AND NOT THE TREEMAP HERE: the panel now shows stage AND topic
// stacked instead of hiding one behind a tab, so the two halves have to read as
// one panel. A squarified treemap beside a bar run reads as two unrelated
// widgets, and it cannot share the vertical rhythm the stacked layout depends
// on. DashboardTopicTreemap is NOT deleted — it stays exported and unchanged; it
// simply has no dashboard caller now.
//
// The interaction contract is copied from StageFunnel deliberately, so the two
// halves of one panel behave identically: a plain click toggles `?topics=<id>`
// via router.push(scroll:false); a modified / non-primary click follows the
// wrapping <a href> to /bills natively. Same param key the treemap wrote
// ("topics"), so existing links and the ActiveFilterStrip keep working.
export function TopicDistributionList({
  data,
  basePath = "/",
  limit = 8,
}: {
  data: TopicDatum[];
  basePath?: string;
  /** The mock shows 7; 8 keeps one more row without changing the rhythm. */
  limit?: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("topics");

  const rows = data.slice(0, limit);
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  const anySelected = !!current && rows.some((r) => r.id === current);

  function buildHref(base: string, value: string | null): string {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete("topics");
    else next.set("topics", value);
    const qs = next.toString();
    return qs ? `${base}?${qs}` : base;
  }

  function handleClick(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    router.push(href, { scroll: false });
  }

  if (rows.length === 0) return null;

  return (
    // data-viz-row: same exemption as StageFunnel and for the same reason — a row
    // here is label · bar · value on a SHARED AXIS (every bar starts at the same
    // origin and is scaled to one max), so the space between a short bar and its
    // number IS the encoding, not a C1 stretch. The audit counts these on its
    // M1x line rather than scoring or silently skipping them. The curve the
    // exemption rule requires is in the HO 627 HALT.
    <ul
      className="topic-dist"
      data-viz-row
      role="list"
      aria-label="Topic distribution"
    >
      {rows.map((t) => {
        const isSelected = current === t.id;
        const dimmed = anySelected && !isSelected;
        const widthPct = Math.max((t.count / maxCount) * 100, 2.2);
        const tooltip = `${t.fullName ?? t.label} · ${t.count.toLocaleString()} bills · click to filter`;
        const dashHref = isSelected
          ? buildHref(basePath, null)
          : buildHref(basePath, t.id);
        return (
          <li key={t.id}>
            <a
              href={buildHref("/bills", t.id)}
              onClick={(e) => handleClick(e, dashHref)}
              title={tooltip}
              aria-label={tooltip}
              aria-current={isSelected ? "true" : undefined}
              className={`topic-dist-row${isSelected ? " is-selected" : ""}${
                dimmed ? " is-dimmed" : ""
              }`}
            >
              <span className="topic-dist-label">{t.label}</span>
              <span className="topic-dist-track">
                <span
                  className="topic-dist-bar"
                  style={{ width: `${widthPct}%`, backgroundColor: t.color }}
                  aria-hidden
                />
              </span>
              <span className="topic-dist-count">
                {t.count.toLocaleString()}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
