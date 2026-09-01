// HO 679 — the gate for lib/redact.ts. Tracked, not scratch (SKILL: probes
// default to TRACKED, and scripts/** is in tsconfig so this must typecheck or it
// fails the Vercel build).
//
// IT IS A GATE BECAUSE IT CAN FAIL. Stub `redactSecrets` to the identity
// function and every one of the NINE positive fixtures fails (1-7, 9, 11).
// The FOUR negatives (8, 10, 12, 13) pass under a no-op BY CONSTRUCTION — each
// asserts byte-identical output — which is what makes them negatives rather
// than gaps: they prove the helper does not over-redact, and an instrument that
// read the same whether or not the work happened would measure nothing
// (method.md § Gates).
//
// The two negatives added at review guard the two places this helper was caught
// mutating an innocent string: 12 covers BEARER_TOKEN (an earlier `gi` +
// unbounded-tail cut rewrote the prose `token expired`), 13 covers the
// trailing-separator repair (which without its `[/=]` guard eats the question
// mark off `is the row there?`).
//
// It sets SYNTHETIC env values and never reads a real one. The synthetic values
// are not key-shaped and match nothing in the repo.
//
// Run: npx tsx scripts/diagnostic/redact-fixtures-679.ts
// Exits 1 on the first mismatch, printing the fixture, the expectation and the
// actual output.

import { fetchError, redactSecrets } from "@/lib/redact";

type Check = {
  n: number;
  what: string;
  run: () => { actual: string; expected: string } | { ok: boolean; detail: string };
};

// Synthetic only. Set BEFORE any call, and deliberately assigned here rather
// than read, so a machine with a real .env loaded cannot leak into the run.
process.env.CONGRESS_API_KEY = "FIXTURE_CONGRESS_0123456789";
process.env.FEC_API_KEY = "";
process.env.LDA_API_KEY = "short";

const CG = "https://api.congress.gov/v3";

const checks: Check[] = [
  {
    n: 1,
    what: "leading api_key, another param after",
    run: () => ({
      actual: redactSecrets(`${CG}/bill?api_key=SYN123&format=json`),
      expected: `${CG}/bill?format=json`,
    }),
  },
  {
    n: 2,
    what: "trailing api_key after another param",
    run: () => ({
      actual: redactSecrets(`${CG}/bill?format=json&api_key=SYN123`),
      expected: `${CG}/bill?format=json`,
    }),
  },
  {
    n: 3,
    what: "sole param",
    run: () => ({
      actual: redactSecrets(`${CG}/bill?api_key=SYN123`),
      expected: `${CG}/bill`,
    }),
  },
  {
    n: 4,
    what: "mid-string param, one & between the survivors",
    run: () => ({
      actual: redactSecrets(
        "https://api.stlouisfed.org/fred/series?series_id=DGS10&api_key=SYN123&file_type=json",
      ),
      expected:
        "https://api.stlouisfed.org/fred/series?series_id=DGS10&file_type=json",
    }),
  },
  {
    n: 5,
    what: "apikey spelling (FMP)",
    run: () => ({
      actual: redactSecrets(
        "https://financialmodelingprep.com/api/v3/quote/SPY?apikey=SYN123",
      ),
      expected: "https://financialmodelingprep.com/api/v3/quote/SPY",
    }),
  },
  {
    n: 6,
    what: "Bearer and Token header shapes",
    run: () => {
      // 18 chars — clears BEARER_TOKEN's {12,} token-shaped tail floor.
      const a = redactSecrets("Authorization: Bearer SYN123456789abcdef");
      const b = redactSecrets("Authorization: Token SYN123456789abcdef");
      const okA = a === "Authorization: Bearer [REDACTED]";
      const okB = b === "Authorization: Token [REDACTED]";
      return {
        ok: okA && okB,
        detail: `Bearer -> ${JSON.stringify(a)} | Token -> ${JSON.stringify(b)}`,
      };
    },
  },
  {
    n: 7,
    what: "literal env value, every occurrence",
    run: () => ({
      actual: redactSecrets(
        "body said FIXTURE_CONGRESS_0123456789 twice FIXTURE_CONGRESS_0123456789",
      ),
      expected:
        "body said [REDACTED:CONGRESS_API_KEY] twice [REDACTED:CONGRESS_API_KEY]",
    }),
  },
  {
    n: 8,
    what: "empty and short env values are skipped, no throw",
    run: () => ({
      actual: redactSecrets("a message that mentions short and nothing else"),
      expected: "a message that mentions short and nothing else",
    }),
  },
  {
    n: 9,
    what: "the real shape: fetch <url> -> 403: <body>",
    run: () => ({
      actual: redactSecrets(
        `fetch ${CG}/bill/119/hr/1?api_key=SYN123 -> 403: {"error":{"code":"API_KEY_INVALID"}}`,
      ),
      expected: `fetch ${CG}/bill/119/hr/1 -> 403: {"error":{"code":"API_KEY_INVALID"}}`,
    }),
  },
  {
    n: 10,
    what: "negative control — nothing to redact, byte-identical",
    run: () => {
      const s =
        "sync finished: seen=250 upserted=12 skipped=238 failed=0 budgetStopped=false";
      return { actual: redactSecrets(s), expected: s };
    },
  },
  {
    n: 11,
    what: "fetchError caps the body at exactly 300 chars",
    run: () => {
      const msg = fetchError(
        `${CG}/bill?api_key=SYN123`,
        429,
        "x".repeat(500),
      ).message;
      const prefix = `fetch ${CG}/bill -> 429: `;
      const startsRight = msg.startsWith(prefix);
      const bodyLen = msg.slice(prefix.length).length;
      return {
        ok: startsRight && bodyLen === 300,
        detail: `startsWithPrefix=${startsRight} bodyLen=${bodyLen} (want 300)`,
      };
    },
  },
  {
    n: 12,
    what: "negative — lowercase prose `token expired` is NOT a header",
    run: () => {
      const s = "libsql: token expired";
      return { actual: redactSecrets(s), expected: s };
    },
  },
  {
    n: 13,
    what: "negative — prose ending in a question mark keeps its punctuation",
    run: () => {
      const s = "is the row there? yes";
      return { actual: redactSecrets(s), expected: s };
    },
  },
];

let failed = 0;
for (const c of checks) {
  const r = c.run();
  const ok = "ok" in r ? r.ok : r.actual === r.expected;
  if (ok) {
    console.log(`  PASS  ${String(c.n).padStart(2)}  ${c.what}`);
  } else {
    failed++;
    console.error(`  FAIL  ${String(c.n).padStart(2)}  ${c.what}`);
    if ("ok" in r) {
      console.error(`        ${r.detail}`);
    } else {
      console.error(`        expected: ${JSON.stringify(r.expected)}`);
      console.error(`        actual:   ${JSON.stringify(r.actual)}`);
    }
  }
}

console.log(
  `\n${checks.length - failed}/${checks.length} fixtures passed` +
    (failed ? ` — ${failed} FAILED` : ""),
);
if (failed) process.exit(1);
