import { permanentRedirect } from "next/navigation";

// HO 333: the primary calendar is now the timeline band on the consolidated
// Electoral surface. 308 permanent redirect so bookmarks / in-app links survive.
// (The standalone primaries recency map + its district modal/scrubber, HO 226,
// are superseded by the timeline — left unreferenced, see backlog open loops.)
export default function PrimariesPage() {
  permanentRedirect("/electoral");
}
