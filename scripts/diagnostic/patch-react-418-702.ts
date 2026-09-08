// HO 702 Arm B — widen the production `#418` message, in a WORKTREE ONLY.
//
// WHY THIS EXISTS. Development React names the component but does not fire
// (HO 700: 0 fires in 360 dev navigations while production-mode crawls of the
// same two trees read 1·1 and 0·2). Production React fires but says `HTML` and
// nothing else — the message is byte-identical for every structural mismatch
// anywhere in the app, which is the whole reason `backlog:50` has stood since
// 2026-07-29. The third option is PRODUCTION TIMING WITH A WIDENED MESSAGE:
// patch the throw site so the error carries the fiber's type chain and the DOM
// node React was holding when it refused to match.
//
// WHAT ARM A COULD NOT BUY, which is why this still exists after Arm A read a
// negative. A mutation log can say the DOM was not changed under hydration; it
// can never say WHICH component and WHICH node disagreed, because the losing
// node was in the first client render and never touched the DOM at all
// (HO 700's finding, and this HO's `pre=0` reading confirms it from the other
// side). `fiber` and `nextHydratableInstance` are in scope at the throw and
// nowhere else.
//
// CHECK THE CHUNK, NOT THE FILE. `node_modules` is a webpack MANAGED PATH,
// validated by package version rather than by content, so an in-place edit
// there is invisible to an incremental build: the first patched build here came
// back with a BYTE-IDENTICAL chunk hash and no marker in it, and the build
// reported success. `rm -rf .next` before building is the fix, and the MARKER
// string found in the built chunk is the only proof the patch is in the bundle.
// Without it this reads as "the patch didn't help" — a null result with a
// pre-assigned wrong cause, which is the HO 700 trap in a new costume.
//
// THIS IS NEVER COMMITTED AND NEVER SHIPS. It edits `node_modules` in a git
// worktree checked out at one of the two diagnostic tags, and refuses anywhere
// else. The worktree's `node_modules` is deleted with it at the end of the HO —
// a patched React must not survive.
//
// The site tag comes from a third argument added at each of the eight call
// sites. Seven of the eight minified sites were mapped to source by shape and
// order; `:7622` is the one proven by identifier match (`rP`/`rN`/`r_`/`rF` ↔
// hydrationParentFiber / nextHydratableInstance / rootOrSingletonContext /
// HydrationMismatchException) and it is the site the A2 fire actually took.
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const TAGS: Record<string, string> = {
  "40c3397b305bc528cf9af836b51428c32718bf97": "ho697-prefix-clock",
  "65f866c": "ho697-clock",
};

const TARGET = path.join(
  "node_modules", "next", "dist", "compiled", "react-dom", "cjs",
  "react-dom-client.production.js",
);

// A marker the patch inserts, so STEP 0 row 1's byte-string check can be re-run
// against the BUILT chunk and prove the patched copy is the one that shipped.
// Without it, "I patched the file" and "the patched file is in the bundle" are
// two different claims and only the first would have evidence.
const MARKER = "HO702_WIDENED_418";

// Byte-identical or refuse. If React is ever bumped this text changes and the
// patch must be re-derived rather than fuzzily applied to a function it no
// longer understands.
const ORIGINAL = `function throwOnHydrationMismatch(fiber) {
  var error = Error(
    formatProdErrorMessage(
      418,
      1 < arguments.length && void 0 !== arguments[1] && arguments[1]
        ? "text"
        : "HTML",
      ""
    )
  );
  queueHydrationError(createCapturedValueAtFiber(error, fiber));
  throw HydrationMismatchException;
}`;

