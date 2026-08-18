// HO 524 — Career participation (B2) Voteview ingest COST PROBE (READ-ONLY).
//
// Instrument-first step gating the heavy B2 build (HO 525). Downloads a handful of
// real Voteview votes files to /tmp, stream-parses them row-by-row, and measures
// download/parse/memory so the full-range sync can be spec'd against numbers, not
// guesses. NO DB writes, NO new table, NO commit. Throwaway.
//
//   npx tsx scripts/diagnostic/career-votes-cost-probe-524.ts
//
// Answers the four HO-524 unknowns:
//   §1  current-member icpsr coverage (who gets a career figure at all)
//   §2  the Congress range (earliest served -> file list)
//   §3  ingest cost + accumulation correctness (the GO/NO-GO number)
//   §4  rollup shape + a long-server cross-check
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdtemp, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../../lib/db";
import { VOTEVIEW_HSALL_URL } from "../voteview-source";

type Db = ReturnType<typeof getDb>;

const VOTES_BASE = "https://voteview.com/static/data/out/votes";
// Voteview zero-pads the congress number to width 3 in votes filenames
// (H094_votes.csv, H119_votes.csv). Unpadded H94 404s.
const votesUrl = (chamber: "H" | "S", congress: number) =>
  `${VOTES_BASE}/${chamber}${String(congress).padStart(3, "0")}_votes.csv`;

function fmtMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)}MB`;
}
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

// A crude monotonic clock that doesn't need Date.now() semantics we care about —
// tsx/node give us performance.now().
const now = () => performance.now();

// ─────────────────────────────────────────────────────────────────────────────
// §1 — current-member icpsr coverage
// ─────────────────────────────────────────────────────────────────────────────
async function icpsrCoverage(db: Db) {
  // Denominator: current roster. member_ideology is keyed by bioguide_id and
  // carries icpsr for each matched current member (one row per member, cong 119).
  const res = await db.execute(`
    SELECT m.bioguide_id, m.name, m.chamber, mi.icpsr AS ideo_icpsr, mid.icpsr AS crosswalk_icpsr
    FROM members m
    LEFT JOIN member_ideology mi ON mi.bioguide_id = m.bioguide_id
    LEFT JOIN member_ids       mid ON mid.bioguide_id = m.bioguide_id
    WHERE m.is_current = 1
  `);

  const icpsrByBioguide = new Map<string, number>();
  const withIcpsr: string[] = [];
  const withoutIcpsr: { bioguide: string; name: string; type: string }[] = [];

  for (const r of res.rows) {
    const bio = r.bioguide_id as string;
    // Prefer member_ideology.icpsr (the handoff's stated source); fall back to the
    // crosswalk so we report the TRUE "no icpsr anywhere" set, not just ideo gaps.
    const icpsr =
      (r.ideo_icpsr as number | null) ?? (r.crosswalk_icpsr as number | null);
    if (icpsr != null && Number.isFinite(Number(icpsr))) {
      icpsrByBioguide.set(bio, Number(icpsr));
      withIcpsr.push(bio);
    } else {
      withoutIcpsr.push({
        bioguide: bio,
        name: (r.name as string) ?? "",
        type: (r.chamber as string) ?? "?",
      });
    }
  }

  const total = res.rows.length;
  console.log("=== §1  CURRENT-MEMBER ICPSR COVERAGE ===\n");
  console.log(`current roster (is_current=1) ......... ${total}`);
  console.log(
    `  carry an icpsr (ideo|crosswalk) ..... ${withIcpsr.length}  (${((100 * withIcpsr.length) / total).toFixed(1)}%)`,
  );
  console.log(
    `  NO icpsr -> no career figure ........ ${withoutIcpsr.length}`,
  );
  for (const m of withoutIcpsr) {
    console.log(`      ${m.bioguide}  ${m.name.padEnd(28)} type=${m.type}`);
  }
  console.log("");
  return icpsrByBioguide; // bioguide -> icpsr, current members only
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the Congress range (min served congress per current icpsr, via HSall)
// ─────────────────────────────────────────────────────────────────────────────
// HSall_members.csv column order: congress(0),chamber(1),icpsr(2),...,bioname(9),...
// congress + icpsr both sit BEFORE the quoted bioname comma-trap, so a naive
// split(',') is safe for exactly these two leading columns (documented, throwaway).
async function congressRange(currentIcpsrs: Set<number>) {
  console.log("=== §2  CONGRESS RANGE (earliest served per current member) ===\n");
  const t0 = now();
  const res = await fetch(VOTEVIEW_HSALL_URL);
  if (!res.ok) throw new Error(`HSall HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  console.log(
    `HSall_members.csv .... ${fmtMB(Buffer.byteLength(text))} / ${lines.length} rows / ${fmtMs(now() - t0)}`,
  );

  const minCongress = new Map<number, number>(); // icpsr -> earliest congress seen
  const congressesByIcpsr = new Map<number, Set<number>>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const comma1 = line.indexOf(",");
    const comma2 = line.indexOf(",", comma1 + 1);
    const comma3 = line.indexOf(",", comma2 + 1);
    const congress = Number(line.slice(0, comma1));
    const icpsr = Number(line.slice(comma2 + 1, comma3));
    if (!currentIcpsrs.has(icpsr)) continue;
    const prev = minCongress.get(icpsr);
    if (prev === undefined || congress < prev) minCongress.set(icpsr, congress);
    let set = congressesByIcpsr.get(icpsr);
    if (!set) congressesByIcpsr.set(icpsr, (set = new Set()));
    set.add(congress);
  }

  let earliest = 119;
  let earliestIcpsr = 0;
  for (const [icpsr, c] of minCongress) {
    if (c < earliest) {
      earliest = c;
      earliestIcpsr = icpsr;
    }
  }
  const matchedIcpsrs = minCongress.size;
  console.log(
    `current icpsrs found in HSall ......... ${matchedIcpsrs} / ${currentIcpsrs.size}`,
  );
  console.log(
    `earliest served congress .............. ${earliest}  (icpsr ${earliestIcpsr})`,
  );
  const nCongresses = 119 - earliest + 1;
  console.log(
    `file range ............................ ${earliest} -> 119  = ${nCongresses} congresses x 2 chambers = ${nCongresses * 2} files\n`,
  );
  return { earliest, earliestIcpsr, nCongresses, congressesByIcpsr };
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 — download + stream-parse one votes file; accumulate participation buckets
// ─────────────────────────────────────────────────────────────────────────────
type FileMeasure = {
  label: string;
  bytes: number;
  downloadMs: number;
  parseMs: number;
  rowsTotal: number;
  rowsMatched: number;
  peakRssMB: number;
};

