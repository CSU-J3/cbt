// HO 151 — /news aliases into the unified Bills|News surface's NEWS mode
// (HO 184 renamed /feed → /bills). NEWS mode is canonical; this route only
// redirects so HO 130's existing inbound link from MediaAttentionCell (and
// any external bookmarks) still land on a working surface. `?bill=<id>` is
// carried through to preserve the per-bill scope.
import { redirect } from "next/navigation";
import { sanitizeBillId } from "@/lib/queries";

type SearchParams = {
  bill?: string;
};

export default async function NewsAliasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const billId = sanitizeBillId(params.bill);
  const target = billId
    ? `/bills?mode=news&bill=${encodeURIComponent(billId)}`
    : "/bills?mode=news";
  redirect(target);
}
