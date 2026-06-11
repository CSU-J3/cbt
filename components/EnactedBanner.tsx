// HO 232 (design item 6) — thin full-width band under the weekly-report
// snapshot, above the 56/44 grid. Shows the bills that reached `enacted` in
// the last 7 days, IDs linked in the enacted green. The empty state is
// VISIBLE by design — at N=0 it still renders, muted, as "ENACTED THIS WEEK ·
// NONE" (the design wants the zero state seen, not hidden). IDs truncate after
// ID_CAP with a "+N more →" into the enacted-filtered feed.
import Link from "next/link";
import { getEnactedThisWeek } from "@/lib/queries";

const ID_CAP = 5;

export async function EnactedBanner() {
  const bills = await getEnactedThisWeek();
  const n = bills.length;

  if (n === 0) {
    return (
      <section
        className="enacted-banner enacted-banner--empty"
        aria-label="Enacted this week"
      >
        <span className="enacted-banner-label">Enacted This Week</span>
        <span className="enacted-banner-none">· None</span>
      </section>
    );
  }

  const shown = bills.slice(0, ID_CAP);
  const remaining = n - shown.length;

  return (
    <section className="enacted-banner" aria-label="Enacted this week">
      <span className="enacted-banner-label">
        Enacted This Week{" "}
        <span className="enacted-banner-count">({n.toLocaleString()})</span>
      </span>
      <span className="enacted-banner-ids">
        {shown.map((b) => (
          <Link key={b.id} href={`/bill/${b.id}`} className="enacted-banner-id">
            {b.billType.toUpperCase()} {b.billNumber}
          </Link>
        ))}
        {remaining > 0 ? (
          <Link href="/bills?stage=enacted" className="enacted-banner-more">
            +{remaining.toLocaleString()} more →
          </Link>
        ) : null}
      </span>
    </section>
  );
}
