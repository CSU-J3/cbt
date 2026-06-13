import Link from "next/link";
import { formatBillId } from "@/lib/format";
import { ALLOWED_TOPICS } from "@/lib/enums";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";
import {
  NEWS_WINDOW_HOURS,
  type NewsSignal,
  type NewsWindowHours,
} from "@/lib/queries";

// HO 151 — filter bar for /bills?mode=news. Single-select chips for
// SOURCE / TOPIC / WINDOW (the news universe is small enough today that
// single-select beats the multi-select comma URL the BILLS-mode
// TopicFilter uses; switching to a comma-list is a future toggle if
// usage demands it). Bill-scoped pill (when ?bill=<id> is set) sits at
// the top with its own ✕ — preserves the HO 130 per-bill semantics.
// SORT renders as a static "Sort · most recent" label — only one value
// at launch, a dropdown shell would be dead chrome.

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "politico", label: "Politico" },
  { value: "the_hill", label: "The Hill" },
  { value: "roll_call", label: "Roll Call" },
];

const WINDOW_LABEL: Record<NewsWindowHours, string> = {
  24: "24H",
  72: "72H",
  168: "7D",
  720: "30D",
};

function billIdLabel(billId: string): string {
  const parts = billId.split("-");
  if (parts.length !== 3) return billId;
  const [, type, num] = parts as [string, string, string];
  const n = Number(num);
  if (Number.isNaN(n)) return billId;
  return formatBillId(type, n);
}

