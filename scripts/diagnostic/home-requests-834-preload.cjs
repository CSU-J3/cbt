// HO 834 § 1 — the preload for home-requests-834.ts. Passed to `next start` as
// NODE_OPTIONS="--require <this file>", it wraps globalThis.fetch for the store's
// host only (the host of TURSO_DATABASE_URL, compared in-process, never printed).
//
// For each HTTP request to the store it:
//   - reads the Hrana pipeline body and lists its statements (execute, batch
//     steps, sequence, store_sql);
//   - REFUSES the request, before it is sent, if any statement isn't a read by
//     HO 824's rules (scripts/diagnostic/store-stalls-829.ts:59 onward): it must
//     start with SELECT / WITH / EXPLAIN after any comments, and carry no write
//     word outside its comments and string literals. A batch passes only in read
//     mode, as HO 824's guard allows it (:111-114): on the wire that's the exact
//     wrapper BEGIN TRANSACTION READONLY … COMMIT, ROLLBACK, whose inner
//     statements are each checked. A sequence (executeMultiple) is refused
//     outright, as HO 824 refuses it (:116-120). A refusal throws in the page and
//     is logged as a `refused` line; the driver reads the log after every step and
//     stops on it. Five controls run at load (below).
//   - keys the request to the page request it ran under: every incoming HTTP
//     request gets an id (a counter, the method and the URL) through an
//     AsyncLocalStorage entered at http.Server's 'request' event, so a fetch made
//     anywhere in that request's render, or in work it scheduled, carries the id;
//   - writes one JSON line per store request to $HOME_PROBE_LOG: its start time,
//     the page request, the statement count, each statement's first 100
//     characters (SQL only, never its arguments), its duration and status.
//
// It changes nothing else: every other fetch passes through untouched.
"use strict";
const fs = require("node:fs");
const http = require("node:http");
const { AsyncLocalStorage } = require("node:async_hooks");

const LOG = process.env.HOME_PROBE_LOG;
if (!LOG) throw new Error("[probe] HOME_PROBE_LOG is not set");
const dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl) throw new Error("[probe] TURSO_DATABASE_URL is not set");
const STORE_HOST = new URL(dbUrl.replace(/^libsql:/, "https:")).host;

// ---- HO 824's read rules ------------------------------------------------------------
const READ_START = /^\s*(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(SELECT|WITH|EXPLAIN)\b/i;
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b|\bREPLACE\b(?!\s*\()/i;
function codeOnly(sql) {
  let o = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      o += " ";
    } else if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      o += " ";
    } else if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      i++;
      o += " ";
    } else {
      o += c;
      i++;
    }
  }
  return o;
}
const isRead = (sql) => READ_START.test(sql) && !WRITE_WORD.test(codeOnly(sql));

// ---- the page request a fetch runs under ---------------------------------------------
const als = new AsyncLocalStorage();
let reqSeq = 0;
const origEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, res) {
  if (event === "request" && req && typeof req.url === "string") {
    const id = `${++reqSeq} ${req.method} ${req.url}`;
    return als.run({ id }, () => origEmit.apply(this, arguments));
  }
  return origEmit.apply(this, arguments);
};

// ---- the statements in a Hrana pipeline body ------------------------------------------
function statementsOf(bodyText) {
  const out = [];
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { stmts: null, kinds: ["unparsed"] };
  }
  const stored = new Map();
  const kinds = [];
  for (const r of body.requests || []) {
    kinds.push(r.type);
    if (r.type === "store_sql") stored.set(r.sql_id, r.sql);
  }
  const sqlOf = (stmt) => (stmt && (stmt.sql ?? stored.get(stmt.sql_id))) ?? null;
  let readonlyBatches = 0;
  for (const r of body.requests || []) {
    if (r.type === "execute") out.push(sqlOf(r.stmt));
    else if (r.type === "batch") {
      const steps = ((r.batch && r.batch.steps) || []).map((s) => sqlOf(s.stmt));
      // HO 824's rule lets a batch through only in "read" mode, checking each of its
      // statements (store-stalls-829.ts:111-114). On the wire, @libsql/client sends a
      // read-mode batch as BEGIN TRANSACTION READONLY, the statements, COMMIT, and a
      // conditional ROLLBACK. That exact wrapper is the read mode itself, so it's
      // accepted and not counted; every statement inside is checked. Any other
      // BEGIN (a write or deferred batch), or a lone transaction statement, is not
      // a read and is refused.
      const norm = (s) => String(s ?? "").trim().toUpperCase();
      const n = steps.length;
      if (n >= 3 && norm(steps[0]) === "BEGIN TRANSACTION READONLY" && norm(steps[n - 2]) === "COMMIT" && norm(steps[n - 1]) === "ROLLBACK") {
        readonlyBatches++;
        out.push(...steps.slice(1, n - 2));
      } else out.push(...steps);
    } else if (r.type === "sequence") {
      // HO 824 refuses executeMultiple outright (store-stalls-829.ts:116-120); its
      // wire form is a Hrana sequence, so every sequence is refused, whatever it holds.
      out.push(null);
    }
  }
  return { stmts: out, kinds, readonlyBatches };
}

