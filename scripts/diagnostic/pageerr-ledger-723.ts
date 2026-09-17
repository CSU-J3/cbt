// HO 723 — the `pageErr` week ledger. COMMITTED, READ-ONLY BY CONSTRUCTION: no DB
// import, no prod URL, `gh` and `git show` only. Not a fix.
//
// WHAT IT MEASURES. Every `e2e-prod.yml` run since a given instant, read from the
// per-route `pageErr=` lines the smoke crawl prints (`e2e/smoke.spec.ts:769-775`),
// the detail line under them (`:782-799`) and the `[stage-click]` line (`:1009`),
// classified by what each run can and cannot be evidence of, and tallied into the
// week `docs/backlog.md` `:60` and `:96` close on (seven consecutive dailies with the
// `#418` channel at zero, counted from the first daily after HO 706's FF).
//
// WHAT ITS ZERO MEANS. A `ZERO` row is a complete crawl (every route in that run's
// OWN `ROUTES` list printed, plus the stage click) whose `pageErr` counts are all 0.
// It is never "the log was empty": an absent reading is `NO-LOG`, `NO-FLOOR` or
// `PARTIAL`, and none of those count.
//
// THE CONVENTIONS, each with where it comes from:
//   1. Counts come from per-route lines, never conclusions. `--retries=2`
//      (`e2e-prod.yml:246`) lets a fire-carrying run conclude `success`
//      (backlog `:60` method note: 2026-08-29, `success` with seven fire-lines).
//      Three counts of the event are printed: fire-HITS (the headline, one per hit
//      with at least one `#418` message), fire-LINES (detail lines carrying one:
//      HO 687's unit, so this ledger reads against that one) and fire-MESSAGES.
//   2. A missing reading is an absence, never a zero. `gh` is called SERIALLY (six
//      parallel `gh run view` calls produced 110 empty files on the Windows box,
//      `members-500-correlation-593.ts:9-13`); a `gh` error is recorded as
//      `log unavailable(<first stderr line>)` and never skipped (the swallow at
//      `pageerr-hydration-589.ts:123` is what this replaces).
//   3. A `#418` and any other `pageErr` are different findings. `PAGEERR_MARK`
//      (`smoke.spec.ts:395`) classifies each message on its own: the detail field
//      runs from `pageErr#N=[` to the next `  |  ` (`msgs.join` at `:799`; messages
//      are whitespace-collapsed at `:784`, so two spaces never occur inside one) and
//      splits on ` ¦ `. Per hit, the message count must equal the route line's
//      `pageErr=N`, else `COUNT-MISMATCH`. `[stage-click]` prints no detail, so a
//      nonzero there is counted and named unattributed.
//   4. The dumps artifact is a second instrument. `pageerr-dumps` uploads on file
//      presence (`e2e-prod.yml:278-284`), so FIRE without it (and no cap-skip
//      `:558` / capture-void `:565` line) or ZERO with it is `ARTIFACT-MISMATCH`.
//      The `mut` line is a third: `fire-t=` is printed only when `__mut.fireT` was
//      set (`:213`, on `/418/`; printed `:343-345`), so per hit `fire-t=` and a
//      `#418` message must agree, else `MUT-MISMATCH`. Lines with no `mut` field
//      (crawls before HO 702) and `mut=UNINSTALLED` hits are not compared.
//   5. Only `schedule` runs count toward the week. Production `deployment_status`
//      runs are samples of the same channel; Preview ones skip `smoke`
//      (`e2e-prod.yml:120-123`) and read `SKIPPED`.
//   6. A gap does not reset; a fire does (HO 707). A daily reading `PARTIAL`,
//      `NO-LOG` or `NO-FLOOR` is a gap named by date; a `FIRE` resets the count and
//      reopens HO 705's report path (backlog `:60`).
//
// THE FLOOR IS THE RUN'S OWN LIST (HO 723 STEP 0 ruling § 3). `ROUTES` went 36 → 37
// inside the week (`6471b02`), so HEAD's length is the wrong floor for older runs.
// Each run's floor is `git show <headSha>:e2e/routes.ts`, written to the repo-ignored
// `scripts/diagnostic/scratch/` and imported; unreadable (e.g. a SHA before the file
// existed, HO 694 `d189ad4`) is `NO-FLOOR`, never a guessed number.
//
// THE CONTROLS, run before any zero is believed. The self-test parses verbatim log
// lines from the record (the weaker control). Then every `--control` run is harvested
// and must read fire-hits >= 1, or the instrument prints `CONTROL FAILED` and exits 2.
//
//   npx tsx scripts/diagnostic/pageerr-ledger-723.ts --selftest
//   npx tsx scripts/diagnostic/pageerr-ledger-723.ts --since <ISO> --control <id> [--control <id>] --out <dir> [--until <ISO>]
//   npx tsx scripts/diagnostic/pageerr-ledger-723.ts --since <ISO> --control <id> --from-dir <dir>   # re-parse saved logs, no API
//
// `--since` has no default on purpose: a baked FF instant is a baked pointer.
// Exit: 0 clean harvest · 1 any FIRE, OTHER-ERR or mismatch · 2 control failed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROUTES } from "../../e2e/routes";