// Per-icpsr accumulation across ALL parsed files (this is the rollup preview).
type Accum = {
  cast: number; // 1..8 incl. Present (7/8) — see the cast_code finding below
  miss: number; // 9  Not Voting
  excluded: number; // 0  not seated
};
const accum = new Map<number, Accum>();
const bucket = (icpsr: number): Accum => {
  let a = accum.get(icpsr);
  if (!a) accum.set(icpsr, (a = { cast: 0, miss: 0, excluded: 0 }));
  return a;
};

// Global cast_code census (correctness check — surfaces codes the model omits).
const codeCensus = new Map<number, number>();

async function measureFile(
  chamber: "H" | "S",
  congress: number,
  currentIcpsrs: Set<number>,
  tmp: string,
): Promise<FileMeasure> {
  const label = `${chamber}${congress}`;
  const url = votesUrl(chamber, congress);
  const path = join(tmp, `${label}_votes.csv`);

  // Download (stream to disk so we never full-load) + measure size/time.
  const dl0 = now();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${label} HTTP ${res.status}`);
  const fileStream = createWriteStream(path);
  let bytes = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    fileStream.write(Buffer.from(value));
  }
  await new Promise<void>((resolve) => fileStream.end(resolve));
  const downloadMs = now() - dl0;

  // Stream-parse from disk, row-by-row, NEVER holding the whole file. We read the
  // file back as a stream, split on newlines, keep a remainder buffer.
  const { createReadStream } = await import("node:fs");
  const parse0 = now();
  let rowsTotal = 0;
  let rowsMatched = 0;
  let peakRss = process.memoryUsage().rss;
  let remainder = "";
  let headerSeen = false;

  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(path, { encoding: "utf8" });
    rs.on("data", (chunk: string | Buffer) => {
      const buf = remainder + chunk.toString();
      let start = 0;
      for (;;) {
        const nl = buf.indexOf("\n", start);
        if (nl === -1) break;
        let line = buf.slice(start, nl);
        start = nl + 1;
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!headerSeen) {
          headerSeen = true;
          continue;
        }
        if (!line) continue;
        // congress,chamber,rollnumber,icpsr,cast_code,prob  — all numeric/simple,
        // no quoted fields in the votes matrix, so split(',') is exact here.
        const parts = line.split(",");
        rowsTotal++;
        const icpsr = Number(parts[3]);
        const code = Number(parts[4]);
        codeCensus.set(code, (codeCensus.get(code) ?? 0) + 1);
        if (!currentIcpsrs.has(icpsr)) continue;
        rowsMatched++;
        const b = bucket(icpsr);
        if (code === 9) b.miss++;
        else if (code === 0) b.excluded++;
        else if (code >= 1 && code <= 8) b.cast++; // 7/8 = Present = participated
      }
      remainder = buf.slice(start);
      const rss = process.memoryUsage().rss;
      if (rss > peakRss) peakRss = rss;
    });
    rs.on("end", () => {
      // flush the final line (files may not end in \n)
      if (remainder && headerSeen) {
        const parts = remainder.split(",");
        rowsTotal++;
        const icpsr = Number(parts[3]);
        const code = Number(parts[4]);
        if (Number.isFinite(code)) {
          codeCensus.set(code, (codeCensus.get(code) ?? 0) + 1);
          if (currentIcpsrs.has(icpsr)) {
            rowsMatched++;
            const b = bucket(icpsr);
            if (code === 9) b.miss++;
            else if (code === 0) b.excluded++;
            else if (code >= 1 && code <= 8) b.cast++;
          }
        }
      }
      resolve();
    });
    rs.on("error", reject);
  });
  const parseMs = now() - parse0;
  const peakRssMB = peakRss / 1_000_000;

  return {
    label: `${chamber}${congress}`,
    bytes,
    downloadMs,
    parseMs,
    rowsTotal,
    rowsMatched,
    peakRssMB,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const db = getDb();
  const icpsrByBioguide = await icpsrCoverage(db);
  const currentIcpsrs = new Set(icpsrByBioguide.values());

  const { earliest, earliestIcpsr, nCongresses, congressesByIcpsr } =
    await congressRange(currentIcpsrs);

  // §3 — download + parse: 119th (H+S) and the earliest-served congress (H+S).
  console.log("=== §3  INGEST COST + ACCUMULATION ===\n");
  const tmp = await mkdtemp(join(tmpdir(), "cbt-voteview-524-"));
  const measures: FileMeasure[] = [];
  const targets: [("H" | "S"), number][] = [
    ["H", 119],
    ["S", 119],
    ["H", earliest],
    ["S", earliest],
  ];
  for (const [chamber, congress] of targets) {
    try {
      const m = await measureFile(chamber, congress, currentIcpsrs, tmp);
      measures.push(m);
      console.log(
        `${m.label.padEnd(5)} dl ${fmtMB(m.bytes).padStart(7)} / ${fmtMs(m.downloadMs).padStart(6)}   ` +
          `parse ${fmtMs(m.parseMs).padStart(6)} peak-rss ${m.peakRssMB.toFixed(0)}MB   ` +
          `rows ${m.rowsTotal} -> matched ${m.rowsMatched}`,
      );
    } catch (e) {
      console.log(`${chamber}${congress}: FAILED ${(e as Error).message}`);
    }
  }

  // cast_code census — THE correctness check.
  console.log("\ncast_code census (all parsed rows):");
  const codes = [...codeCensus.entries()].sort((a, b) => a[0] - b[0]);
  const CODE_MEANING: Record<number, string> = {
    0: "not seated (EXCLUDE)",
    1: "Yea",
    2: "Paired Yea",
    3: "Announced Yea",
    4: "Announced Nay",
    5: "Paired Nay",
    6: "Nay",
    7: "Present",
    8: "Present",
    9: "Not Voting (MISS)",
  };
  for (const [code, n] of codes) {
    const flag =
      code === 7 || code === 8
        ? "  <- PRESENT: not in handoff's {0,1-6,9} model — counted as CAST"
        : "";
    console.log(
      `   ${String(code).padStart(2)} ${(CODE_MEANING[code] ?? "?").padEnd(22)} ${String(n).padStart(8)}${flag}`,
    );
  }

  // Extrapolation to the full range.
  const houseFiles = measures.filter((m) => m.label.startsWith("H"));
  const senFiles = measures.filter((m) => m.label.startsWith("S"));
  const avg = (arr: FileMeasure[], sel: (m: FileMeasure) => number) =>
    arr.length ? arr.reduce((s, m) => s + sel(m), 0) / arr.length : 0;
  const avgHBytes = avg(houseFiles, (m) => m.bytes);
  const avgSBytes = avg(senFiles, (m) => m.bytes);
  const avgHParse = avg(houseFiles, (m) => m.parseMs);
  const avgSParse = avg(senFiles, (m) => m.parseMs);
  const avgHDl = avg(houseFiles, (m) => m.downloadMs);
  const avgSDl = avg(senFiles, (m) => m.downloadMs);
  const peakRss = Math.max(...measures.map((m) => m.peakRssMB));

  const projBytes = nCongresses * (avgHBytes + avgSBytes);
  const projDl = nCongresses * (avgHDl + avgSDl);
  const projParse = nCongresses * (avgHParse + avgSParse);
  console.log("\n--- EXTRAPOLATION to full range (naive avg-per-chamber x nCongresses) ---");
  console.log(`  congresses .......... ${nCongresses} (x2 chambers = ${nCongresses * 2} files)`);
  console.log(`  projected download .. ${fmtMB(projBytes)}  in ~${fmtMs(projDl)}`);
  console.log(`  projected parse ..... ~${fmtMs(projParse)}`);
  console.log(`  peak RSS (bounded) .. ${peakRss.toFixed(0)}MB  (streaming, per-file — does NOT grow with range)`);
  console.log(
    "  NOTE: file size is (members x rollcalls), NOT monotonic in age — H94 measured 14MB vs H119 7.4MB.",
  );
  console.log(
    "  Only the two ENDPOINT congresses were sampled; mid-range files unmeasured, so treat as an order-of-magnitude.",
  );

  // §4 — rollup shape + long-server cross-check (partial, from the 2 congresses).
  console.log("\n=== §4  ROLLUP SHAPE + CROSS-CHECK ===\n");
  console.log("per-member rollup the build will store (keyed by bioguide):");
  console.log(
    "  career_eligible = Σ(cast+miss)  |  career_missed = Σ(code==9)  |  career_missed_pct  |  first_congress  |  congresses_served",
  );
  console.log(
    "  (cast now = codes 1-8, i.e. Present counts as participation, NOT a miss)\n",
  );

  // Cross-check the earliest-served member (longest tenure) — likely a known
  // long-server. Report their PARTIAL rollup from just the parsed congresses.
  const bioguideByIcpsr = new Map<number, string>();
  for (const [bio, ic] of icpsrByBioguide) bioguideByIcpsr.set(ic, bio);
  const probeIcpsrs = new Set<number>([earliestIcpsr]);
  // Also add whichever current member has the most parsed rows (sanity spread).
  let maxRowsIcpsr = 0;
  let maxRows = -1;
  for (const [ic, a] of accum) {
    const tot = a.cast + a.miss;
    if (tot > maxRows) {
      maxRows = tot;
      maxRowsIcpsr = ic;
    }
  }
  probeIcpsrs.add(maxRowsIcpsr);

  const nameRes = await db.execute(`
    SELECT mi.icpsr, m.name FROM member_ideology mi
    JOIN members m ON m.bioguide_id = mi.bioguide_id
  `);
  const nameByIcpsr = new Map<number, string>();
  for (const r of nameRes.rows)
    nameByIcpsr.set(Number(r.icpsr), (r.name as string) ?? "");

  for (const ic of probeIcpsrs) {
    const a = accum.get(ic);
    if (!a) {
      console.log(`  icpsr ${ic}: no rows in the 2 parsed congresses`);
      continue;
    }
    const eligible = a.cast + a.miss;
    const pct = eligible > 0 ? (100 * a.miss) / eligible : 0;
    const served = [...(congressesByIcpsr.get(ic) ?? [])].sort((x, y) => x - y);
    console.log(
      `  ${nameByIcpsr.get(ic) ?? "?"} (icpsr ${ic}, bioguide ${bioguideByIcpsr.get(ic) ?? "?"})`,
    );
    console.log(
      `     PARTIAL (congresses ${earliest} & 119 only): eligible=${eligible} missed=${a.miss} -> ${pct.toFixed(1)}%   full-career-served=[${served[0]}..${served[served.length - 1]}] (${served.length} congresses)`,
    );
  }

  await rm(tmp, { recursive: true, force: true });
  console.log("\n(scratch files removed; no DB writes, no commit)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