const REPLACEMENT = `function throwOnHydrationMismatch(fiber) {
  /* ${MARKER} — HO 702 Arm B, worktree-only diagnostic build */
  var ho702Kind =
    1 < arguments.length && void 0 !== arguments[1] && arguments[1]
      ? "text"
      : "HTML";
  var ho702Site = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : "?";
  function ho702Name(t) {
    if (t == null) return "null";
    if (typeof t === "string") return t;
    if (typeof t === "function") return t.displayName || t.name || "anon()";
    if (typeof t === "object") {
      if (t.displayName) return t.displayName;
      if (t._payload && t._payload._result) return ho702Name(t._payload._result);
      return "obj(" + String(t.$$typeof && t.$$typeof.toString()).slice(7, 40) + ")";
    }
    return String(t);
  }
  function ho702Frame(t) {
    var name = ho702Name(t);
    var fn = null;
    if (typeof t === "function") fn = t;
    else if (t && typeof t === "object") fn = t.render || (typeof t.type === "function" ? t.type : null);
    if (!fn) return name;
    try {
      return name + "{" + String(fn).replace(/\\s+/g, " ").slice(0, 120) + "}";
    } catch (e) {
      return name + "{unreadable}";
    }
  }
  function ho702Chain(f) {
    var out = [];
    var n = f;
    var guard = 0;
    while (n && guard++ < 10) {
      // Host roots and fragments carry no useful name; skip so the ten frames
      // are ten COMPONENTS rather than ten wrappers.
      if (n.tag !== 3 && n.tag !== 7) out.push(ho702Frame(n.type));
      n = n.return;
    }
    return out.join(" < ") || "(none)";
  }
  function ho702Node(n) {
    if (!n) return "null";
    try {
      var s =
        n.nodeType === 1
          ? String(n.outerHTML || "").slice(0, 120)
          : String(n.data == null ? "" : n.data).slice(0, 120);
      return n.nodeType + " " + n.nodeName + " " + JSON.stringify(s);
    } catch (e) {
      return n.nodeType + " " + n.nodeName + " (unreadable)";
    }
  }
  // MUST keep the token e2e/smoke.spec.ts PAGEERR_MARK matches
  // (/Minified React error #418/), or Arm B SILENTLY DISABLES the HO 687
  // dump: the crawl still counts and prints the pageErr, but
  // dumpPageErrFire finds no matching message and writes nothing, so the
  // SSR/DOM pair and Arm A's mut partition are lost for exactly the fires
  // Arm B exists to explain. Measured: a named fire with no dump behind it.
  var ho702Msg =
    "Minified React error #418 \\u00b7 " + ho702Kind +
    " \\u00b7 fiber=" + ho702Chain(fiber) +
    " \\u00b7 parent=" + (hydrationParentFiber ? ho702Name(hydrationParentFiber.type) : "null") +
    " \\u00b7 expected=" + (fiber && typeof fiber.type === "string" ? fiber.type : ho702Name(fiber && fiber.type)) +
    " \\u00b7 found=" + ho702Node(nextHydratableInstance) +
    " \\u00b7 site=" + ho702Site +
    " \\u00b7 ${MARKER}";
  var error = Error(ho702Msg);
  queueHydrationError(createCapturedValueAtFiber(error, fiber));
  throw HydrationMismatchException;
}`;

// The eight call sites, each asserted by its surrounding text so a substitution
// can never land on the wrong one. Source line is the anchor; the `find` text is
// the authority.
const SITES: Array<{ line: number; find: string; tag: string }> = [
  { line: 2821, find: "instance || throwOnHydrationMismatch(fiber, !0);", tag: "2821" },
  { line: 2852, find: "JSCompiler_temp && nextHydratableInstance && throwOnHydrationMismatch(fiber);", tag: "2852" },
  { line: 4956, find: "throwOnHydrationMismatch(JSCompiler_inline_result);", tag: "4956" },
  { line: 6363, find: "if (null === current) throw throwOnHydrationMismatch(workInProgress);", tag: "6363" },
  { line: 6830, find: "if (null === current) throw throwOnHydrationMismatch(workInProgress);", tag: "6830" },
  { line: 7622, find: "$$typeof || throwOnHydrationMismatch(workInProgress);", tag: "7622" },
  { line: 7661, find: "current || throwOnHydrationMismatch(workInProgress);", tag: "7661" },
  { line: 8158, find: "current || throwOnHydrationMismatch(workInProgress, !0);", tag: "8158" },
];