const ROOT = process.cwd();
const SCRATCH = join(ROOT, "scripts/diagnostic/scratch");
const PAGEERR_MARK = /Minified React error #418/; // smoke.spec.ts:395, copied not imported (the spec imports Playwright)

// ── the parser ───────────────────────────────────────────────────────────────
// Unanchored throughout: `gh run view --log` prefixes each line with
// `<job>\t<step>\t<timestamp> `. `_` is in the class because `home-stage-other_chamber`
// is a route (STEP 0 row 7).
const SLUG = "[a-z0-9_-]+";
const SLUG_FULL = new RegExp(`^${SLUG}$`);
const ROUTE_RE = new RegExp(`\\[(${SLUG})\\] hit1=(\\d+) .*? pageErr=(\\d+)(.*?) \\| hit2=(\\d+) .*? pageErr=(\\d+)(.*)$`);
const DETAIL_RE = new RegExp(`\\[(${SLUG})\\] ((?:pageErr|console|bad)#[12]=\\[.*|dump=.*)$`);
const STAGE_RE = /\[stage-click\] url=\S* console=(\d+) pageErr=(\d+)/;
const DUMP_WRITTEN_RE = new RegExp(`\\[(${SLUG})\\] pageerr-dump hit=\\d+ att=\\d+ `);
const DUMP_SKIPPED_RE = new RegExp(`\\[(${SLUG})\\] pageerr-dump SKIPPED \\(cap`);
const DUMP_VOID_RE = new RegExp(`\\[(${SLUG})\\] pageerr-dump hit=\\d+: no served bytes retained`);

type MutState = "installed" | "uninstalled" | "absent";
type Hit = { pageErr: number; mut: MutState; fireT: boolean; msgs: string[] | null };
type RouteLine = { slug: string; hits: [Hit, Hit] };

export type Parsed = {
  routeLines: number;
  distinct: string[];
  stageClick: number;
  stagePageErr: number;
  readings: number;
  nonzeroLines: number;
  fireHits: number;
  fireLines: number;
  fireMessages: number;
  fireT: number;
  mutCompared: number;
  mutMismatch: string[];
  countMismatch: string[];
  other: Array<{ slug: string; hit: number; msg: string }>;
  fires: string[]; // `[slug] pageErr#N=[…]` per fire-hit, for the per-hit line
  dumps: { written: number; skipped: number; void: number };
  filtered: string[];
};

function mutOf(rest: string): { mut: MutState; fireT: boolean } {
  if (/\bmut=UNINSTALLED\b/.test(rest)) return { mut: "uninstalled", fireT: false };
  if (/ mut (kept|pre)=/.test(rest)) return { mut: "installed", fireT: / fire-t=/.test(rest) };
  return { mut: "absent", fireT: false };
}

export function parseLog(text: string): Parsed {
  const lines: RouteLine[] = [];
  const p: Parsed = {
    routeLines: 0, distinct: [], stageClick: 0, stagePageErr: 0, readings: 0, nonzeroLines: 0,
    fireHits: 0, fireLines: 0, fireMessages: 0, fireT: 0, mutCompared: 0, mutMismatch: [],
    countMismatch: [], other: [], fires: [], dumps: { written: 0, skipped: 0, void: 0 }, filtered: [],
  };
  const orphans: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const r = ROUTE_RE.exec(line);
    if (r) {
      const m1 = mutOf(r[4]!), m2 = mutOf(r[7]!);
      lines.push({
        slug: r[1]!,
        hits: [
          { pageErr: Number(r[3]), ...m1, msgs: null },
          { pageErr: Number(r[6]), ...m2, msgs: null },
        ],
      });
      p.filtered.push(line);
      continue;
    }
    const s = STAGE_RE.exec(line);
    if (s) { p.stageClick++; p.stagePageErr += Number(s[2]); p.filtered.push(line); continue; }
    if (DUMP_SKIPPED_RE.test(line)) { p.dumps.skipped++; p.filtered.push(line); continue; }
    if (DUMP_VOID_RE.test(line)) { p.dumps.void++; p.filtered.push(line); continue; }
    if (DUMP_WRITTEN_RE.test(line)) { p.dumps.written++; p.filtered.push(line); continue; }
    const d = DETAIL_RE.exec(line);
    if (d) {
      p.filtered.push(line);
      // A detail line follows its own route line (smoke.spec.ts:769 then :799).
      let owner: RouteLine | undefined;
      for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.slug === d[1]) { owner = lines[i]; break; }
      for (const seg of d[2]!.split("  |  ")) {
        const pm = /^pageErr#([12])=\[(.*)\]$/.exec(seg);
        if (!pm) continue;
        if (!owner) { orphans.push(`${d[1]}#${pm[1]}`); continue; }
        owner.hits[Number(pm[1]) - 1]!.msgs = pm[2]!.split(" ¦ ");
      }
    }
  }

  const seen = new Set<string>();
  for (const l of lines) {
    seen.add(l.slug);
    p.readings += 2;
    if (l.hits[0].pageErr > 0 || l.hits[1].pageErr > 0) p.nonzeroLines++;
    let lineFires = false;
    l.hits.forEach((h, i) => {
      const msgs = h.msgs ?? [];
      if (msgs.length !== h.pageErr) p.countMismatch.push(`${l.slug}#${i + 1}:${h.pageErr}≠${msgs.length}`);
      const f = msgs.filter((m) => PAGEERR_MARK.test(m));
      for (const m of msgs) if (!PAGEERR_MARK.test(m)) p.other.push({ slug: l.slug, hit: i + 1, msg: m });
      if (f.length) {
        p.fireHits++; p.fireMessages += f.length; lineFires = true;
        p.fires.push(`[${l.slug}] pageErr#${i + 1}=[${f[0]!.slice(0, 60)}…]`);
      }
      if (h.fireT) p.fireT++;
      if (h.mut === "installed") {
        p.mutCompared++;
        if (h.fireT !== f.length > 0) p.mutMismatch.push(`${l.slug}#${i + 1}:fire-t=${h.fireT ? 1 : 0},#418=${f.length}`);
      }
    });
    if (lineFires) p.fireLines++;
  }
  for (const o of orphans) p.countMismatch.push(`${o}:orphan-detail`);
  p.routeLines = lines.length;
  p.distinct = [...seen].sort();
  p.readings += p.stageClick;
  if (p.stagePageErr > 0) p.nonzeroLines++;
  return p;
}

