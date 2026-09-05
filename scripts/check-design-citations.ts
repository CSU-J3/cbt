/**
 * HO 696 — the design-citation gate.
 *
 * Closes `docs/backlog.md:110` half (b): a throwaway mock cannot be cited by
 * accident. Scans every TRACKED file for references to the design directory and
 * reds on one that does not resolve in a fresh clone.
 *
 * Tracked-only is the point: a fresh clone has nothing else, so "resolves" here
 * means "resolves for someone who just cloned", which is the property half (a)
 * is about. The precedent is `scripts/check-odds-sites.ts` (HO 693) — walk,
 * allowlist, both directions, `OK` or a problem list and exit 1.
 *
 * WHAT IT CANNOT SEE, stated here because a reader meets the limit here first:
 * a pre-629 mock cited by bare name (`ideology-cut1-members-insitu.html`,
 * `dashboard-hill-fit.html`, …). G2 recognises the `mock-<HO>-<slug>.html`
 * ruling-record convention only. Committing what is on disk fixes those; the
 * gate never could.
 *
 * This file is NOT exempt from its own scan, and neither is the allowlist or
 * either README. They simply never write a concrete path below the disposable
 * directory — they say so in words. (HO 695's postscript, wearing a costume:
 * the cheapest defence against an escape is not needing one.)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const DESIGN_DIR = "docs/design";
const SCRATCH_SEGMENT = "scratch";
const ALLOWLIST_PATH = `${DESIGN_DIR}/citations.allowlist.json`;

const BINARY_EXT =
  /\.(gz|png|jpg|jpeg|ico|woff|woff2|pdf|zip|webp|mp4|ttf|otf|eot)$/i;

type Klass = "FORBIDDEN" | "MALFORMED" | "DANGLING" | "STALE";
type Problem = { file: string; line: number; token: string; klass: Klass };

type AllowEntry = { reason: string; note?: string };

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .toString("utf8")
    .split("\0")
    .filter((f) => f.length > 0);
}

function isBinary(path: string, buf: Buffer): boolean {
  if (BINARY_EXT.test(path)) return true;
  const head = buf.subarray(0, 8192);
  return head.includes(0);
}

function loadAllowlist(): Map<string, AllowEntry> {
  const map = new Map<string, AllowEntry>();
  if (!existsSync(ALLOWLIST_PATH)) return map;
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  for (const [token, value] of Object.entries(raw)) {
    if (token === "_README") continue;
    const entry = value as AllowEntry;
    map.set(token, entry);
  }
  return map;
}

/** Trailing punctuation that belongs to the prose, not to the path. */
function stripTrailing(token: string): string {
  let t = token;
  while (t.length > 0 && ".,;:)".includes(t.charAt(t.length - 1))) {
    // A ')' can be part of a real filename — `floor-votes-section(1).html` —
    // but only ever mid-name, never last, because a filename ends in its
    // extension. So an unconditional trailing strip is safe.
    t = t.slice(0, -1);
  }
  return t;
}

function lastSegment(remainder: string): string {
  const parts = remainder.split("/");
  return parts[parts.length - 1] ?? "";
}

function main(): void {
  const plant = process.env.DESIGN_CITATIONS_PLANT === "1";
  const allow = loadAllowlist();
  const tracked = new Set(trackedFiles());

  const problems: Problem[] = [];
  const allowlistHit = new Set<string>();
  let scanned = 0;
  let prefixed = 0;
  let bare = 0;
  let resolved = 0;

  for (const file of tracked) {
    let buf: Buffer;
    try {
      buf = readFileSync(file);
    } catch {
      continue;
    }
    if (isBinary(file, buf)) continue;
    scanned++;

    const lines = buf.toString("utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i] ?? "";
      const lineNo = i + 1;

      // ---- G1: an explicit `docs/design/...` path -----------------------
      const g1 = new RegExp(`${DESIGN_DIR}/[A-Za-z0-9._()/-]*`, "g");
      for (const m of text.matchAll(g1)) {
        const token = stripTrailing(m[0]);
        const remainder = token.slice(DESIGN_DIR.length + 1);

        // A mention of the directory itself, not a citation of a file.
        if (remainder === "" || remainder === SCRATCH_SEGMENT) continue;
        if (remainder === `${SCRATCH_SEGMENT}/`) continue;

        prefixed++;

        // The disposable directory is off limits to every tracked file, and
        // no allowlist entry can lift it. This is close-half (b).
        if (remainder.startsWith(`${SCRATCH_SEGMENT}/`)) {
          const tail = remainder.slice(SCRATCH_SEGMENT.length + 1);
          if (tail !== "README.md") {
            problems.push({ file, line: lineNo, token, klass: "FORBIDDEN" });
            continue;
          }
          resolved++;
          continue;
        }

        // No extension on the last segment = a path wrapped or truncated
        // across lines. Illegible to this gate and to every grep.
        if (!lastSegment(remainder).includes(".")) {
          problems.push({ file, line: lineNo, token, klass: "MALFORMED" });
          continue;
        }

        if (tracked.has(token)) {
          resolved++;
          if (allow.has(token)) {
            allowlistHit.add(token);
            problems.push({ file, line: lineNo, token, klass: "STALE" });
          }
          continue;
        }
        if (allow.has(token)) {
          allowlistHit.add(token);
          continue;
        }
        problems.push({ file, line: lineNo, token, klass: "DANGLING" });
      }

      // ---- G2: a bare `mock-<HO>-<slug>.html` name ----------------------
      const g2 = /\bmock-\d+-[A-Za-z0-9._-]*\.html\b/g;
      for (const m of text.matchAll(g2)) {
        const at = m.index ?? 0;
        const before = text.slice(Math.max(0, at - (DESIGN_DIR.length + 1)), at);
        if (before.endsWith(`${DESIGN_DIR}/`)) continue; // G1 already counted it
        const name = m[0];
        bare++;
        const asPath = `${DESIGN_DIR}/${name}`;
        if (tracked.has(asPath)) {
          resolved++;
          if (allow.has(name)) {
            allowlistHit.add(name);
            problems.push({ file, line: lineNo, token: name, klass: "STALE" });
          }
          continue;
        }
        if (allow.has(name)) {
          allowlistHit.add(name);
          continue;
        }
        problems.push({ file, line: lineNo, token: name, klass: "DANGLING" });
      }
    }
  }

  if (plant) {
    problems.push({
      file: "(plant)",
      line: 0,
      token: [DESIGN_DIR, SCRATCH_SEGMENT, "plant.html"].join("/"),
      klass: "FORBIDDEN",
    });
  }

  const citations = prefixed + bare;

  // The HO 604 C1 lesson: a scan aimed at the wrong path reads 0 both before
  // and after the work. A zero here is a broken scanner, never a clean tree.
  if (citations === 0) {
    console.error(
      `scanner read nothing — 0 citations across ${scanned} tracked files; ` +
        `the walk or the grammar is broken, this is not a clean result`,
    );
    process.exit(1);
  }

  for (const p of problems) {
    const where = p.line > 0 ? `${p.file}:${p.line}` : p.file;
    console.log(`${where}  ${p.token}  ${p.klass}`);
  }

  const summary =
    `scanned ${scanned} · citations ${citations} ` +
    `(prefixed ${prefixed}, bare ${bare}) · resolved ${resolved} · ` +
    `allowlisted ${allowlistHit.size} · problems ${problems.length}`;
  console.log(summary);

  if (problems.length > 0) process.exit(1);
  console.log("OK");
}

main();