export function NewsFilters({
  source,
  topic,
  windowHours,
  billId,
  signal,
  breakingCount,
  carry,
}: {
  source: string | undefined;
  topic: string | undefined;
  windowHours: NewsWindowHours;
  billId: string | undefined;
  signal: NewsSignal | undefined;
  /** Size of the breaking set in the current SOURCE/WINDOW/TOPIC scope. */
  breakingCount: number;
  /** Params to preserve across chip clicks. Should already exclude
   *  source / topic / window / bill / signal / page — caller owns the policy. */
  carry: URLSearchParams;
}) {
  const buildHref = (overrides: Record<string, string | undefined>) => {
    const sp = new URLSearchParams(carry);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) sp.delete(k);
      else sp.set(k, v);
    }
    sp.delete("page");
    const qs = sp.toString();
    return qs ? `/bills?${qs}` : "/bills";
  };

  return (
    <div className="flex flex-col gap-3">
      {billId ? (
        <div className="filter-chips flex flex-wrap items-center gap-3">
          <span
            className="text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            Bill
          </span>
          <span
            className="inline-flex items-center gap-2 border px-2 py-1 text-[12px] uppercase tracking-[0.5px]"
            style={{
              color: "var(--accent-amber)",
              borderColor: "var(--accent-amber)",
            }}
          >
            <Link
              href={`/bill/${encodeURIComponent(billId)}`}
              className="hover:underline"
              style={{ color: "var(--accent-amber)" }}
            >
              {billIdLabel(billId)}
            </Link>
            <Link
              href={buildHref({ bill: undefined })}
              scroll={false}
              aria-label="Clear bill filter"
              style={{ color: "var(--text-dim)" }}
              className="hover:text-[var(--text-secondary)]"
            >
              ✕
            </Link>
          </span>
        </div>
      ) : null}

      <div className="filter-chips flex flex-wrap items-center gap-3">
        <span
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-dim)" }}
        >
          Source
        </span>
        <Link
          href={buildHref({ source: undefined })}
          scroll={false}
          className="rounded-sm border px-2 py-0.5 text-[12px] font-medium uppercase tracking-[0.5px] transition"
          style={
            source === undefined
              ? {
                  backgroundColor: "var(--bg-row-hover)",
                  color: "var(--accent-amber-bright)",
                  borderColor: "var(--accent-amber)",
                }
              : {
                  color: "var(--text-muted)",
                  borderColor: "var(--border-strong)",
                }
          }
        >
          All
        </Link>
        {SOURCE_OPTIONS.map((s) => {
          const isOn = source === s.value;
          return (
            <Link
              key={s.value}
              href={buildHref({ source: isOn ? undefined : s.value })}
              scroll={false}
              className="rounded-sm border px-2 py-0.5 text-[12px] font-medium uppercase tracking-[0.5px] transition"
              style={
                isOn
                  ? {
                      backgroundColor: "var(--bg-row-hover)",
                      color: "var(--accent-amber-bright)",
                      borderColor: "var(--accent-amber)",
                    }
                  : {
                      color: "var(--text-muted)",
                      borderColor: "var(--border-strong)",
                    }
              }
            >
              {s.label}
            </Link>
          );
        })}

        <span
          className="ml-auto text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-dim)" }}
        >
          Sort · <span style={{ color: "var(--text-muted)" }}>most recent</span>
        </span>
      </div>

      <div className="filter-chips flex flex-wrap items-center gap-3">
        <span
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-dim)" }}
        >
          Window
        </span>
        {NEWS_WINDOW_HOURS.map((h) => {
          const isOn = windowHours === h;
          return (
            <Link
              key={h}
              href={buildHref({ window: String(h) })}
              scroll={false}
              className="rounded-sm border px-2 py-0.5 text-[12px] font-medium uppercase tracking-[0.5px] transition"
              style={
                isOn
                  ? {
                      backgroundColor: "var(--bg-row-hover)",
                      color: "var(--accent-amber-bright)",
                      borderColor: "var(--accent-amber)",
                    }
                  : {
                      color: "var(--text-muted)",
                      borderColor: "var(--border-strong)",
                    }
              }
            >
              {WINDOW_LABEL[h]}
            </Link>
          );
        })}
      </div>

      <div className="filter-chips flex flex-wrap items-center gap-3">
        <span
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-dim)" }}
        >
          Signal
        </span>
        <Link
          href={buildHref({ signal: undefined })}
          scroll={false}
          className="rounded-sm border px-2 py-0.5 text-[12px] font-medium uppercase tracking-[0.5px] transition"
          style={
            signal === undefined
              ? {
                  backgroundColor: "var(--bg-row-hover)",
                  color: "var(--accent-amber-bright)",
                  borderColor: "var(--accent-amber)",
                }
              : {
                  color: "var(--text-muted)",
                  borderColor: "var(--border-strong)",
                }
          }
        >
          All
        </Link>
        <Link
          href={buildHref({ signal: signal === "breaking" ? undefined : "breaking" })}
          scroll={false}
          className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[12px] font-medium uppercase tracking-[0.5px] transition"
          style={
            signal === "breaking"
              ? {
                  backgroundColor: "var(--bg-row-hover)",
                  color: "var(--accent-amber-bright)",
                  borderColor: "var(--accent-amber)",
                }
              : {
                  color: "var(--text-muted)",
                  borderColor: "var(--border-strong)",
                }
          }
        >
          Breaking
          <span
            className="tabular-nums"
            style={{
              color:
                signal === "breaking"
                  ? "var(--accent-amber-bright)"
                  : "var(--text-dim)",
            }}
          >
            {breakingCount}
          </span>
        </Link>
      </div>

      <div className="filter-chips flex flex-wrap items-center gap-1">
        <span
          className="mr-2 text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-dim)" }}
        >
          Topic
        </span>
        {ALLOWED_TOPICS.map((t) => {
          const isOn = topic === t;
          const color = topicColor(t);
          const style = isOn
            ? { backgroundColor: color, color: "#0a0e14", borderColor: color }
            : { color, borderColor: color };
          return (
            <Link
              key={t}
              href={buildHref({ topic: isOn ? undefined : t })}
              scroll={false}
              title={topicFullLabel(t)}
              className="rounded-sm border px-1.5 py-0.5 text-[12px] font-medium uppercase tracking-[0.5px] transition"
              style={style}
            >
              {topicLabel(t)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
