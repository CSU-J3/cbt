import "dotenv/config";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { CLASSIFIER_MODEL, classifyCeremonial } from "../lib/classify-ceremonial";
import { getDb } from "../lib/db";
import { redactSecrets } from "../lib/redact";

const CONCURRENCY = 10;

// HO 800: four flags. A plain `npm run classify-ceremonial` (no flags) behaves as
// before except that it reads the NULL rows in id order.
//   --limit N        only the first N NULL rows by id (a pilot)
//   --concurrency N  workers, default CONCURRENCY
//   --label L        a per-row log, docs/handoffs/800-artifacts/classify-<L>.log
//                    (repo-ignored): `<id>\t<1|0|parse-fail|error>\t<ISO time>`
//                    as each row is decided, appended, never truncated; at the end
//                    a tally by bill_type, printed and appended as `# ` lines.
//                    Every line this script prints in a labelled run, and every
//                    line of its log, passes through scrub(), so none of its own
//                    output carries a secret or either URL (REVALIDATE_URL,
//                    TURSO_DATABASE_URL); it names those by env name. Lines its
//                    dependencies print (lib/db.ts's timeout warning, the SDK's,
//                    npm's echo) are not its own and are not scrubbed.
//   --no-revalidate  skip the end-of-run POST to REVALIDATE_URL
// The flags without --label give the standing output: type --label on every
// pilot, resume or re-run, so its rows reach a log.
const LOG_DIR = path.join("docs", "handoffs", "800-artifacts");

type Flags = {
  limit: number | null;
  concurrency: number;
  label: string | null;
  revalidate: boolean;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { limit: null, concurrency: CONCURRENCY, label: null, revalidate: true };
  const positive = (name: string, v: string | undefined): number => {
    if (v === undefined || !/^[1-9][0-9]*$/.test(v)) {
      throw new Error(`${name} needs a positive integer`);
    }
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") flags.limit = positive(a, argv[++i]);
    else if (a === "--concurrency") flags.concurrency = positive(a, argv[++i]);
    else if (a === "--label") {
      const v = argv[++i];
      // Not starting with "-", so a missing value can't swallow the next flag.
      if (v === undefined || !/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(v)) {
        throw new Error("--label needs a name: a letter, digit or _, then letters, digits, _ or -");
      }
      flags.label = v;
    } else if (a === "--no-revalidate") flags.revalidate = false;
    // A mistyped flag must not run the whole remainder: refuse it.
    else throw new Error(`unknown argument: ${a}`);
  }
  return flags;
}

// A labelled run's output filter: redactSecrets, then the two URLs it leaves alone.
function scrub(s: string): string {
  let out = redactSecrets(s);
  for (const name of ["REVALIDATE_URL", "TURSO_DATABASE_URL"] as const) {
    const v = process.env[name];
    if (!v) continue;
    out = out.split(v).join(`$${name}`);
    try {
      const host = new URL(v).host;
      if (host.length >= 8) out = out.split(host).join(`$${name}`);
    } catch {
      // not a URL: the literal pass above is all there is
    }
  }
  return out;
}

let labelled = false;
const say = {
  log: (s: string) => console.log(labelled ? scrub(s) : s),
  warn: (s: string) => console.warn(labelled ? scrub(s) : s),
  error: (s: string) => console.error(labelled ? scrub(s) : s),
};

type Row = {
  id: string;
  title: string;
  latest_action_text: string | null;
};

// The tally's bill_type, read off the id (`<congress>-<type>-<number>`, lib/sync.ts:149)
// so the SELECT keeps its standing column list, which HO 799's script greps.
const billType = (id: string): string => id.split("-")[1] ?? "(unknown)";

type Outcome = "1" | "0" | "parse-fail" | "error";

type Tally = {
  seen: number;
  ok: number;
  parseFail: number;
  error: number;
  e429: number;
  errorClassify: number;
  errorUpdate: number;
  one: number;
  zero: number;
};

const newTally = (): Tally => ({
  seen: 0, ok: 0, parseFail: 0, error: 0, e429: 0, errorClassify: 0, errorUpdate: 0, one: 0, zero: 0,
});

function is429(err: unknown): boolean {
  if ((err as { status?: unknown } | null)?.status === 429) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|RESOURCE_EXHAUSTED|Too Many Requests/i.test(msg);
}

// HO 800's per-row log and tally (--label).
class RunLog {
  readonly file: string;
  readonly all = newTally();
  readonly byType = new Map<string, Tally>();
  readonly usage = { responses: 0, prompt: 0, candidates: 0, thoughts: 0, total: 0 };

  constructor(label: string) {
    mkdirSync(LOG_DIR, { recursive: true });
    this.file = path.join(LOG_DIR, `classify-${label}.log`);
  }

