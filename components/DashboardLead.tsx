import { formatLastUpdated } from "@/lib/format";
import { getDashboardLead } from "@/lib/queries";

// Corpus-wide prose summary at the top of the dashboard. Generated once per
// cron tick (lib/dashboard-lead.ts). Hides itself entirely if no lead exists
// yet — no placeholder.
export async function DashboardLead() {
  const lead = await getDashboardLead();
  if (!lead) return null;

  return (
    <div className="dashboard-lead">
      <p className="dashboard-lead-label">
        <span style={{ color: "var(--text-secondary)" }}>Lead</span>
        <span style={{ color: "var(--text-dim)" }}>
          {" · "}Last updated {formatLastUpdated(lead.updatedAt)}
        </span>
      </p>
      <p className="dashboard-lead-prose">{lead.text}</p>
    </div>
  );
}
