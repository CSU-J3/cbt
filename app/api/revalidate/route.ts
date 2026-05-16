import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function authorize(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 500 },
    );
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

const ALLOWED_TAGS = new Set(["bills", "reports"]);

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const tag = new URL(request.url).searchParams.get("tag") ?? "bills";
  if (!ALLOWED_TAGS.has(tag)) {
    return NextResponse.json(
      { error: `tag must be one of: ${[...ALLOWED_TAGS].join(", ")}` },
      { status: 400 },
    );
  }
  revalidateTag(tag);
  return NextResponse.json({ ok: true, tag });
}
