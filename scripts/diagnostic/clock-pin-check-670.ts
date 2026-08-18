// HO 670 (review) — the rail clock is PINNED, not cycling. Read twice, 5s apart.
//
// The claim has two halves and a naive check confirms only the first: the clock
// must TICK (seconds advance) and its zone label must NOT rotate. `useZoneCycle`
// changes zone every 4s, so a 5s window crosses at least one rotation boundary —
// if the hook were still wired up, the label would differ across the two reads.
//
//   npx tsx scripts/diagnostic/clock-pin-check-670.ts [baseUrl]
import { chromium } from "@playwright/test";

async function main() {
  const base = process.argv[2] ?? "http://localhost:3123";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base + "/welcome", { waitUntil: "networkidle" });
  // The clock is the last element of the top rail; read the whole rail and pull
  // the timestamp out, so this does not depend on a hashed module class name.
  const read = async () =>
    (await page.evaluate(
      `(() => {
        const t = document.body.innerText.match(/[A-Z]{3} \\d{2} [A-Z]{3} \\d{4} · \\d{1,2}:\\d{2}:\\d{2} [AP]M [A-Z]{2,3}/);
        return t ? t[0] : "(no clock string found)";
      })()`,
    )) as string;

  const first = await read();
  await page.waitForTimeout(5200);
  const second = await read();
  await browser.close();

  const zone = (s: string) => s.split(" ").pop() ?? "";
  const secs = (s: string) => s.match(/(\d{2}) [AP]M/)?.[1] ?? "";
  const ticked = first !== second && secs(first) !== secs(second);
  const pinned = zone(first) === zone(second) && zone(first) !== "";

  console.log("  read 1 :", first);
  console.log("  read 2 :", second, "(+5.2s — crosses at least one 4s zone slot)");
  console.log(`  TICKS  : ${ticked ? "yes" : "NO — the clock is frozen"}`);
  console.log(
    `  PINNED : ${pinned ? "yes, zone " + zone(first) + " both reads" : "NO — zone rotated " + zone(first) + " -> " + zone(second)}`,
  );
  if (!ticked || !pinned) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