  line(s: string): void {
    appendFileSync(this.file, `${scrub(s)}\n`);
  }

  decided(
    row: Row,
    outcome: Outcome,
    err?: { is429: boolean; phase: "classify" | "update" },
  ): void {
    this.line(`${row.id}\t${outcome}\t${new Date().toISOString()}`);
    const type = billType(row.id);
    let t = this.byType.get(type);
    if (!t) {
      t = newTally();
      this.byType.set(type, t);
    }
    for (const x of [this.all, t]) {
      x.seen++;
      if (outcome === "1") { x.ok++; x.one++; }
      else if (outcome === "0") { x.ok++; x.zero++; }
      else if (outcome === "parse-fail") x.parseFail++;
      else {
        x.error++;
        if (err?.is429) x.e429++;
        if (err?.phase === "update") x.errorUpdate++;
        else x.errorClassify++;
      }
    }
  }

  // The token counts each Gemini response reports, for the run's cost.
  tapUsage(client: GoogleGenAI): void {
    const models = client.models;
    const real = models.generateContent.bind(models);
    models.generateContent = async (params) => {
      const res = await real(params);
      const u = res.usageMetadata;
      this.usage.responses++;
      this.usage.prompt += u?.promptTokenCount ?? 0;
      this.usage.candidates += u?.candidatesTokenCount ?? 0;
      this.usage.thoughts += u?.thoughtsTokenCount ?? 0;
      this.usage.total += u?.totalTokenCount ?? 0;
      return res;
    };
  }

  tallyLines(head: string): string[] {
    const fmt = (t: Tally) =>
      `seen ${t.seen} · ok ${t.ok} · parse-fail ${t.parseFail} · error ${t.error} (429 ${t.e429}; classify ${t.errorClassify}, update ${t.errorUpdate}) · tagged 1: ${t.one} · tagged 0: ${t.zero}`;
    const types = [...this.byType.keys()].sort();
    return [
      head,
      `  all: ${fmt(this.all)}`,
      ...types.map((k) => `  ${k}: ${fmt(this.byType.get(k)!)}`),
      `  tokens (usageMetadata of ${this.usage.responses} response(s)): in ${this.usage.prompt} · out ${this.usage.candidates} · thoughts ${this.usage.thoughts} · total ${this.usage.total}`,
    ];
  }
}

async function fetchRows(limit: number | null): Promise<Row[]> {
  const db = getDb();
  // HO 800: ORDER BY id always, so the selection is deterministic: --limit N reads
  // the first N NULL rows by id, the rows a NULL-id snapshot taken just before
  // lists first. A pass that wrote drops its ok rows from the set, so a later
  // --limit N reads that pass's parse-fails and errors (the lowest NULL ids
  // left) and then rows past it; --limit <their count> reads those alone.
  const rs = await db.execute({
    sql:
      "SELECT id, title, latest_action_text FROM bills WHERE is_ceremonial IS NULL ORDER BY id" +
      (limit === null ? "" : " LIMIT ?"),
    args: limit === null ? [] : [limit],
  });
  return rs.rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    latest_action_text: (r.latest_action_text as string | null) ?? null,
  }));
}

async function processOne(
  client: GoogleGenAI,
  row: Row,
  stats: { ok: number; failed: number },
  log: RunLog | null,
): Promise<void> {
  // The outcome is settled inside the try and counted and logged once after it,
  // so a failed log append can't be read as a failed UPDATE.
  let outcome: Outcome;
  let errInfo: { is429: boolean; phase: "classify" | "update" } | undefined;
  let phase: "classify" | "update" = "classify";
  let attempted: 0 | 1 | undefined;
  try {
    const result = await classifyCeremonial(client, row);
    if (!result) {
      say.warn(`parse-fail ${row.id}: leaving NULL`);
      outcome = "parse-fail";
    } else {
      phase = "update";
      attempted = Number(result.is_ceremonial) as 0 | 1;
      const db = getDb();
      await db.execute({
        sql: "UPDATE bills SET is_ceremonial = ? WHERE id = ?",
        args: [result.is_ceremonial ? 1 : 0, row.id],
      });
      outcome = result.is_ceremonial ? "1" : "0";
    }
  } catch (err) {
    const rateLimited = log ? is429(err) : false;
    say.error(
      `error ${row.id}: ${(err as Error).message}` +
        (log ? ` [${phase}${rateLimited ? ", 429" : ""}]` : ""),
    );
    outcome = "error";
    errInfo = { is429: rateLimited, phase };
  }
  if (outcome === "1" || outcome === "0") stats.ok++;
  else stats.failed++;
  if (log) {
    log.decided(row, outcome, errInfo);
    // An UPDATE can land and still report an error (a timeout after the commit):
    // name the value it carried, so a read-back can tell.
    if (errInfo?.phase === "update") {
      log.line(`# update-error\t${row.id}\tattempted ${attempted}\t${new Date().toISOString()}`);
    }
  }
}

