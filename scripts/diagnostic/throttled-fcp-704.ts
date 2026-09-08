// HO 704 — FIRST-CONTENTFUL-PAINT UNDER A THROTTLED DOCUMENT, the harness that
// priced candidate (a) and got it declined.
//
// WHAT IT READS. Per route, medians of five loads: FP, FCP, DCL, the
// painted-but-blank window (FCP - FP), the document's ENCODED size, and the
// transfer floor that size implies at the emulated throughput. Its whole job is
// the FP/FCP SPLIT: a build that streams its page segment behind a Suspense
// boundary paints an empty shell early and the content at last byte, so FP
// improves while FCP regresses. A build that paints progressively reads
// FP == FCP and blank == 0.
//
// WHY IT EXISTS. HO 704 wrapped {children} in <Suspense fallback={null}> in the
// root layout to give a hydration replay a cursor-reset point (the HO 702
// cause). It worked -- t2(unfixed) 6/36 fires -> t2(fixed) 0/36 -- and was
// DECLINED on what this harness measured: the boundary suspends on the SERVER,
// so React defers the segment into <div hidden id="S:0"> behind a $RC
// completion. Measured 2026-09-08 against a local production build:
//
//   1500 kbit/s, 20ms   /         unfixed FCP 272ms  blank 0     -> fixed 656ms  blank 592ms
//                       /members  unfixed FCP 300ms  blank 0     -> fixed 2880ms blank 2560ms
//   10 Mbit/s, 100ms    /         unfixed FCP 184ms  blank 0     -> fixed 500ms  blank 352ms
//                       /members  unfixed FCP 316ms  blank 0     -> fixed 784ms  blank 504ms
//
// Unfixed FCP is nearly flat across document size and throughput (272/300/184/
// 316) -- it paints as bytes arrive. Fixed FCP tracks the COMPLETED transfer
// (floor 551 -> 656, floor 2394 -> 2880). That is the cost, and it scales with
// document size and inversely with bandwidth.
//
// LOCALHOST CANNOT SEE THIS AND WILL TELL YOU THE FIX IS CHEAP. Unthrottled, the
// same pair read +256ms on / and +388ms on /members -- parse-and-swap alone,
// the FLOOR of the cost rather than the cost. Any future boundary above the page
// segment is measured HERE, throttled, not on localhost.
//
// THE BYTE SOURCE IS `request().sizes().responseBodySize`, AND THAT IS NOT A
// DETAIL. `response.body()` returns the DECODED body; `next start` compresses
// the document ~5x. The first cut of this harness divided decoded bytes by
// throughput and produced a 2680ms "floor" on / against a 656ms FCP, which reads
// as "FCP well inside the transfer" -- i.e. it would have falsified the
// mechanism for an instrument reason. The architect's predicted magnitudes
// (~2.7s on /, ~13s on /members) inherited the same unlabelled figure and ran
// ~5x high for it. A byte count without its encoding is a claim, not a
// measurement (docs/oddities.md, HO 704).
//
// CACHE STATE IS IDENTICAL ACROSS BUILDS BY CONSTRUCTION: one fresh context per
// route, ONE unthrottled warm load to populate the JS cache, then the throttle
// is applied so only the DOCUMENT is slow -- the same profile
// scripts/diagnostic/seam-intervene-702.ts uses for its t2 mode. Throttling the
// whole context instead would starve ~2MB of chunks and confound a document
// measurement with a JS one.
//
// Local-only, read-only, no writes. Wants a local PRODUCTION build (`next
// start`), never `next dev`.
//
// usage: npx tsx scripts/diagnostic/throttled-fcp-704.ts <base> <label> [kbps] [latencyMs] [n]
//   npx tsx scripts/diagnostic/throttled-fcp-704.ts http://localhost:3000 FIXED 1500 20 5
//   npx tsx scripts/diagnostic/throttled-fcp-704.ts http://localhost:3000 FIXED 10000 100 5
import { chromium } from "@playwright/test";

const BASE = process.argv[2];
const LABEL = process.argv[3] ?? "";
const KBPS = Number(process.argv[4] ?? 1500);
const LATENCY = Number(process.argv[5] ?? 20);
const N = Number(process.argv[6] ?? 5);
if (!BASE || !/^https?:\/\/(localhost|127\.0\.0\.1):/.test(BASE)) {
  console.error("refusing: localhost only");
  process.exit(1);
}

// / is the smallest interesting document and /members the largest, so the pair
// brackets the transfer-dependence the harness exists to expose.
const PATHS = ["/", "/members"];

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function main() {
  const browser = await chromium.launch();
  console.log(`THROTTLED-FCP ${LABEL} base=${BASE} kbps=${KBPS} latency=${LATENCY}ms n=${N}`);
  for (const p of PATHS) {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
    const page = await ctx.newPage();

    let docBytes = 0;
    let wireBytes = 0;
    page.on("response", async (r) => {
      if (r.url() !== BASE + p) return;
      try {
        docBytes = (await r.body()).length;
      } catch {
        /* body may be gone; the wire size below is the one that matters */
      }
      try {
        wireBytes = (await r.request().sizes()).responseBodySize;
      } catch {
        /* leaves the floor NaN rather than a wrong number */
      }
    });

    // Warm pass, UNTHROTTLED: populates the JS cache so the throttle starves the
    // document and nothing else.
    await page.goto(BASE + p, { waitUntil: "load", timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(1_000);

    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: LATENCY,
      downloadThroughput: (KBPS * 1024) / 8,
      uploadThroughput: (1024 * 1024) / 8,
    });

    const fps: number[] = [];
    const fcps: number[] = [];
    const dcls: number[] = [];
    for (let i = 0; i < N; i++) {
      await page.goto(BASE + p, { waitUntil: "load", timeout: 180_000 }).catch(() => {});
      await page.waitForTimeout(400);
      const t = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined;
        const paints = performance.getEntriesByType("paint");
        const fp = paints.find((e) => e.name === "first-paint");
        const fcp = paints.find((e) => e.name === "first-contentful-paint");
        return {
          fp: fp ? fp.startTime : null,
          fcp: fcp ? fcp.startTime : null,
          dcl: nav ? nav.domContentLoadedEventEnd : null,
        };
      });
      if (t.fp !== null) fps.push(t.fp);
      if (t.fcp !== null) fcps.push(t.fcp);
      if (t.dcl !== null) dcls.push(t.dcl);
    }

    const mFp = median(fps);
    const mFcp = median(fcps);
    const floorMs = wireBytes ? ((wireBytes * 8) / (KBPS * 1024)) * 1000 : NaN;
    console.log(
      `  ${p.padEnd(9)} FP=${mFp.toFixed(0)}ms [${fps.map((x) => x.toFixed(0)).join(",")}]` +
        `  FCP=${mFcp.toFixed(0)}ms [${fcps.map((x) => x.toFixed(0)).join(",")}]` +
        `  DCL=${median(dcls).toFixed(0)}ms [${dcls.map((x) => x.toFixed(0)).join(",")}]` +
        `  blank=(FCP-FP)=${(mFcp - mFp).toFixed(0)}ms` +
        `  docBytes=${docBytes} wireBytes=${wireBytes} transferFloor=${floorMs.toFixed(0)}ms`,
    );
    await ctx.close();
  }
  await browser.close();
}
main();
