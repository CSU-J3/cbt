// HO 693 — the STATIC half of the odds gate. Runs in CI between typecheck and
// build: no browser, no network, no DB, deterministic.
//
// WHAT IT CATCHES: a market render site written from scratch in a NEW file, at
// merge time. WHAT IT DOES NOT: a from-scratch site added to a file already on
// the allowlist, using no gated primitive. That limit is real and is stated in
// SKILL too — do not read a green here as "every site is gated".
//
// ── WHY IT SCANS `.tsx` ONLY, AND STRIPS COMMENTS FIRST ──────────────────────
//
// The HO 692 WATCH's grep was `components app --include=*.tsx`; HO 693's
// handoff widened it to `lib/` and `.ts`. Measured over the tree at `1adb7a9`
// that widening returns 30 files, of which only 11 can possibly render:
//
//   11  .tsx with a code-level match      <- the real candidate set
//    4  .tsx matching ONLY inside a comment
//   15  .ts  — CANNOT CONTAIN JSX AT ALL
//
// So two narrowings, each with a reason rather than a preference:
//
//   `.tsx` only. A `.ts` file cannot contain JSX; the compiler rejects it. That
//   is structural, not a judgement call, so excluding the 15 costs no coverage
//   — none of them can be a render site however they are edited.
//
//   Comments stripped. Otherwise the gate fires on PROSE: two of those four
//   files (`HeaderBar.tsx`, `DashboardV2Header.tsx`) match only because of
//   comments HO 692 itself wrote, and under a raw grep editing such a comment
//   would break CI while DELETING one would trip the stale-allowlist check. A
//   gate whose failures are mostly about wording is a gate people learn to
//   silence.
//
// The stripper treats `//` as a comment ONLY at line start or after whitespace,
// so a url or path inside a string cannot be mistaken for one and have the rest
// of its line discarded — that would be a false NEGATIVE in a safety gate, the
// one error class worth paying to avoid because it reads as a pass. See the
// note on `stripComments` for the two forms that shipped broken and were caught
// in review. No `.tsx` in the tree carries such a string today, so this costs
// nothing now and stays correct when one appears.
//
//   npm run check:odds-sites
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, sep } from "node:path";

const ROOTS = ["components", "app"];
const ALLOWLIST = "e2e/odds-sites.allowlist.json";
const MARKET_RE = /kalshi|polymarket|SourceTag|impliedPct|favoriteLabel/i;
const REASONS = new Set(["gated", "not-a-render-site", "consumer-of-gated-primitive"]);

type Entry = { reason: string; note?: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (name.endsWith(".tsx")) out.push(full.split(sep).join(posix.sep));
  }
  return out;
}

/** Remove block and line comments.
 *
 *  A `//` counts as a line comment ONLY at the start of a line or after
 *  WHITESPACE. That is the whole rule, and it is deliberately stricter than
 *  "not preceded by a colon", which is what this first shipped as: `[^:]`
 *  protects `https://…` but nothing else, so it discarded the rest of the line
 *  for a PROTOCOL-RELATIVE url (`src="//cdn.example.com/kalshi.png"`) and for
 *  any path-ish string (`"a//kalshi"`) — in both cases silently swallowing a
 *  genuine code reference. That is a false NEGATIVE in a safety gate: the one
 *  error class here worth paying to avoid, because it reads as a pass.
 *
 *  Measured at HO 693 on both forms — `[^:]` said "no market reference", `(^|\s)`
 *  says there is one, and both still strip a genuine `// comment` and a trailing
 *  `x = 1; // comment`. The third falsification leg pins exactly this. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function main() {
  const files = ROOTS.flatMap((r) => walk(r));
  const matching = files.filter((f) => MARKET_RE.test(stripComments(readFileSync(f, "utf8"))));

  let allow: Record<string, Entry>;
  try {
    allow = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as Record<string, Entry>;
  } catch (e) {
    console.error(`check:odds-sites — cannot read ${ALLOWLIST}: ${(e as Error).message}`);
    process.exit(1);
  }

  const problems: string[] = [];

  const listed = Object.entries(allow).filter(([k]) => !k.startsWith("_"));

  for (const [path, entry] of listed)
    if (!REASONS.has(entry.reason))
      problems.push(
        `  ${path}\n    invalid reason ${JSON.stringify(entry.reason)} — use one of: ${[...REASONS].join(" | ")}`,
      );

  // Direction 1 — a market file nobody has classified.
  for (const f of matching)
    if (!allow[f]) {
      const line = readFileSync(f, "utf8")
        .split(/\r?\n/)
        .map((l, i) => ({ l, i }))
        .find((x) => MARKET_RE.test(stripComments(x.l)));
      problems.push(
        `  ${f}${line ? `:${line.i + 1}` : ""}\n` +
          `    ${line ? line.l.trim().slice(0, 100) : ""}\n` +
          `    UNLISTED. Gate it (\`odds-only\` + \`data-market\`) and list it as "gated",\n` +
          `    or list it as "not-a-render-site" / "consumer-of-gated-primitive" with a note.`,
      );
    }

  // Direction 2 — a stale entry. The same disease in reverse: an allowlist
  // nobody prunes stops describing the tree, and then it stops being read.
  for (const [path] of listed)
    if (!matching.includes(path))
      problems.push(
        `  ${path}\n    LISTED BUT NO LONGER MATCHES — the file was deleted, renamed, or its\n` +
          `    market reference removed. Drop the entry.`,
      );

  console.log(
    `check:odds-sites — scanned ${files.length} .tsx under ${ROOTS.join("/ ")}/; ${matching.length} reference a market; ${listed.length} listed`,
  );
  if (problems.length === 0) {
    console.log("OK");
    return;
  }
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
main();
