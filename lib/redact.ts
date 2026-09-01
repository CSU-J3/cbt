// HO 679 — the redaction sink. One helper, applied at three layers, so that no
// string carrying a credential can reach a `cron_runs` row, a route response
// body, or a log line.
//
// WHY THIS EXISTS. The HO 678 key audit found `CONGRESS_API_KEY` in cleartext in
// three production `cron_runs` rows (ids 322, 344, 8348) — `wrapCronRoute`'s
// catch took a raw `err.message` into both the JSON response and the row, and
// the seven `lib/` fetch helpers under it threw messages containing the full
// request URL, key and all. A permanent DB column is strictly worse than a log
// line, whose retention is one day. The fix is redaction at the sink FIRST (one
// place, covers every current and future caller) and then at the sources (a
// script printing to a terminal never reaches the sink, and that terminal is a
// transcript).
//
// TWO PASSES, IN THIS ORDER. Pattern first, so a stripped parameter's value can
// never reach the value pass and get re-emitted as a `[REDACTED:...]` token
// still sitting inside a URL.
//
// REGEX LITERALS ONLY, NEVER `new RegExp(<string>)` — method.md § Gates instance
// 7. A quoted heredoc collapsed `\\` to `\` in HO 678's own scanner, `"\s*"`
// reached Node as literal `s*`, and the regex still COMPILED while asking a
// different question. A literal makes a lost backslash a syntax error.
//
// `process.env` is read at CALL TIME, not at module load: scripts that load
// `.env` late, and the fixture script that sets synthetic values before calling,
// both depend on it.

