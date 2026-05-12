import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { addToWatchlist, getBillById, removeFromWatchlist } from "@/lib/queries";

type Body = {
  billId?: unknown;
  action?: unknown;
};

export async function POST(request: Request) {
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
    await addToWatchlist(billId);
  } else {
    await removeFromWatchlist(billId);
  }
  revalidatePath("/watchlist");
  return NextResponse.json({ ok: true, billId, action });
}
