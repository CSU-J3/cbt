import { redirect } from "next/navigation";

// HO 328: /committees merged into the /members two-pane browser — the committee
// rail IS the index now. This route redirects so old bookmarks / in-app links
// resolve. /committee/[systemCode] detail stays (linked from the rail).
export default function CommitteesPage() {
  redirect("/members");
}
