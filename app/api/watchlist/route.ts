import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addToWatchlist, getBillById, removeFromWatchlist } from "@/lib/queries";

type Body = {
  billId?: unknown;
  action?: unknown;
};

export async function POST(request: Request) {
  // HO 356 (A2): the watchlist is the one auth-gated surface. Anonymous → 401;
  // the client (use-watch-toggle) reacts to the 401 by sending the user to
  // GitHub sign-in. Authed → write under session.user.id.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const billId = typeof body.billId === "string" ? body.billId : null;
  const action = typeof body.action === "string" ? body.action : null;
  if (!billId || (action !== "add" && action !== "remove")) {
    return NextResponse.json(
      { error: "billId (string) and action ('add' | 'remove') are required" },
      { status: 400 },
    );
  }

  const bill = await getBillById(billId);
  if (!bill) {
    return NextResponse.json({ error: "bill not found" }, { status: 404 });
  }

  if (action === "add") {
    await addToWatchlist(userId, billId);
  } else {
    await removeFromWatchlist(userId, billId);
  }
  // No revalidateTag: the read helpers (getWatchlistBills / getWatchedBillIds)
  // are uncached now (HO 356), so there's no cached tag to flush. The client's
  // router.refresh() re-runs the now-uncached server reads after a write.
  return NextResponse.json({ ok: true, billId, action });
}
