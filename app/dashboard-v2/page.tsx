import { permanentRedirect } from "next/navigation";

// HO 311 — the v2 dashboard was promoted to `/`. This route is kept as a
// permanent (308) redirect so bookmarks and any external link to /dashboard-v2
// survive the swap rather than 404. The live composition lives in `app/page.tsx`.
// (The pre-swap dashboard, preserved unlinked on its own classic route, was
// removed at HO 608 — this redirect is the only survivor of that pair.)
export default function DashboardV2Redirect() {
  permanentRedirect("/");
}
