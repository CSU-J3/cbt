import { createClient, type Client } from "@libsql/client";

// HO 238: bound EVERY Turso HTTP request with a per-request timeout + abort +
// retry-once. Before this, getDb() was a bare createClient({url,authToken}) with
// no timeout and no abort signal, so a single stalled HTTP request (a dead or
// never-established connection that nothing ever gives up on) rode to the full
// 300s function ceiling — the 2026-06-11 GET / hang. `/` is most exposed: ~16+
// Turso calls per render, so the highest odds one cold-stalls.
//
// The bound is a custom `fetch` injected into the libsql HTTP client, so it
// covers every caller (pages, API routes, crons, scripts) from one place.
const DB_REQUEST_TIMEOUT_MS = 10_000;

// AbortSignal.timeout aborts with a DOMException named "TimeoutError"; a manual
// abort would be "AbortError". Only these mean "we gave up on a stalled socket"
// — an HTTP error status is a real answer and is never retried.
function isAbortTimeout(e: unknown): boolean {
  return (
    e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
  );
}

// Custom fetch for the libsql HTTP client (Config.fetch — supported since well
// before 0.14). It is handed a Request and must return a Response-compatible
// promise.
//
// ABORT, not race: AbortSignal.timeout tears the underlying socket down, which
// is both the timeout (we stop waiting) and what makes the retry valid — it
// can't reuse the corpse, so attempt 2 gets a fresh connection by construction.
// A Promise.race "timeout" would leave the hung fetch alive holding the dead
// socket, defeating both.
//
// Retry: ONCE, on abort/timeout only. The Request is cloned up front so the
// retry has an unconsumed body; if it can't be cloned we fast-fail instead
// (still bounded, just no retry). Writes are upsert/UPDATE/DELETE-shaped or
// benign append-only inserts (HO 238 idempotency grep), so a retried-after-
// timeout write is safe.
async function boundedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const cloneable =
    input != null && typeof (input as Request).clone === "function";
  const retryInput = cloneable ? (input as Request).clone() : null;
  try {
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(DB_REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    if (isAbortTimeout(e) && retryInput) {
      console.warn("[db] timeout, retrying");
      return await fetch(retryInput, {
        ...init,
        signal: AbortSignal.timeout(DB_REQUEST_TIMEOUT_MS),
      });
    }
    if (isAbortTimeout(e)) console.warn("[db] timeout (no retry — uncloneable)");
    throw e;
  }
}

let _db: Client | undefined;

export function getDb(): Client {
  if (_db) return _db;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  _db = createClient({ url, authToken, fetch: boundedFetch });
  return _db;
}