// ── gh, serially ─────────────────────────────────────────────────────────────
type Meta = {
  databaseId: number; event: string; status: string; conclusion: string; createdAt: string;
  headSha: string; url: string;
  jobs: Array<{ name: string; conclusion: string }> | null; jobsError?: string;
  artifacts: Array<{ name: string; expired: boolean }> | null; artifactsError?: string;
  logError?: string;
};

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
function firstErrLine(e: unknown): string {
  const x = e as { stderr?: string | Buffer; message?: string };
  const s = (x.stderr ? String(x.stderr) : "") || x.message || String(e);
  return s.trim().split("\n")[0]!.slice(0, 160);
}

type ListRow = Pick<Meta, "databaseId" | "event" | "status" | "conclusion" | "createdAt" | "headSha" | "url">;
function listRuns(sinceDate: string): ListRow[] {
  return JSON.parse(gh(["run", "list", "--workflow", "e2e-prod.yml", "--created", `>=${sinceDate}`, "--limit", "500",
    "--json", "databaseId,event,status,conclusion,createdAt,headSha,url"])) as ListRow[];
}
function listRow(id: number): ListRow {
  return JSON.parse(gh(["run", "view", String(id), "--json", "databaseId,event,status,conclusion,createdAt,headSha,url"])) as ListRow;
}

function fetchRun(row: ListRow, out: string | null): { meta: Meta; log: string | null } {
  const meta: Meta = { ...row, jobs: null, artifacts: null };
  try {
    const j = JSON.parse(gh(["run", "view", String(row.databaseId), "--json", "jobs"])) as { jobs: Array<{ name: string; conclusion: string }> };
    meta.jobs = j.jobs.map((x) => ({ name: x.name, conclusion: x.conclusion }));
  } catch (e) { meta.jobsError = firstErrLine(e); }
  let log: string | null = null;
  if (row.status !== "completed") meta.logError = `run ${row.status}`;
  else {
    try { log = gh(["run", "view", String(row.databaseId), "--log"]); }
    catch (e) { meta.logError = firstErrLine(e); }
  }
  try {
    const a = JSON.parse(gh(["api", `repos/{owner}/{repo}/actions/runs/${row.databaseId}/artifacts`])) as { artifacts: Array<{ name: string; expired: boolean }> };
    meta.artifacts = a.artifacts.map((x) => ({ name: x.name, expired: x.expired }));
  } catch (e) { meta.artifactsError = firstErrLine(e); }
  if (out) {
    writeFileSync(join(out, `${row.databaseId}.meta.json`), JSON.stringify(meta, null, 2));
    if (log !== null) {
      writeFileSync(join(out, `${row.databaseId}.log`), log);
      writeFileSync(join(out, `${row.databaseId}.txt`), parseLog(log).filtered.join("\n") + "\n");
    }
  }
  return { meta, log };
}

function loadRun(dir: string, id: number): { meta: Meta; log: string | null } {
  const mp = join(dir, `${id}.meta.json`);
  if (!existsSync(mp)) throw new Error(`--from-dir: no ${id}.meta.json in ${dir}`);
  const meta = JSON.parse(readFileSync(mp, "utf8")) as Meta;
  const lp = join(dir, `${id}.log`);
  const log = existsSync(lp) ? readFileSync(lp, "utf8") : null;
  if (log === null && !meta.logError) meta.logError = "log file absent from --from-dir";
  return { meta, log };
}