async function runWithConcurrency(
  client: GoogleGenAI,
  rows: Row[],
  stats: { ok: number; failed: number },
  concurrency: number,
  log: RunLog | null,
): Promise<void> {
  let cursor = 0;
  const total = rows.length;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= total) return;
      const row = rows[i]!;
      await processOne(client, row, stats, log);
      const seen = stats.ok + stats.failed;
      if (seen % 100 === 0 || seen === total) {
        say.log(
          `progress: ${seen}/${total} ok=${stats.ok} fail=${stats.failed}` +
            (log
              ? ` (parse-fail=${log.all.parseFail} error=${log.all.error} 429=${log.all.e429})`
              : ""),
        );
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, total) },
    () => worker(),
  );
  await Promise.all(workers);
}

async function revalidateBillsCache(): Promise<void> {
  const url = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) {
    console.log(
      "\nskipping cache revalidation: set REVALIDATE_URL (e.g. https://<deploy>/api/revalidate) and CRON_SECRET to auto-invalidate.",
    );
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) {
      console.warn(`revalidate POST ${url} -> ${res.status}: ${await res.text()}`);
      return;
    }
    console.log(`revalidated bills cache via ${url}`);
  } catch (err) {
    console.warn(`revalidate failed: ${(err as Error).message}`);
  }
}

// HO 800: the same POST for a labelled run, which names the URL by its env name
// and records the response (status and body, or the failure's code) in the log.
async function revalidateLabelled(log: RunLog): Promise<void> {
  const url = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  let line: string;
  if (!url || !secret) {
    line = "revalidate: skipped, REVALIDATE_URL or CRON_SECRET unset";
  } else {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      // Scrubbed before it's cut, so the cut can't leave a fragment no pass matches.
      const body = scrub(await res.text()).slice(0, 300);
      line = `revalidate POST $REVALIDATE_URL -> ${res.status}: ${body}`;
    } catch (err) {
      // The code (ECONNREFUSED, ENOTFOUND) and not the cause's message, which
      // names the address; a cause with no code (fetch's "bad port") is named.
      const cause = (err as { cause?: { code?: unknown; message?: unknown } }).cause;
      const why =
        typeof cause?.code === "string"
          ? cause.code
          : typeof cause?.message === "string"
            ? cause.message
            : "no cause";
      line = `revalidate POST $REVALIDATE_URL failed: ${(err as Error).message} (${why})`;
    }
  }
  say.log(`\n${line}`);
  log.line(`# ${line} · ${new Date().toISOString()}`);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  labelled = flags.label !== null;
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const log = flags.label === null ? null : new RunLog(flags.label);
  if (log) log.tapUsage(client);

  const rows = await fetchRows(flags.limit);
  say.log(`classifying ${rows.length} bill(s) at concurrency ${flags.concurrency}`);
  const start = new Date();
  log?.line(
    `# run ${flags.label} · start ${start.toISOString()} · rows ${rows.length} · concurrency ${flags.concurrency} · limit ${flags.limit ?? "none"} · revalidate ${flags.revalidate ? "on" : "off"} · model ${CLASSIFIER_MODEL}`,
  );
  if (log) say.log(`label ${flags.label}: per-row log ${log.file}`);
  if (rows.length === 0) {
    say.log("nothing to do");
    log?.line(`# nothing to do · ${new Date().toISOString()}`);
    return;
  }

  const stats = { ok: 0, failed: 0 };
  const t0 = Date.now();
  await runWithConcurrency(client, rows, stats, flags.concurrency, log);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  say.log(`\ndone in ${elapsed}s: ok=${stats.ok} failed=${stats.failed}`);
  if (log) {
    const lines = log.tallyLines(
      `tally ${flags.label} · ${start.toISOString()} → ${new Date().toISOString()} · ${elapsed}s · concurrency ${flags.concurrency} · limit ${flags.limit ?? "none"}`,
    );
    for (const l of lines) {
      say.log(l);
      log.line(`# ${l}`);
    }
  }
  if (!flags.revalidate) {
    say.log("\nskipping cache revalidation: --no-revalidate");
    log?.line(`# revalidate: skipped, --no-revalidate · ${new Date().toISOString()}`);
    return;
  }
  if (log) await revalidateLabelled(log);
  else await revalidateBillsCache();
}

main().catch((err) => {
  console.error(labelled ? scrub(String((err as Error)?.stack ?? err)) : err);
  process.exit(1);
});
