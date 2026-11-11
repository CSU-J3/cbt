// HO 814: the docs diet. Moves landed history out of the three ledgers Code
// reads at session start and into archive files beside them, verbatim.
//
//   node scripts/diagnostic/docs-diet-814.mjs                 dry run, prints the plan
//   node scripts/diagnostic/docs-diet-814.mjs --write         writes the six files
//   node scripts/diagnostic/docs-diet-814.mjs --before 800    a later sweep's cutoff
//
// What moves:
//   docs/roadmap.md   every line from the first `**Also (HO` block up to the
//                     first `**Also (HO N` block with N >= the cutoff
//   docs/oddities.md  every line from the first `## ` entry up to the first
//                     entry whose heading names an HO >= the cutoff
//   docs/backlog.md   every top-level struck entry (`- ~~`) with its indented
//                     continuation lines, into the archive under the section
//                     heading it was struck in
//
// Nothing is reworded and nothing is deleted. Each archive is created with a
// six-line header on the first run and appended to on later ones, so the script
// is the sweep too: strike a line, run it again.
//
// The script does not verify itself. HO 814's gates rebuild each base blob from
// the two files with git and shell alone, so a wrong split fails there.
//
// No dependencies, no network, no database. Run from the repo root.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const beforeAt = args.indexOf("--before");
const BEFORE = beforeAt >= 0 ? Number(args[beforeAt + 1]) : 780;
if (!Number.isInteger(BEFORE) || BEFORE < 1) {
  console.error("--before takes an HO number");
  process.exit(2);
}

const HEADER_LINES = 6; // every archive: title, blank, note, blank, rule, blank

