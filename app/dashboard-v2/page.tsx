import { permanentRedirect } from "next/navigation";

// HO 311 — the v2 dashboard was promoted to `/`. This route is kept as a
// permanent (308) redirect so bookmarks and any external link to /dashboard-v2
// survive the swap rather than 404. The live composition now lives in
// `app/page.tsx`; the preserved old dashboard sits at `/dashboard-classic`.
export default function DashboardV2Redirect() {
  permanentRedirect("/");
}
