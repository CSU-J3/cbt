import "dotenv/config";
import {
  generateDashboardLead,
  writeDashboardLead,
} from "../lib/dashboard-lead";

// Mirrors the sync cron's revalidateTag("bills") (app/api/sync/route.ts), but
// from a CLI we can't call next/cache directly — the cache lives in the Next
// server process. Same shape as scripts/classify-ceremonial.ts: POST to the
// deployed /api/revalidate, soft-fail if env vars aren't set.
async function revalidateBillsCache(): Promise<void> {
  const url = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) {
    console.log(
      "skipping cache revalidation: set REVALIDATE_URL (e.g. https://<deploy>/api/revalidate or http://localhost:3000/api/revalidate) and CRON_SECRET to auto-invalidate.",
    );
    return;
  }
  try {
    const target = `${url}?tag=bills`;
    const res = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) {
      console.warn(
        `revalidate POST ${target} -> ${res.status}: ${await res.text()}`,
      );
      return;
    }
    console.log(`revalidated bills cache via ${target}`);
  } catch (err) {
    console.warn(`revalidate failed: ${(err as Error).message}`);
  }
}

async function main() {
  const text = await generateDashboardLead();
  console.log("Generated lead:\n");
  console.log(text);
  console.log("\nWriting to DB...");
  await writeDashboardLead(text);
  await revalidateBillsCache();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
