// HO 681 — the markets-cron collision flag, in a LEAF module so it can be
// exercised without the cron's DB write.
//
// WHY IT EXISTS. Two symbols in one run that resolve to the SAME upstream event
// are duplicates, and nothing else in the pipeline can see it: they agree on
// `price` and on `marketDate` precisely BECAUSE they are one market, so every
// existing signal reads healthy. That is what let FEDCUT and FEDCUT-SEP render
// "FED CUT SEP" twice on the ODDS strip for weeks — visible only to a human
// looking at the tape, which is not an instrument.
//
// IT REPORTS, IT DOES NOT REPAIR. No dedupe (which would hide the config error
// while silently picking a winner) and no throw (a duplicated row is redundant,
// not wrong — failing the tick would cost every other symbol its write for a
// cosmetic fault). The reading lands in `cron_runs.payload` via the HO 679 sink,
// which is where audits read, and on the console for the live-log path.
//
// WHY A LEAF AND NOT A ROUTE-LOCAL FUNCTION (deviation, named rather than
// absorbed — the HO 681 plumbing was scoped to three files and this is a
// fourth). The control this guard needs is "fire it on a real collision", and
// the only route-level path to that is `processSymbol`, which WRITES to
// `market_ticks`. Exercising it there would insert known-duplicate rows for the
// two symbols this very handoff retires, into the production table — a
// falsification leg writing a known-wrong value to prod, which the method
// forbids. Extracting the pure half makes the guard testable with zero writes.
// Leaf-safe on purpose: no `next/cache`, no `@/lib/db`, so a plain script can
// import it (the `lib/amendment-vote-key.ts` precedent).
import type { MarketSymbol } from "@/lib/markets";

// The `ok` shape the cron aggregates. Declared structurally rather than imported
// from the route so this module stays a leaf; the route's SymbolOutcome is
// assignable to it.
export type ResolvedOutcome = {
  internal: string;
  ok: boolean;
  resolvedId?: string;
};

export type Collision = { symbols: string[]; resolved: string };

export function findCollisions(
  outcomes: readonly ResolvedOutcome[],
  symbols: readonly MarketSymbol[],
): Collision[] {
  const sourceOf = new Map(symbols.map((s) => [s.internal, s.source]));
  // key = `${source} ${resolvedId}`. The space is an unambiguous separator here
  // because neither half can contain one: `source` is a fixed enum of bare
  // words, and the ids are Kalshi event tickers / Gamma slugs, both hyphenated
  // and unspaced.
  //
  // Scoped PER SOURCE because the id namespaces are unrelated: a Kalshi event
  // ticker and a Gamma slug can never collide with each other, and pooling them
  // would be a category error waiting to produce a false positive.
  //
  // Symbols reporting no `resolvedId` are NOT compared — absence means "this
  // source has no identity to check", never "checked and unique". FMP/FRED
  // never report one (their `remote` is already a stable per-symbol id, so two
  // of them cannot silently converge), and on the Polymarket side only the fed
  // path does, because only the fed path has ever had two symbols aimed at one
  // question.
  const bySourceAndId = new Map<string, { resolved: string; symbols: string[] }>();
  for (const o of outcomes) {
    if (!o.ok || !o.resolvedId) continue;
    const source = sourceOf.get(o.internal);
    if (!source) continue;
    const key = `${source} ${o.resolvedId}`;
    const hit = bySourceAndId.get(key);
    if (hit) hit.symbols.push(o.internal);
    else bySourceAndId.set(key, { resolved: o.resolvedId, symbols: [o.internal] });
  }
  return [...bySourceAndId.values()]
    .filter((g) => g.symbols.length > 1)
    .map((g) => ({ symbols: g.symbols, resolved: g.resolved }));
}
