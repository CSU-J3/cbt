// HO 252 — deploy-verification probe. Returns the git commit SHA that Vercel
// built this deployment from, so `npm run verify:deploy` can poll prod after a
// push until the served SHA matches local HEAD — proving that exact commit is
// live. Pure env read (no DB, can't cold-start-500), and explicitly uncached:
// a cached version route would serve a stale SHA and defeat the poll.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
      builtAt: process.env.VERCEL_DEPLOYMENT_BUILD_TIME ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
