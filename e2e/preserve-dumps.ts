// HO 702 §3 — archive the previous crawl's fire dumps BEFORE this one wipes them.
//
// WHY THIS EXISTS, measured not supposed. `playwright test` clears `outputDir`
// (`./test-results`) at the start of every run. HO 700 ran four crawls
// back-to-back and HO 702 ran four more; in both cases only the LAST crawl's
// dumps could survive, and HO 702 lost the `/races` hit-1 dump from crawl M1 to
// crawl A2's startup wipe — a fire that fired, was captured, and was then
// deleted by the runner before anyone read it.
//
// That is the HO 685 silently-missing-sample shape with a different cause: the
// gate produced its artifact and the harness destroyed it, and nothing said so.
// A crawl that discards evidence must say what it discarded, so this prints the
// count copied (including zero) rather than only speaking up when it finds
// something.
//
// Destination is repo-ignored (`docs/handoffs/` is in .gitignore), so archived
// dumps never enter the tree — same rule as the handoffs themselves.
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve("./test-results");
const ROOT = path.resolve("./docs/handoffs/702-artifacts");

// A dump is the three files HO 687 writes per fire: the JSON and the gzipped
// SSR/DOM pair. Matching on the prefix, NOT on an extension glob — the ruling
// said `*.json.gz` and no such file exists; the pair are `.html.gz` beside a
// plain `.json`, so an extension glob would have archived nothing and reported
// success. Named here because a silent zero is exactly what this file is for.
const DUMP_PREFIX = "pageerr-";

export default function preserveDumps(): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(SRC).filter((n) => n.startsWith(DUMP_PREFIX));
  } catch {
    // No test-results yet — first run in a clean tree. Nothing to preserve.
    // eslint-disable-next-line no-console
    console.log("[preserve-dumps] no test-results/ yet — 0 preserved");
    return;
  }
  if (names.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[preserve-dumps] 0 dumps from the previous crawl");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const arm = process.env.CRAWL_ARM ?? "crawl";
  const dest = path.join(ROOT, `${arm}-${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const n of names) fs.copyFileSync(path.join(SRC, n), path.join(dest, n));
  const fires = names.filter((n) => n.endsWith(".json")).length;
  // eslint-disable-next-line no-console
  console.log(
    `[preserve-dumps] ${names.length} files (${fires} fires) → ${path.relative(process.cwd(), dest)}`,
  );
}
