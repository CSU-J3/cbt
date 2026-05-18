import {
  type TopicChamberCount,
  getTopicMixByChamber,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

// Topics-per-column cap before collapsing into OTHER. 8 is the legible
// ceiling for a glance read and matches the existing topic-mix-block ranking.
const ROW_CAP = 8;

type RankedRow = {
  topic: string;
  houseCount: number;
  senateCount: number;
};

// Collapses everything past ROW_CAP into a single OTHER row keyed by the
// literal string "other" (matches the topic-colors catchall). Rows arrive
// sorted by combined count DESC from the query, so the first ROW_CAP entries
// are the most-active topics across both chambers.
function rankRows(rows: TopicChamberCount[]): RankedRow[] {
  if (rows.length <= ROW_CAP) {
    return rows.map((r) => ({
      topic: r.topic,
      houseCount: r.houseCount,
      senateCount: r.senateCount,
    }));
  }
  const head = rows.slice(0, ROW_CAP).map((r) => ({
    topic: r.topic as string,
    houseCount: r.houseCount,
    senateCount: r.senateCount,
  }));
  const tail = rows.slice(ROW_CAP);
  const other: RankedRow = {
    topic: "other",
    houseCount: tail.reduce((s, r) => s + r.houseCount, 0),
    senateCount: tail.reduce((s, r) => s + r.senateCount, 0),
  };
  return [...head, other];
}

function ChamberColumn({
  label,
  rows,
  countKey,
  max,
}: {
  label: string;
  rows: RankedRow[];
  countKey: "houseCount" | "senateCount";
  max: number;
}) {
  return (
    <div>
      <div className="column-label">{label}</div>
      <div className="flex flex-col">
        {rows.map((r) => {
          const count = r[countKey];
          const width = max > 0 ? (count / max) * 100 : 0;
          const color = topicColor(r.topic);
          return (
            <div
              key={r.topic}
              className="topic-chamber-row"
              title={topicFullLabel(r.topic)}
            >
              <span className="topic" style={{ color }}>
                {topicLabel(r.topic)}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{
                    width: `${width}%`,
                    backgroundColor: color,
                  }}
                  aria-hidden
                />
              </span>
              <span className="count">{count.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export async function TopicMixByChamber() {
  const rows = await getTopicMixByChamber();
  if (rows.length === 0) return null;

  const ranked = rankRows(rows);
  // Single scale across both columns: max of any (chamber, topic) value so
  // House and Senate bars are directly comparable. A topic the House files
  // 2x more of has a visibly 2x longer bar.
  const max = ranked.reduce(
    (m, r) => Math.max(m, r.houseCount, r.senateCount),
    0,
  );
  const total = ranked.reduce(
    (s, r) => s + r.houseCount + r.senateCount,
    0,
  );

  return (
    <section className="dashboard-pane mt-3">
      <div className="mb-2 flex items-baseline justify-between">
        <p
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--accent-amber)" }}
        >
          Topic mix · by chamber
        </p>
        <p
          className="text-[11px] uppercase tracking-[0.5px] tabular-nums"
          style={{ color: "var(--text-dim)" }}
        >
          {total.toLocaleString()} non-ceremonial bills
        </p>
      </div>

      <div className="topic-chamber-mix">
        <ChamberColumn
          label="House"
          rows={ranked}
          countKey="houseCount"
          max={max}
        />
        <ChamberColumn
          label="Senate"
          rows={ranked}
          countKey="senateCount"
          max={max}
        />
      </div>
    </section>
  );
}