let passed = 0;
let refused = 0;
const write = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + "\n");

// ---- the guard's controls, before the server takes a request -----------------------------
// Five bodies, never sent: a lone write, a deferred (write-capable) batch, a write
// inside a read-only batch, a sequence (executeMultiple's wire form) of reads, and a
// read-only batch of a read. The first four must be refused and the fifth must pass,
// or the preload throws and the server never starts.
{
  const body = (requests) => JSON.stringify({ requests });
  const step = (sql) => ({ stmt: { sql } });
  const refusedBy = (text) => {
    const { stmts } = statementsOf(text);
    return stmts === null ? ["(unparsed)"] : stmts.filter((s) => s == null || !isRead(s));
  };
  const cases = [
    ["a lone write", body([{ type: "execute", stmt: { sql: "DELETE FROM cron_runs WHERE 0" } }]), true],
    ["a deferred batch", body([{ type: "batch", batch: { steps: [step("BEGIN DEFERRED"), step("SELECT 1"), step("COMMIT"), step("ROLLBACK")] } }]), true],
    ["a write in a read-only batch", body([{ type: "batch", batch: { steps: [step("BEGIN TRANSACTION READONLY"), step("INSERT INTO x VALUES (1)"), step("COMMIT"), step("ROLLBACK")] } }]), true],
    ["a sequence of reads", body([{ type: "sequence", sql: "SELECT 1; SELECT 2" }]), true],
    ["a read-only batch of a read", body([{ type: "batch", batch: { steps: [step("BEGIN TRANSACTION READONLY"), step("SELECT 1"), step("COMMIT"), step("ROLLBACK")] } }]), false],
  ];
  const outcome = cases.map(([name, text, mustRefuse]) => ({ name, mustRefuse, refused: refusedBy(text).length > 0 }));
  write({ kind: "selftest", t: new Date().toISOString(), outcome });
  if (outcome.some((o) => o.refused !== o.mustRefuse)) throw new Error(`[probe] the guard's controls failed: ${JSON.stringify(outcome)}`);
}
const origFetch = globalThis.fetch;
globalThis.fetch = async function probeFetch(input, init) {
  let url;
  try {
    url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  } catch {
    return origFetch.apply(this, arguments);
  }
  if (url.host !== STORE_HOST) return origFetch.apply(this, arguments);

  const ctx = als.getStore();
  const req = ctx ? ctx.id : "(none)";
  let text = "";
  if (init && typeof init.body === "string") text = init.body;
  else if (input && typeof input === "object" && typeof input.clone === "function") text = await input.clone().text();
  const { stmts, kinds, readonlyBatches } = statementsOf(text);
  const bad = stmts === null ? ["(unparsed body)"] : stmts.filter((s) => s == null || !isRead(s));
  const t0 = Date.now();
  if (bad.length) {
    refused += bad.length;
    write({ kind: "refused", t: new Date(t0).toISOString(), req, path: url.pathname, kinds, refused: bad.map((s) => String(s).slice(0, 100)), passed, refusedTotal: refused });
    throw new Error(`[probe] refused a store request carrying a non-read statement: ${String(bad[0]).slice(0, 100)}`);
  }
  passed += stmts.length;
  try {
    const res = await origFetch.apply(this, arguments);
    write({ kind: "store", t: new Date(t0).toISOString(), req, path: url.pathname, kinds, readonlyBatches, n: stmts.length, stmts: stmts.map((s) => s.replace(/\s+/g, " ").trim().slice(0, 100)), ms: Date.now() - t0, status: res.status, passed, refusedTotal: refused });
    return res;
  } catch (e) {
    write({ kind: "store-error", t: new Date(t0).toISOString(), req, path: url.pathname, kinds, n: stmts.length, stmts: stmts.map((s) => s.replace(/\s+/g, " ").trim().slice(0, 100)), ms: Date.now() - t0, error: String(e && e.name), passed, refusedTotal: refused });
    throw e;
  }
};
write({ kind: "preload", t: new Date().toISOString(), pid: process.pid, note: "fetch wrapped for the store's host; http.Server request ids on" });