// ── the floor: the run's own ROUTES ──────────────────────────────────────────
const floorCache = new Map<string, { floor: number | null; why?: string }>();
async function floorFor(sha: string): Promise<{ floor: number | null; why?: string }> {
  const hit = floorCache.get(sha);
  if (hit) return hit;
  let res: { floor: number | null; why?: string };
  try {
    const src = execFileSync("git", ["show", `${sha}:e2e/routes.ts`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    mkdirSync(SCRATCH, { recursive: true });
    const p = join(SCRATCH, `routes-${sha.slice(0, 7)}.ts`);
    writeFileSync(p, src);
    const mod = (await import(pathToFileURL(p).href)) as { ROUTES?: unknown[]; default?: { ROUTES?: unknown[] } };
    const list = mod.ROUTES ?? mod.default?.ROUTES;
    res = Array.isArray(list) ? { floor: list.length } : { floor: null, why: "no ROUTES export" };
  } catch (e) {
    res = { floor: null, why: firstErrLine(e) };
  }
  floorCache.set(sha, res);
  return res;
}

// ── verdicts ─────────────────────────────────────────────────────────────────
type Verdict = "SKIPPED" | "NO-LOG" | "FIRE" | "NO-FLOOR" | "PARTIAL" | "OTHER-ERR" | "ZERO";
type Rec = {
  id: number; event: string; createdAt: string; sha: string; conclusion: string; smoke: string;
  log: string; floor: number | null; floorWhy?: string; p: Parsed | null; artifacts: string;
  hasDumps: boolean | null; verdict: Verdict; flags: string[]; url: string;
};

async function classify(meta: Meta, log: string | null): Promise<Rec> {
  const smokeJob = meta.jobs?.find((j) => j.name === "smoke");
  const smoke = meta.jobs === null ? `jobs unavailable(${meta.jobsError})` : smokeJob ? smokeJob.conclusion || "(none)" : "absent";
  const arts = meta.artifacts;
  const rec: Rec = {
    id: meta.databaseId, event: meta.event, createdAt: meta.createdAt, sha: meta.headSha.slice(0, 7),
    conclusion: meta.conclusion, smoke, log: log === null ? `unavailable(${meta.logError ?? "?"})` : "ok",
    floor: null, p: null,
    artifacts: arts === null ? `unavailable(${meta.artifactsError})` : arts.length ? arts.map((a) => a.name + (a.expired ? "(expired)" : "")).join(",") : "[]",
    hasDumps: arts === null ? null : arts.some((a) => a.name === "pageerr-dumps"),
    verdict: "ZERO", flags: [], url: meta.url,
  };
  if (smokeJob?.conclusion === "skipped" || (meta.jobs !== null && !smokeJob)) { rec.verdict = "SKIPPED"; return rec; }
  if (log === null) { rec.verdict = "NO-LOG"; return rec; }
  const p = parseLog(log);
  rec.p = p;
  const fl = await floorFor(meta.headSha);
  rec.floor = fl.floor; rec.floorWhy = fl.why;
  if (p.routeLines === 0) { rec.verdict = "NO-LOG"; rec.log = "ok, no route line"; return rec; }
  if (p.fireHits > 0) rec.verdict = "FIRE"; // a fire is a fire in a partial or floorless crawl too (convention 6)
  else if (fl.floor === null) rec.verdict = "NO-FLOOR";
  else if (p.distinct.length < fl.floor || p.stageClick === 0) rec.verdict = "PARTIAL";
  else if (p.other.length > 0 || p.stagePageErr > 0) rec.verdict = "OTHER-ERR";
  else rec.verdict = "ZERO";
  if (rec.hasDumps !== null) {
    const excused = p.dumps.skipped > 0 || p.dumps.void > 0;
    if ((rec.verdict === "FIRE" && !rec.hasDumps && !excused) || (rec.verdict === "ZERO" && rec.hasDumps)) rec.flags.push("ARTIFACT-MISMATCH");
  }
  if (p.countMismatch.length) rec.flags.push("COUNT-MISMATCH");
  if (p.mutMismatch.length) rec.flags.push("MUT-MISMATCH");
  return rec;
}

// ── output ───────────────────────────────────────────────────────────────────
const HEAD_ROW =
  "| run | event | created (UTC) | sha | concl. | smoke | log | floor | routes | readings | stage | nz lines | fire hits · lines · msgs | fire-t (cmp) | other | dumps w/s/v | artifacts | verdict |\n" +
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
function row(r: Rec): string {
  const p = r.p;
  const dash = "—";
  const cells = [
    String(r.id), r.event, r.createdAt.replace("T", " ").replace("Z", ""), r.sha, r.conclusion, r.smoke, r.log,
    r.floor === null ? (p ? `NO-FLOOR(${r.floorWhy})` : dash) : String(r.floor),
    p ? `${p.distinct.length} / ${r.floor ?? "?"}` : dash,
    p ? `${p.readings} / ${r.floor === null ? "?" : 2 * r.floor + 1}` : dash,
    p ? `${p.stageClick}${p.stagePageErr ? ` (pageErr=${p.stagePageErr} unattributed)` : ""}` : dash,
    p ? String(p.nonzeroLines) : dash,
    p ? `**${p.fireHits}** · ${p.fireLines} · ${p.fireMessages}` : dash,
    p ? `${p.fireT} (${p.mutCompared})` : dash,
    p ? String(p.other.length) : dash,
    p ? `${p.dumps.written}/${p.dumps.skipped}/${p.dumps.void}` : dash,
    r.artifacts,
    `**${r.verdict}**${r.flags.length ? " " + r.flags.join(" ") : ""}`,
  ];
  return `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
}
function findings(r: Rec): string[] {
  const out: string[] = [];
  const p = r.p;
  if (!p) return out;
  for (const f of p.fires) out.push(`- \`${r.id}\` FIRE ${f}`);
  for (const o of p.other) out.push(`- \`${r.id}\` OTHER [${o.slug}] pageErr#${o.hit}=[${o.msg.slice(0, 120)}] sha ${r.sha}`);
  for (const c of p.countMismatch) out.push(`- \`${r.id}\` COUNT-MISMATCH ${c}`);
  for (const m of p.mutMismatch) out.push(`- \`${r.id}\` MUT-MISMATCH ${m}`);
  if (r.flags.includes("ARTIFACT-MISMATCH")) out.push(`- \`${r.id}\` ARTIFACT-MISMATCH verdict ${r.verdict}, artifacts ${r.artifacts}`);
  return out;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

// The samples line, extracted at HO 732 so the empty-window branch and the
// counting branch emit the SAME line rather than two copies that can drift.
// "Preview" here is the SKIPPED set renamed, not an environment read — see
// docs/oddities.md, "a ledger's Preview column is its own verdict".
function pushSamples(out: string[], recs: Rec[]): void {
  const prod = recs.filter((r) => r.event === "deployment_status" && r.verdict !== "SKIPPED");
  const prev = recs.filter((r) => r.event === "deployment_status" && r.verdict === "SKIPPED");
  const disp = recs.filter((r) => r.event !== "schedule" && r.event !== "deployment_status");
  const hist = (rs: Rec[]) => {
    const h: Record<string, number> = {};
    for (const r of rs) { const k = r.verdict + (r.flags.length ? "+" + r.flags.join("+") : ""); h[k] = (h[k] ?? 0) + 1; }
    return Object.entries(h).map(([k, v]) => `${v} ${k}`).join(" · ") || "none";
  };
  out.push(`- samples, not counted: ${prod.length} Production \`deployment_status\` runs: ${hist(prod)}; ${prev.length} Preview (SKIPPED); ${disp.length} other-event runs: ${hist(disp)}`);
}

function tally(recs: Rec[], since: string): string[] {
  const daily = recs.filter((r) => r.event === "schedule");
  const out: string[] = ["## Week tally (`schedule` runs only)", ""];
  // HO 732 — an empty window is an ABSENCE, and it must not render as a count.
  // With no `schedule` rows the loop below never runs, so every line in this
  // block except `samples` used to be computed over nothing: it printed
  // `0 of 7 … none` (indistinguishable from a window whose dailies all fired)
  // beside a `seventh due` date derived from `addDays(first − 1, 7)`, which is
  // arithmetic on a window with no dailies in it. HO 731's post-FF read printed
  // exactly that and the paste had to explain it in prose. The samples line is
  // the only line here that IS a reading of such a window, so it stays and the
  // rest is replaced by the statement that there is nothing to count.
  if (daily.length === 0) {
    out.push("- **no `schedule` runs in this window**: the week tally is not a reading of it; see the HO 723 close read for the seven that count");
    pushSamples(out, recs);
    return out;
  }
  // The first expected daily: the since date if the 15:00Z slot is still ahead of it, else the next day.
  const first = since.slice(11, 13) < "15" ? since.slice(0, 10) : addDays(since.slice(0, 10), 1);
  let count = 0;
  const gaps: string[] = [];
  const resets: string[] = [];
  const counted: string[] = [];
  const byDate = new Map<string, Rec[]>();
  for (const r of daily) { const k = r.createdAt.slice(0, 10); byDate.set(k, [...(byDate.get(k) ?? []), r]); }
  const last = daily.length ? daily[daily.length - 1]!.createdAt.slice(0, 10) : null;
  for (let d = first; last !== null && d <= last; d = addDays(d, 1)) {
    const rs = byDate.get(d);
    if (!rs) { gaps.push(`${d} (no schedule run)`); continue; }
    for (const r of rs) {
      const zeroChannel = r.p !== null && r.p.fireHits === 0 && r.p.stagePageErr === 0;
      if (r.verdict === "FIRE") { count = 0; counted.length = 0; resets.push(`${d} \`${r.id}\` ${r.p!.fires.join(" ; ")}`); }
      else if ((r.verdict === "ZERO" || r.verdict === "OTHER-ERR") && zeroChannel) { count++; counted.push(`${d} \`${r.id}\` ${r.verdict}`); }
      else gaps.push(`${d} \`${r.id}\` ${r.verdict}`);
    }
  }
  out.push(`- first daily after \`--since ${since}\`: ${first}; latest delivered: ${last ?? "none"}`);
  out.push(`- **${count} of 7** complete dailies with the \`#418\` channel at zero since the ${resets.length ? "last FIRE" : "FF"}: ${counted.join(" · ") || "none"}`);
  out.push(`- gaps (do not reset): ${gaps.length ? gaps.join(" · ") : "none"}`);
  out.push(`- FIRE resets: ${resets.length ? resets.join(" · ") : "none"}`);
  if (count >= 7) out.push(`- **SEVEN REACHED** on ${counted[6]!.slice(0, 10)}`);
  else out.push(`- seventh due on the current trajectory (no further gaps): **${addDays(last ?? addDays(first, -1), 7 - count)}**`);
  pushSamples(out, recs);
  return out;
}

// ── self-test: verbatim lines from the record, never composed ────────────────
// Copied byte-for-byte out of `gh run view <id> --log` (prefix included), source run beside each.
const FX = {
  // daily 34888719223 (2026-09-14)
  clean: "smoke\tRun prod smoke crawl\t2026-09-14T19:50:13.8116375Z [news] hit1=200 failed=0 bad=0 console=0 pageErr=0 mut kept=7(insert:6,text:1) loading=0 parser-dropped=908 post=7 lm[div.flex=241(-36ms) header=241(-36ms) .header-titlebar=241(-36ms) .header-sync-sub=241(-36ms) .header-nav-row=241(-36ms)] hyd-start=n/a last-flight=-9ms/2 hyd=n/a | hit2=200 failed=0 bad=0 console=0 pageErr=0 mut kept=8(insert:6,text:2) loading=0 parser-dropped=908 post=8 lm[div.flex=166(-63ms) header=166(-63ms) .header-titlebar=166(-63ms) .header-sync-sub=166(-63ms) .header-nav-row=166(-63ms)] hyd-start=n/a last-flight=0ms/2 hyd=n/a",
  // daily 34888719223 (2026-09-14)
  otherChamber: "smoke\tRun prod smoke crawl\t2026-09-14T19:48:37.0840850Z [home-stage-other_chamber] hit1=200 failed=0 bad=0 console=0 pageErr=0 mut kept=95(insert:55,remove:36,text:4) loading=0 parser-dropped=2636 post=95 lm[header=748(-96ms) div.flex=748(-96ms)] hyd-start=n/a last-flight=-16ms/2 hyd=n/a | hit2=200 failed=0 bad=0 console=0 pageErr=0 mut kept=93(insert:50,text:7,remove:36) loading=0 parser-dropped=2641 post=93 lm[header=405(-232ms) div.flex=575(-63ms)] hyd-start=n/a last-flight=-53ms/2 hyd=n/a",
  // daily 34888719223 (2026-09-14)
  stageClick: "smoke\tRun prod smoke crawl\t2026-09-14T19:49:55.6268809Z [stage-click] url=https://congressional-terminal-chi-silk.vercel.app/?stage=president console=0 pageErr=0",
  // Production 34176026988 (2026-09-08)
  mutFireDump: "smoke\tUNKNOWN STEP\t2026-09-08T01:17:47.1270851Z [home-stage-introduced] pageerr-dump hit=2 att=0 lcs(+128/-39) added=[span.markets-tape-item +6, span.markets-tape-symbol +6, span.markets-tape-price +12, div.markets-tape-set +2, span.markets-tape-pair-grp +12, span.source-tag +12] → test-results/pageerr-home-stage-introduced-hit2-att0.json",
  // Production 34176026988 (2026-09-08)
  mutFireRoute: "smoke\tUNKNOWN STEP\t2026-09-08T01:17:47.1992697Z [home-stage-introduced] hit1=200 failed=0 bad=0 console=0 pageErr=0 mut kept=86(text:8,insert:46,remove:32) loading=1 parser-dropped=2722 cd-loading=1 post=85 lm[header=618(-195ms) div.flex=618(-195ms)] hyd-start=-137ms last-flight=-7ms/113 HYD-BEFORE-TAIL | hit2=200 failed=0 bad=0 console=0 pageErr=1 mut pre=2(text:2) loading=17 parser-dropped=2734 cd-loading=2 rec=+0/-15 post=89 fire-t=1597ms(-5ms) first-post-t=+47ms dcl=1602ms lm[header=1389(-213ms) div.flex=1447(-155ms)] hyd-start=-210ms last-flight=-38ms/118 HYD-BEFORE-TAIL",
  // Production 34176026988 (2026-09-08)
  mutFireDetail: "smoke\tUNKNOWN STEP\t2026-09-08T01:17:47.2019458Z [home-stage-introduced] pageErr#2=[Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings.]  |  dump=test-results/pageerr-home-stage-introduced-hit2-att0.json",
  // dispatch 33794231177 (2026-09-03, the control)
  pre702Route: "smoke\tRun prod smoke crawl\t2026-09-03T19:04:57.2023598Z [home] hit1=200 failed=0 bad=0 console=0 pageErr=0 | hit2=200 failed=0 bad=0 console=0 pageErr=1",
  // dispatch 33794231177 (2026-09-03, the control)
  pre702Detail: "smoke\tRun prod smoke crawl\t2026-09-03T19:04:57.2025715Z [home] pageErr#2=[Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings.]  |  dump=test-results/pageerr-home-hit2-att0.json",
  // Production 30855057273 (2026-08-03, HO 593 window)
  otherRoute: "smoke\tUNKNOWN STEP\t2026-08-03T21:34:42.8375134Z [committees-redirect] hit1=500 failed=0 bad=1 console=1 pageErr=1 | hit2=200 failed=0 bad=0 console=0 pageErr=1",
  // Production 30855057273 (2026-08-03, HO 593 window)
  otherDetail: "smoke\tUNKNOWN STEP\t2026-08-03T21:34:42.8380842Z [committees-redirect] pageErr#1=[An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which m]  |  pageErr#2=[Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings.]  |  console#1=[Failed to load resource: the server responded with a status of 500 ()]  |  bad#1=[500 https://congressional-terminal-chi-silk.vercel.app/members]",
};

async function selftest(): Promise<boolean> {
  let ok = true;
  const check = (name: string, got: unknown, want: unknown) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    if (!pass) ok = false;
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(got)}${pass ? "" : ` want ${JSON.stringify(want)}`}`);
  };
  console.log("SELF-TEST (the weaker control: proves the parser reads the record's bytes, not that a live run is read)");
  // Content first: the list the class must cover.
  const bad = ROUTES.map((r) => r.slug).filter((s) => !SLUG_FULL.test(s));
  check(`every ROUTES slug matches ^${SLUG}$ (${ROUTES.length} slugs)`, bad, []);
  // Class second: the slug STEP 0 found the old class could not see, parsed off its daily.
  const oc = parseLog(FX.otherChamber);
  check("[home-stage-other_chamber] line (daily 34888719223) parses as one route line", [oc.routeLines, oc.distinct, oc.nonzeroLines], [1, ["home-stage-other_chamber"], 0]);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const hf = await floorFor(head);
  check("floor via git show HEAD:e2e/routes.ts equals the direct ROUTES import", hf.floor, ROUTES.length);
  const clean = parseLog(FX.clean);
  check("clean [news] route line (daily 34888719223): nz · fire-hits · fire-t · mut compared · mismatches", [clean.nonzeroLines, clean.fireHits, clean.fireT, clean.mutCompared, clean.countMismatch.length], [0, 0, 0, 2, 0]);
  const mf = parseLog([FX.mutFireDump, FX.mutFireRoute, FX.mutFireDetail].join("\n"));
  check("post-702 fire (Production 34176026988): hits · lines · msgs · fire-t · mut mismatch · count mismatch · dumps written",
    [mf.fireHits, mf.fireLines, mf.fireMessages, mf.fireT, mf.mutMismatch.length, mf.countMismatch.length, mf.dumps.written], [1, 1, 1, 1, 0, 0, 1]);
  const pf = parseLog([FX.pre702Route, FX.pre702Detail].join("\n"));
  check("pre-702 fire (control 33794231177): hits · lines · msgs · mut compared · count mismatch", [pf.fireHits, pf.fireLines, pf.fireMessages, pf.mutCompared, pf.countMismatch.length], [1, 1, 1, 0, 0]);
  const of = parseLog([FX.otherRoute, FX.otherDetail].join("\n"));
  check("non-#418 + #418 on one detail line (Production 30855057273): other · fire-hits · fire-lines · count mismatch",
    [of.other.length, of.other[0]?.hit, /Server Components render/.test(of.other[0]?.msg ?? ""), of.fireHits, of.fireLines, of.countMismatch.length], [1, 1, true, 1, 1, 0]);
  const sc = parseLog(FX.stageClick);
  check("[stage-click] line (daily 34888719223): stageClick · pageErr · readings", [sc.stageClick, sc.stagePageErr, sc.readings], [1, 0, 1]);
  // The mismatches must be able to fire, or their zeros mean nothing.
  const orphanRoute = parseLog(FX.pre702Route);
  check("COUNT-MISMATCH fires: the control's route line with its detail line withheld", orphanRoute.countMismatch, ["home#2:1≠0"]);
  const mutOnly = parseLog(FX.mutFireRoute);
  check("MUT-MISMATCH fires: the post-702 fire's route line with its detail line withheld", mutOnly.mutMismatch, ["home-stage-introduced#2:fire-t=1,#418=0"]);
  const noArt = await classify(
    { databaseId: 0, event: "schedule", status: "completed", conclusion: "success", createdAt: "", headSha: head, url: "", jobs: [{ name: "smoke", conclusion: "success" }], artifacts: [] },
    [FX.mutFireRoute, FX.mutFireDetail].join("\n"),
  );
  check("ARTIFACT-MISMATCH fires: a FIRE whose run lists no pageerr-dumps", [noArt.verdict, noArt.flags], ["FIRE", ["ARTIFACT-MISMATCH"]]);
  // HO 732 — tally()'s two branches. The first check FAILS on the pre-732 file
  // (which printed `0 of 7` and a `seventh due` date over an empty window), so
  // it is a control and not decoration; the second pins the counting branch so
  // the empty-window guard cannot swallow a real window.
  const emptyTally = tally([], "2026-09-17T21:26:00Z");
  check("empty window says no runs, and prints no count and no due date",
    [emptyTally.some((l) => l.includes("no `schedule` runs in this window")), emptyTally.some((l) => /of 7/.test(l)), emptyTally.some((l) => /seventh due/.test(l)), emptyTally.some((l) => l.startsWith("- samples, not counted:"))],
    [true, false, false, true]);
  const oneDaily: Rec = {
    id: 1, event: "schedule", createdAt: "2026-09-17T18:50:39Z", sha: head.slice(0, 7),
    conclusion: "success", smoke: "success", log: "ok", floor: 1, p: parseLog(FX.clean),
    artifacts: "[]", hasDumps: false, verdict: "ZERO", flags: [], url: "",
  };
  const oneTally = tally([oneDaily], "2026-09-17T12:00:00Z");
  check("one ZERO schedule record still counts: the guard does not swallow a real window",
    [oneTally.some((l) => l.includes("**1 of 7**")), oneTally.some((l) => l.includes("no `schedule` runs in this window"))],
    [true, false]);
  console.log(`SELF-TEST ${ok ? "GREEN" : "RED"}\n`);
  return ok;
}

// ── main ─────────────────────────────────────────────────────────────────────
function argv(name: string): string[] {
  const a = process.argv.slice(2), out: string[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] === name && a[i + 1]) out.push(a[++i]!);
  return out;
}

async function main(): Promise<number> {
  if (!existsSync(join(ROOT, "e2e/routes.ts"))) { console.error("run from the repo root"); return 2; }
  const selfOk = await selftest();
  if (process.argv.includes("--selftest")) return selfOk ? 0 : 2;
  if (!selfOk) { console.log("SELF-TEST RED: instrument not run"); return 2; }

  const since = argv("--since")[0];
  if (!since || Number.isNaN(Date.parse(since))) { console.error("--since <ISO> is required (no default: a baked instant is a baked pointer)"); return 2; }
  const until = argv("--until")[0];
  const controls = argv("--control").map(Number);
  const fromDir = argv("--from-dir")[0] ?? null;
  const out = argv("--out")[0] ?? fromDir;
  if (!controls.length && !process.argv.includes("--no-control")) { console.error("--control <id> is required (or --no-control)"); return 2; }
  if (out) mkdirSync(out, { recursive: true });

  const head: string[] = [`# HO 723 pageErr ledger — since ${since}${until ? ` until ${until}` : ""}`, "",
    `Read ${new Date().toISOString()} · ${fromDir ? `re-parsed from ${fromDir} (no API)` : "harvested via gh, serially"} · HEAD \`${execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()}\``, ""];
  if (!controls.length) { console.log("WARNING: --no-control — every ZERO below is unproven; the instrument has not been shown to see a fire this run"); head.push("**WARNING: --no-control; no ZERO below is proven.**", ""); }
  console.log(head.join("\n"));

  // Controls before zeros.
  const ctlRecs: Rec[] = [];
  for (const id of controls) {
    const { meta, log } = fromDir ? loadRun(fromDir, id) : fetchRun(listRow(id), out);
    ctlRecs.push(await classify(meta, log));
  }
  const ctlMd = controls.length ? ["## Controls (must read fire-hits ≥ 1)", "", HEAD_ROW, ...ctlRecs.map(row), "", ...ctlRecs.flatMap(findings), ""] : [];
  if (controls.length) {
    console.log(ctlMd.join("\n"));
    const failed = ctlRecs.filter((r) => !r.p || r.p.fireHits < 1);
    if (failed.length) { console.log(`CONTROL FAILED: instrument blind (${failed.map((r) => r.id).join(", ")})`); return 2; }
  }

  let rows: ListRow[];
  if (fromDir) {
    rows = readdirSync(fromDir).filter((f) => /^\d+\.meta\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(fromDir, f), "utf8")) as ListRow);
  } else rows = listRuns(since.slice(0, 10));
  rows = rows.filter((r) => r.createdAt >= new Date(since).toISOString().replace(".000", "") && (!until || r.createdAt <= new Date(until).toISOString().replace(".000", "")))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const recs: Rec[] = [];
  for (const r of rows) {
    const { meta, log } = fromDir ? loadRun(fromDir, r.databaseId) : fetchRun(r, out);
    recs.push(await classify(meta, log));
    process.stderr.write(`  ${r.databaseId} ${recs[recs.length - 1]!.verdict}\n`);
  }

  const f = recs.flatMap(findings);
  const md = [`## Runs since ${since} (${recs.length})`, "", HEAD_ROW, ...recs.map(row), "",
    "## Findings", "", ...(f.length ? f : ["none"]), "", ...tally(recs, since), ""];
  console.log(md.join("\n"));
  if (out) {
    writeFileSync(join(out, "ledger.md"), [...head, ...ctlMd, ...md].join("\n"));
    writeFileSync(join(out, "ledger.json"), JSON.stringify({ since, until: until ?? null, controls: ctlRecs, runs: recs }, null, 2));
  }
  const dirty = recs.some((r) => r.verdict === "FIRE" || r.verdict === "OTHER-ERR" || r.flags.length > 0);
  console.log(`exit ${dirty ? 1 : 0}`);
  return dirty ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(2); });