function refuse(why: string): never {
  console.error(`REFUSING: ${why}`);
  console.error("This patches node_modules React IN PLACE and must never touch a");
  console.error("real checkout — run it only in a git worktree at ho697-prefix-clock or ho697-clock.");
  process.exit(1);
}

function main(): void {
  const revert = process.argv.includes("--revert");
  let head = "";
  let commonDir = "";
  try {
    head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    commonDir = execSync("git rev-parse --git-common-dir", { encoding: "utf8" }).trim();
    const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf8" }).trim();
    if (path.resolve(gitDir) === path.resolve(commonDir)) {
      refuse("this is the main checkout, not a git worktree");
    }
  } catch (e) {
    refuse(`not a git checkout (${String(e).slice(0, 80)})`);
  }
  const tag = Object.entries(TAGS).find(([sha]) => head.startsWith(sha) || sha.startsWith(head));
  if (!tag) refuse(`HEAD ${head.slice(0, 12)} is not one of the two diagnostic tags`);
  if (!fs.existsSync(TARGET)) refuse(`${TARGET} not found — run npm ci in this worktree first`);

  const src = fs.readFileSync(TARGET, "utf8");
  if (revert) {
    if (!src.includes(MARKER)) { console.log("not patched — nothing to revert"); return; }
    console.log("revert: reinstall with `npm ci` (the patch is in node_modules, not tracked)");
    return;
  }
  if (src.includes(MARKER)) { console.log(`already patched (${tag[1]}) — no change`); return; }
  if (!src.includes(ORIGINAL)) {
    refuse("throwOnHydrationMismatch is not byte-identical to the expected text — re-derive the patch");
  }
  let out = src.replace(ORIGINAL, REPLACEMENT);

  // Tag each call site. Two pairs share their `find` text (6363/6830 and the
  // 7661/2821 shapes differ, but 6363 and 6830 are identical strings), so they
  // are substituted ONE AT A TIME in file order and each is asserted present
  // before and consumed after.
  let tagged = 0;
  for (const s of SITES) {
    // The tag is ALWAYS the THIRD argument. The six HTML sites pass only the
    // fiber, so appending the tag as arg 2 would land it in the text-flag slot:
    // `arguments[1]` truthy makes every HTML mismatch report as `text` and
    // leaves `site=?`. Measured — the first control run read `418 · text` for a
    // structural span-vs-div mismatch. Pad with `void 0` so the slots are fixed.
    const withTag = s.find.replace(
      /throwOnHydrationMismatch\(([^)]*)\)/,
      (_m, args: string) =>
        `throwOnHydrationMismatch(${args}${/,\s*!0\s*$/.test(args) ? "" : ", void 0"}, "${s.tag}")`,
    );
    const at = out.indexOf(s.find);
    if (at < 0) { console.error(`  site ${s.tag}: NOT FOUND — skipped`); continue; }
    out = out.slice(0, at) + withTag + out.slice(at + s.find.length);
    tagged++;
    console.log(`  site ${s.tag}: tagged`);
  }
  if (tagged !== SITES.length) refuse(`only ${tagged}/${SITES.length} sites tagged — refusing a partial patch`);

  // The REPLACEMENT is a template literal, so `\s` here is what emits `\\s`
  // into the patched JS. Getting that wrong emits `/s+/g`, which strips every
  // letter `s` from the snippets instead of collapsing whitespace — measured:
  // `class extends` came out as `cla    extend `. Assert the emitted text.
  if (!out.includes("replace(/\\s+/g")) {
    refuse("emitted patch has a corrupted whitespace regex (check template-literal escaping)");
  }
  fs.writeFileSync(TARGET, out);
  console.log(`\npatched ${TARGET}`);
  console.log(`  tree: ${tag[1]} (${head.slice(0, 7)})`);
  console.log(`  marker: ${MARKER}`);
  console.log(`  bytes: ${src.length} -> ${out.length}`);
  console.log("\nNEXT: npm run build, then grep the built client chunk for the marker.");
  console.log("A patch that is not in the bundle is not a patch.");
}

main();
