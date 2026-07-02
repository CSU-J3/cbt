import { formatRelativeAge } from "@/lib/format";
import type { RaceNewsItem } from "@/lib/queries";

// HO 398 — one race-news row on the race detail hub. Reuses the /news feed row
// idiom (headline · source · age) but drops the bill-id cell: an observation
// keyed to the race's incumbent has no bill (that's the whole point of the
// rescue population). Same `.news-row` chrome + `.source`/`.age` classes via the
// `--no-bill` grid modifier (globals.css), so it stays visually identical to the
// news feed without a new visual idiom. Pure presentational (no async) so it's
// safe inside RaceHubBody's shared server/client tree.

// Mirrors NewsRow's age tiers: fresh-amber, then secondary, then muted past a day.
function ageColor(hours: number): string {
  if (hours < 6) return "var(--accent-amber-bright)";
  if (hours < 24) return "var(--text-secondary)";
  return "var(--text-muted)";
}

function ageHours(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}

export function RaceNewsRow({ item }: { item: RaceNewsItem }) {
  const hours = ageHours(item.observedAt);
  return (
    <div className="news-row news-row--no-bill">
      <span className="news-headline-cell">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-[14px]"
          style={{ color: "var(--text-primary)" }}
        >
          {item.title}
        </a>
      </span>
      <span className="source">{item.publisher}</span>
      <span className="age" style={{ color: ageColor(hours) }}>
        {formatRelativeAge(item.observedAt)}
      </span>
    </div>
  );
}
