// Shared console-error noise filter for the e2e specs. Extracted HO 504 from the
// HO 472 §4 inline copy in fit-finish.spec.ts; smoke.spec.ts imports it too, so
// the two crawlers share ONE noise definition. This matters because the
// unattended prod run (e2e-prod.yml) reds on any un-allowlisted console error —
// the list has to be exact and single-source, not two drifting copies.
//
// Never file an entry here as a new finding. Two entries are OPEN LOOPS whose
// fixes will delete them — they must stay findable by grep when the loop closes:
//   - MissingSecret                     → NextAuth AUTH_SECRET env open loop
//   - "two children with the same key"  → FilingRow dup-key (HO 463)
// The other three are permanent: cosmetic asset 404s + React dev-only banners. A
// production build already suppresses the dev banners; they're filtered
// defensively in case a suite is ever pointed at a dev server.
export function isKnownNoise(text: string): boolean {
  return (
    /favicon\.ico|manifest\.webmanifest|apple-touch-icon/.test(text) ||
    /MissingSecret/.test(text) || // NextAuth AUTH_SECRET env OPEN LOOP
    /Encountered two children with the same key/.test(text) || // FilingRow dup-key (HO 463)
    /Download the React DevTools/.test(text) ||
    /\[Fast Refresh\]/.test(text)
  );
}
