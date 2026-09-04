// HO 287 — tier-3 SOURCE tag (chip family). A single brand-colored letter
// marking which prediction-market venue a value came from: K = Kalshi
// (--kalshi turquoise), P = Polymarket (--poly blue). No border, weight 600,
// 10px (the tier-3 text-tag rung of the size ladder).
//
// The shared home for the K/P tags that B2 (source tags) builds on; today the
// markets SIGNALS pair is the one consumer. Poly-blue sits near
// --party-democrat, so by convention P is only ever rendered beside K (the K/P
// pair), never alone in a party context — see the token note in globals.css.
const SOURCE_META = {
  kalshi: { letter: "K", varName: "--kalshi", name: "Kalshi" },
  polymarket: { letter: "P", varName: "--poly", name: "Polymarket" },
} as const;

export type SourceKind = keyof typeof SOURCE_META;

export function SourceTag({
  source,
  title,
}: {
  source: SourceKind;
  /** Native title override; defaults to the venue's full name. */
  title?: string;
}) {
  const meta = SOURCE_META[source];
  return (
    <span
      className="source-tag"
      // HO 693 — the OFF pass's marker. Emitted by the PRIMITIVE so every
      // present AND future consumer carries it without being told: the gate
      // this feeds exists to catch a site built from a primitive whose author
      // forgot the `odds-only` class, and a marker the author also has to
      // remember would miss exactly that case. Purely an attribute; nothing
      // reads it at runtime and no CSS matches it.
      data-market={source}
      style={{ color: `var(${meta.varName})` }}
      title={title ?? meta.name}
    >
      {meta.letter}
    </span>
  );
}
