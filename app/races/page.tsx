import { permanentRedirect } from "next/navigation";

// HO 333: /races + /primaries consolidated into the single Electoral surface.
// 308 permanent redirect so bookmarks / in-app links survive. The competitive
// map, hero band, and LIST view all moved to /electoral; the timeline band is
// new there. /race/[id] (the per-race hub) is unaffected and stays put.
export default function RacesPage() {
  permanentRedirect("/electoral");
}
