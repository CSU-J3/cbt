/**
 * HO 697 — the #418 rate matrix. Runs the smoke crawl N times against a local
 * production build and reports fires per run, so two trees can be compared on a
 * rate rather than on a single reading.
 *
 * TRACKED, and it should have been from the start: it produced every number in
 * the HO 697 roadmap block, and the rule is that a probe a finding rests on does
 * not live in scratch/ (HO 672; applied at the HO 697 STEP 0 ruling §6). It was
 * written as a bash script, deleted, and REWRITTEN HERE TO THE SAME BEHAVIOUR —
 * not restored byte-for-byte, which the header says because the reader is
 * entitled to know the instrument was re-authored after the numbers were taken.
 *
 * READ THIS BEFORE YOU USE IT TO ATTRIBUTE ANYTHING. HO 697 ran 27 crawls with
 * this instrument and produced THREE attributions, all three retracted:
 *   - the clock, from a dump taken after `nav()` settles (a superset);
 *   - the tag, from tag-free controls that had never run at the same hour;
 *   - and a fourth was one control away from being reported: a harness bug had
 *     four "arms" all served by `main`, and the reading would have said the
 *     tag's static span moves the rate.
 * The defect they share is not a missing arm. It is that FIRES PER CRAWL ON AN
 * INTERMITTENT WITH A MOVING BASE RATE ATTRIBUTES NOTHING at these magnitudes.
 * `main` itself read 0 fires in 3 crawls at one hour and 3 in 4 at another, the
 * same day — the base rate drifts within a day, which no ledger entry had said.
 * Separating ~0.75 from ~1.2 fires/crawl at two sigma needs roughly FORTY crawls
 * per arm at matched hours. No cycle count rescues this.
 *
 * So: this file measures a RATE. It does not attribute a cause, and a table it
 * produces is not evidence that a change did anything. Use it to notice that
 * something moved; use HO 698's instrument to find out what. The one reading the
 * hour does not explain is an adjacent pair from the first evening — `main` 0 · 0
 * and the pre-fix clock tree 3 · 3 within ten minutes — the strongest thing in
 * the dataset, and one pair.
 *
 * AND KILL SERVERS BY PORT. The arm-swapping wrapper around this killed its
 * `npx` wrapper rather than the `next start` child, so the child kept :3000, the
 * next arm died with EADDRINUSE, and four arms were silently served by one build
 * (HO 672's detached-child shape). The control that expected the tag in the
 * served HTML is what caught it. Kill by port, and ABORT if it stays bound.
 *
 * USAGE. Check out the tree, `npm run build`, start `npx next start -p 3000`
 * (never `next dev`), then:
 *   npx tsx scripts/diagnostic/pageerr-matrix-697.ts <arm-label> [runs]
 * Orchestration only — every number comes from the crawl itself.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";

const ARM = process.argv[2] ?? "arm";
const RUNS = Number(process.argv[3] ?? "3");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const LOGS = "test-results/matrix-697";

/** Which change is actually present. A rate comparison between two trees is
 *  worth nothing if you cannot say which tree you measured. */
async function controls(): Promise<string> {
  const html = await (await fetch(`${BASE}/bills`)).text();
  const clock = (html.match(/masthead-clock/g) ?? []).length;
  const hrefs = [...html.matchAll(/\/_next\/static\/css\/[^"]+\.css/g)].map((m) => m[0]);
  let mono = 0;
  for (const h of [...new Set(hrefs)]) {
    const css = await (await fetch(`${BASE}${h}`)).text();
    mono += (css.match(/IBM_Plex_Mono|plex-mono/g) ?? []).length;
  }
  return `clock-in-html=${clock} plexmono-in-css=${mono}`;
}

function fireCount(log: string): { fires: number; routes: string[] } {
  const routes: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    if (!/pageErr=[1-9]/.test(line)) continue;
    const m = line.match(/^\[([a-z0-9-]+)\]/);
    routes.push(m?.[1] ?? "?");
  }
  return { fires: routes.length, routes };
}

/** How many dumps carry nothing but the every-route announcer. A fire at the
 *  floor has no red herring in it, which is the reading the :50 hunt wants. */
function floorReading(): string {
  const dir = "test-results";
  if (!existsSync(dir)) return "n/a";
  const files = readdirSync(dir).filter(
    (f) => f.startsWith("pageerr-") && f.endsWith(".json"),
  );
  if (files.length === 0) return "n/a";
  let atFloor = 0;
  for (const f of files) {
    const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as {
      align?: { addedInDom?: string[] };
    };
    const added = j.align?.addedInDom ?? [];
    if (added.length === 1 && added[0] === "next-route-announcer +1") atFloor++;
  }
  return `${atFloor}/${files.length} at floor`;
}

async function main(): Promise<void> {
  mkdirSync(LOGS, { recursive: true });
  console.log(`ARM ${ARM} · ${execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim()} · ${await controls()}`);

  const totals: number[] = [];
  for (let i = 1; i <= RUNS; i++) {
    for (const f of existsSync("test-results") ? readdirSync("test-results") : []) {
      if (f.startsWith("pageerr-")) rmSync(`test-results/${f}`);
    }
    let out = "";
    try {
      out = execFileSync(
        "npx",
        ["playwright", "test", "e2e/smoke.spec.ts", "--reporter=line"],
        { encoding: "utf8", env: { ...process.env, BASE_URL: BASE }, shell: true },
      );
    } catch (e) {
      // A crawl that finds anything exits non-zero; the output is the reading.
      out = String((e as { stdout?: string }).stdout ?? "");
    }
    const { fires, routes } = fireCount(out);
    totals.push(fires);
    const tail = out
      .split(/\r?\n/)
      .filter((l) => /^\s+\d+ (failed|passed)/.test(l))
      .join(" ")
      .trim();
    console.log(
      `  run ${i}  [${tail}]  fires=${fires}  ${floorReading()}  routes: ${routes.join(" ")}`,
    );
  }
  const sum = totals.reduce((a, b) => a + b, 0);
  console.log(`ARM ${ARM} pooled: ${sum} fires / ${RUNS} crawls  (${totals.join(" · ")})`);
}

main();