function read(path) {
  const raw = readFileSync(path, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  if (lines[lines.length - 1] !== "") {
    throw new Error(`${path} does not end with a newline`);
  }
  lines.pop();
  return { lines, eol };
}

function write(path, lines, eol) {
  if (WRITE) writeFileSync(path, lines.join(eol) + eol, "utf8");
}

function header(title, note) {
  return [title, "", note, "", "---", ""];
}

function loadArchive(path, title, note) {
  if (existsSync(path)) return read(path).lines;
  return header(title, note);
}

function maxHo(text) {
  let max = -1;
  for (const m of text.matchAll(/HO (\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

function bytes(lines) {
  return Buffer.byteLength(lines.join("\n") + "\n", "utf8");
}

function report(name, before, after, archive, moved) {
  console.log(
    `${name}: ${before.length} lines / ${bytes(before)} bytes -> ` +
      `${after.length} lines / ${bytes(after)} bytes; moved ${moved} lines; ` +
      `archive ${archive.length} lines / ${bytes(archive)} bytes`,
  );
}

// A contiguous cut: everything from the first line matching `first` up to the
// first line `stop` accepts. A marker line above the cut names the archive.
function cutRange({ path, archivePath, title, note, first, stop, marker }) {
  const { lines, eol } = read(path);
  const start = lines.findIndex((l) => first.test(l));
  if (start < 0) throw new Error(`${path}: no line matches ${first}`);
  const end = lines.findIndex((l, i) => i >= start && stop(l));
  if (end < 0) throw new Error(`${path}: nothing at or past the cutoff, refusing to move everything`);

  const moved = lines.slice(start, end);
  const archive = loadArchive(archivePath, title, note);
  archive.push(...moved);

  const MARK = "> **Archived:** ";
  const head = lines.slice(0, start);
  const had = head.length >= 2 && head[head.length - 2].startsWith(MARK);
  if (had) head.splice(head.length - 2, 2);
  const after = [...head, MARK + marker, "", ...lines.slice(end)];

  report(path, lines, after, archive, moved.length);
  console.log(`  cut: lines ${start + 1} to ${end} of the file as read; the marker ${had ? "replaced" : "added"}`);
  if (moved.length > 0) {
    write(path, after, eol);
    write(archivePath, archive, eol);
  }
  return moved.length;
}

function backlog() {
  const path = "docs/backlog.md";
  const archivePath = "docs/backlog-archive.md";
  const { lines, eol } = read(path);

  const keep = [];
  const movedBySection = new Map(); // heading -> lines
  const sections = [];
  let section = null;
  let movedLines = 0;
  let movedEntries = 0;

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      section = line;
      sections.push(line);
    }
    if (line.startsWith("- ~~")) {
      if (section === null) throw new Error(`${path}:${i + 1}: a struck entry above every section`);
      // The block: the entry, then every following line that is blank or indented.
      let j = i + 1;
      while (j < lines.length && (lines[j] === "" || /^\s/.test(lines[j]))) j++;
      // Trailing blank lines are the file's, not the entry's.
      while (j > i + 1 && lines[j - 1] === "") j--;
      const block = lines.slice(i, j);
      if (!movedBySection.has(section)) movedBySection.set(section, []);
      movedBySection.get(section).push(...block);
      movedLines += block.length;
      movedEntries++;
      i = j;
      continue;
    }
    keep.push(line);
    i++;
  }

  let archive = loadArchive(
    archivePath,
    "# Backlog archive",
    "> Struck lines moved out of `docs/backlog.md`, verbatim, under the section each was struck in. Nothing here is edited or deleted. The live ledger and the reconcile instrument are in `docs/backlog.md`.",
  );
  for (const heading of sections) {
    if (!archive.includes(heading)) {
      if (archive[archive.length - 1] !== "") archive.push("");
      archive.push(heading, "");
    }
  }
  for (const [heading, block] of movedBySection) {
    const at = archive.indexOf(heading);
    let next = archive.findIndex((l, i) => i > at && l.startsWith("## "));
    if (next < 0) next = archive.length;
    let insert = next;
    while (insert > at + 1 && archive[insert - 1] === "") insert--;
    const lead = insert === at + 1 ? [""] : [];
    archive = [...archive.slice(0, insert), ...lead, ...block, ...archive.slice(insert)];
  }
  if (archive[archive.length - 1] === "") archive.pop();

  report(path, lines, keep, archive, movedLines);
  console.log(`  struck entries moved: ${movedEntries}`);
  for (const heading of sections) {
    const block = movedBySection.get(heading) ?? [];
    console.log(`    ${heading}: ${block.filter((l) => l.startsWith("- ~~")).length} entries, ${block.length} lines`);
  }
  if (movedEntries > 0) {
    write(path, keep, eol);
    write(archivePath, archive, eol);
  }
  return movedEntries;
}

console.log(`docs-diet-814: cutoff HO ${BEFORE}, ${WRITE ? "WRITING" : "dry run"}; archive headers are ${HEADER_LINES} lines`);

cutRange({
  path: "docs/roadmap.md",
  archivePath: "docs/roadmap-archive.md",
  title: "# CBT roadmap archive",
  note: "> Landed `Also (HO N)` blocks moved out of `docs/roadmap.md`, verbatim and in order. Nothing here is edited. The pointer and the current blocks are in `docs/roadmap.md`.",
  first: /^\*\*Also \(HO /,
  stop: (l) => {
    const m = /^\*\*Also \(HO (\d+)/.exec(l);
    return m !== null && Number(m[1]) >= BEFORE;
  },
  marker: `the blocks before HO ${BEFORE} are in \`docs/roadmap-archive.md\`, verbatim and in order.`,
});

cutRange({
  path: "docs/oddities.md",
  archivePath: "docs/oddities-archive.md",
  title: "# CBT oddities archive",
  note: "> Entries moved out of `docs/oddities.md`, verbatim and in order. Nothing here is edited. A citation by an entry's title resolves here or in `docs/oddities.md`.",
  first: /^## /,
  stop: (l) => l.startsWith("## ") && maxHo(l) >= BEFORE,
  marker: `the entries above the first one whose heading names HO ${BEFORE} or later are in \`docs/oddities-archive.md\`, verbatim and in order.`,
});

backlog();

if (!WRITE) console.log("dry run: nothing written. Add --write to write the six files.");