// The parameter names that can carry a credential in a query string. The
// leading `[?&]` anchor is load-bearing — it forces the name to start a
// parameter, so `token` cannot match the tail of `access_token`.
//
// The value class excludes `&` (parameter boundary), whitespace (the URL ends
// there inside a prose message like `fetch <url> -> 403: ...`) and quote/bracket
// characters (so a URL embedded in JSON does not swallow its own closing quote).
const KEYED_PARAM =
  /([?&])(?:api[_-]?key|access_token|authToken|token|secret)=[^&\s"'<>`]*/gi;

// `Bearer <value>` / `Token <value>` header shapes. Deliberately NOT anchored to
// `Authorization:` — `authorize()` in the cron routes builds a bare
// `Bearer ${secret}` string that can land in a comparison or a message on its
// own.
//
// CASE-SENSITIVE, AND THE TAIL MUST LOOK LIKE A TOKEN. An earlier cut used `gi`
// with an unbounded `[^\s"',;]+` tail and rewrote the prose `token expired` to
// `token [REDACTED]` — a mutation with no security value, on a string that
// carries no secret. HTTP writes these keywords capitalized and this repo builds
// them that way at every site (`Bearer ${secret}`, `Token ${key}`), so dropping
// the `i` costs nothing real. The `{12,}` floor and the base64url/hex character
// class are what separate a credential from an English word.
//
// This pass is defence in depth, not the primary defence: a secret of OURS is
// caught by the value pass below whatever the header casing. What this catches
// is a THIRD-PARTY token echoed back to us, which is in no env var we hold.
const BEARER_TOKEN = /\b(Bearer|Token) +[A-Za-z0-9._~+/=-]{12,}/g;

// Every env name whose value is a credential. TURSO_DATABASE_URL and
// REVALIDATE_URL are deliberately absent: they are hostnames, not secrets, and
// both already appear verbatim in tracked documentation — redacting them would
// destroy the diagnostic value of an error message without protecting anything.
const SECRET_ENV_NAMES = [
  "CONGRESS_API_KEY",
  "FEC_API_KEY",
  "FRED_API_KEY",
  "FMP_API_KEY",
  "LDA_API_KEY",
  "GEMINI_API_KEY",
  "TURSO_AUTH_TOKEN",
  "CRON_SECRET",
  "AUTH_SECRET",
  "AUTH_GITHUB_SECRET",
] as const;

// Below this length a value is too short to be a real credential and too likely
// to be a common substring — replacing every occurrence of a 3-character env
// value would shred an unrelated message. Unset, empty and short values are
// skipped, never thrown on.
const MIN_SECRET_LENGTH = 8;

/**
 * Strip credentials from an arbitrary string.
 *
 * Pass 1 removes key-bearing query parameters ENTIRELY — the parameter is
 * deleted, not placeholder-substituted, so the result carries no `api_key=` at
 * all. That is what makes the close criterion and HO 680's scrub gate greppable:
 * `WHERE error_message LIKE '%api_key='` is the check, and a placeholder would
 * keep matching it forever.
 *
 * Pass 2 replaces any literal env value with `[REDACTED:<NAME>]`. It uses
 * split/join rather than a constructed regex, so a value containing regex
 * metacharacters needs no escaping and cannot alter the match semantics.
 */
export function redactSecrets(s: string): string {
  if (!s) return s;

  // --- Pass 1: patterns -----------------------------------------------------
  // Replace the matched `[?&]name=value` with its separator alone, then repair
  // the seams. Replacing with the separator (rather than nothing) is what keeps
  // a leading `?param` from turning the next `&` into the query introducer.
  let out = s.replace(KEYED_PARAM, "$1");

  // Seam repairs, looped because consecutive keyed parameters collapse into a
  // run of separators (`?a=1&api_key=X&token=Y&b=2` -> `?a=1&&&b=2`).
  let previous: string;
  do {
    previous = out;
    out = out.replace(/\?&/g, "?").replace(/&&/g, "&");
  } while (out !== previous);

  // A URL that ended on the stripped parameter is left with a dangling
  // introducer or separator. Drop it — but only when the token it terminates
  // contains a `/` or `=`, i.e. is URL-shaped. Without that guard an ordinary
  // message ending in a question mark ("is the key set?") would silently lose
  // its punctuation, which is a mutation this helper has no business making.
  out = out.replace(/(\S*[/=]\S*?)[?&](?=\s|$)/g, "$1");

  out = out.replace(BEARER_TOKEN, "$1 [REDACTED]");

  // --- Pass 2: literal env values -------------------------------------------
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (!value || value.length < MIN_SECRET_LENGTH) continue;
    if (!out.includes(value)) continue;
    out = out.split(value).join(`[REDACTED:${name}]`);
  }

  return out;
}

/**
 * Redact a structured value by round-tripping it through JSON.
 *
 * Corruption is unreachable by construction: pass 1 only ever deletes
 * characters from a class that excludes quotes and backslashes, and pass 2
 * substitutes a token containing neither — while an env value holding a JSON
 * metacharacter would appear escaped in the serialized form and simply fail to
 * match (under-redaction, never malformed output). It is therefore left
 * uncaught on purpose: if this ever threw it would be a loud 500, which is the
 * correct failure direction for a security sink. Swallowing it would mean
 * returning the unredacted body.
 */
export function redactValue<T>(value: T): T {
  return JSON.parse(redactSecrets(JSON.stringify(value))) as T;
}

/**
 * The single constructor for a failed-fetch error. The eleven key-bearing
 * sources and the five keyless-but-URL-bearing ones all throw this instead of
 * building their own template (ruled HO 679: every throw that interpolates a URL
 * goes through here; status-only throws are untouched).
 *
 * Redacting at the THROW, not at each consumer, is what makes the fourteen
 * `console.*` sites that log `err.message` safe for free — they print a string
 * that was already clean when it was constructed.
 *
 * `body` is capped at 300 characters. This normalizes four sites up from 200 and
 * leaves the two that pass no body passing none (approved HO 679 STEP 0).
 */
export function fetchError(url: string, status: number, body?: string): Error {
  return new Error(
    redactSecrets(
      `fetch ${url} -> ${status}${body ? ": " + body.slice(0, 300) : ""}`,
    ),
  );
}
